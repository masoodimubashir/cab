<?php

namespace App\Services;

use App\Models\CitySetting;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\User;
use Illuminate\Support\Carbon;

class FixedStopAutomationService
{
    public function __construct(
        private readonly FixedRefundService $refunds,
        private readonly NotificationCenter $notifier,
        private readonly FixedBookingEventService $events,
    ) {}

    public function processDriverLocation(int $driverId, float $lat, float $lng, ?Carbon $now = null): void
    {
        $now ??= now();

        $departures = RouteDeparture::query()
            ->with(['route.stops', 'seatReservations.customer'])
            ->where('driver_id', $driverId)
            ->whereIn('status', ['FORMING', 'DISPATCHED', 'DEPARTED'])
            ->whereHas('route', fn ($q) => $q->where('mode', 'fixed'))
            ->get();

        foreach ($departures as $departure) {
            $this->processDeparture($departure, $lat, $lng, $now);
        }
    }

    private function processDeparture(RouteDeparture $departure, float $driverLat, float $driverLng, Carbon $now): void
    {
        $route = $departure->route;
        if (!$route) {
            return;
        }

        $legacySettings = is_array($route->fixed_settings_json) ? $route->fixed_settings_json : [];
        if (($legacySettings['auto_no_show_enabled'] ?? true) !== true) {
            return;
        }

        $citySettings = CitySetting::query()->where('city_id', $route->city_id)->first();

        $driverRadius = (int) ($citySettings?->fixed_stop_arrival_radius_m ?? ($legacySettings['stop_arrival_radius_m'] ?? 150));
        $approachingRadius = max($driverRadius, (int) ($citySettings?->fixed_vehicle_approaching_alert_radius_m ?? ($legacySettings['vehicle_approaching_alert_radius_m'] ?? 500)));
        $customerRadius = (int) ($citySettings?->fixed_customer_pickup_radius_m ?? ($legacySettings['customer_pickup_radius_m'] ?? 150));
        $arrivalDwellSeconds = max(0, (int) ($citySettings?->fixed_stop_arrival_dwell_seconds ?? ($legacySettings['stop_arrival_dwell_seconds'] ?? 20)));
        $waitMinutes = max(0, (int) ($citySettings?->fixed_waiting_time_per_stop_minutes ?? ($route->waiting_time_per_stop_minutes ?? 0)));
        $customerGraceMinutes = max(0, (int) ($citySettings?->fixed_customer_grace_minutes ?? ($legacySettings['customer_grace_minutes'] ?? 2)));
        $driverMissedGraceMinutes = max(0, (int) ($citySettings?->fixed_driver_missed_stop_grace_minutes ?? ($legacySettings['driver_missed_stop_grace_minutes'] ?? 3)));

        $stops = $route->stops->keyBy('id');
        $this->updateReachedStop($departure, $stops, $driverLat, $driverLng, $driverRadius, $now);
        foreach ($departure->seatReservations as $reservation) {
            if (!in_array($reservation->status, ['BOOKED', 'CONFIRMED'], true) || !$reservation->board_stop_id) {
                continue;
            }

            $boardStop = $stops->get($reservation->board_stop_id);
            if (!$boardStop) {
                continue;
            }

            $driverDistance = $this->metersBetween($driverLat, $driverLng, (float) $boardStop->lat, (float) $boardStop->lng);
            if ($driverDistance <= $approachingRadius && $driverDistance > $driverRadius) {
                $this->notifyApproaching($reservation, $now);
            }
            if ($driverDistance <= $driverRadius) {
                $this->markDriverArrived($reservation, $now, $waitMinutes, $arrivalDwellSeconds);
                $this->maybeMarkCustomerNoShow($reservation->fresh(), $now, $customerRadius, $customerGraceMinutes);
                continue;
            }

            if ($reservation->fixed_stop_arrival_started_at && !$reservation->fixed_stop_arrived_at) {
                $reservation->forceFill(['fixed_stop_arrival_started_at' => null])->save();
            }

            $this->maybeMarkDriverMissedStop($reservation, $stops, $driverLat, $driverLng, $driverRadius, $customerRadius, $driverMissedGraceMinutes, $now);
        }
    }


    private function updateReachedStop(RouteDeparture $departure, $stops, float $driverLat, float $driverLng, int $driverRadius, Carbon $now): void
    {
        $reachedSeq = null;
        foreach ($stops as $stop) {
            if ($this->metersBetween($driverLat, $driverLng, (float) $stop->lat, (float) $stop->lng) <= $driverRadius) {
                $reachedSeq = max((int) ($reachedSeq ?? 0), (int) $stop->seq);
            }
        }

        if ($reachedSeq === null || $reachedSeq <= (int) ($departure->fixed_last_reached_stop_seq ?? 0)) {
            return;
        }

        $departure->forceFill([
            "fixed_last_reached_stop_seq" => $reachedSeq,
            "fixed_last_reached_stop_at" => $now,
        ])->save();
    }

    private function markDriverArrived(SeatReservation $reservation, Carbon $now, int $waitMinutes, int $arrivalDwellSeconds): void
    {
        if ($reservation->fixed_stop_arrived_at) {
            return;
        }

        if ($arrivalDwellSeconds > 0) {
            if (!$reservation->fixed_stop_arrival_started_at) {
                $reservation->forceFill(['fixed_stop_arrival_started_at' => $now])->save();
                return;
            }

            if ($reservation->fixed_stop_arrival_started_at->copy()->addSeconds($arrivalDwellSeconds)->greaterThan($now)) {
                return;
            }
        }

        $reservation->forceFill([
            'fixed_stop_arrived_at' => $now,
            'fixed_no_show_after_at' => $now->copy()->addMinutes($waitMinutes),
        ])->save();

        $this->notifyArrived($reservation->fresh(), $now);
    }

    private function maybeMarkCustomerNoShow(?SeatReservation $reservation, Carbon $now, int $customerRadius, int $customerGraceMinutes): void
    {
        if (!$reservation || !in_array($reservation->status, ['BOOKED', 'CONFIRMED'], true) || !$reservation->fixed_no_show_after_at) {
            return;
        }
        if ($reservation->fixed_no_show_after_at->greaterThan($now)) {
            if ($reservation->fixed_no_show_after_at->lessThanOrEqualTo($now->copy()->addMinute())) {
                $this->notifyLeavingSoon($reservation, $now);
            }
            return;
        }

        if (!$reservation->fixed_leaving_soon_notified_at) {
            $this->notifyLeavingSoon($reservation, $now);
            return;
        }

        $customerPresent = $this->customerIsNearPickup($reservation, $customerRadius, $now);
        if ($customerPresent && $reservation->fixed_no_show_after_at->copy()->addMinutes($customerGraceMinutes)->greaterThan($now)) {
            return;
        }

        $updated = $this->refunds->markNoShow($reservation);
        $updated->forceFill([
            'fixed_auto_processed_at' => $now,
            'fixed_auto_outcome' => 'customer_no_show',
        ])->save();

        $this->notifyCustomerNoShow($updated->fresh(), $now);
    }

    private function maybeMarkDriverMissedStop(SeatReservation $reservation, $stops, float $driverLat, float $driverLng, int $driverRadius, int $customerRadius, int $driverMissedGraceMinutes, Carbon $now): void
    {
        if ($reservation->fixed_stop_arrived_at || !$this->customerIsNearPickup($reservation, $customerRadius, $now)) {
            return;
        }

        $boardStop = $stops->get($reservation->board_stop_id);
        if (!$boardStop) {
            return;
        }

        $atLaterStop = $stops
            ->filter(fn (RouteStop $stop) => (int) $stop->seq > (int) $boardStop->seq)
            ->contains(fn (RouteStop $stop) => $this->metersBetween($driverLat, $driverLng, (float) $stop->lat, (float) $stop->lng) <= $driverRadius);

        if (!$atLaterStop && !$reservation->fixed_driver_missed_after_at) {
            return;
        }

        if ($atLaterStop && !$reservation->fixed_driver_missed_after_at) {
            $reservation->forceFill([
                'fixed_driver_missed_after_at' => $now->copy()->addMinutes($driverMissedGraceMinutes),
            ])->save();
            $this->events->record(
                $reservation,
                'driver_missed_stop_timer_started',
                'Driver may have missed pickup',
                'Customer location was near the pickup stop, but the vehicle reached a later stop first. Grace timer started.',
                ['driver_missed_after_at' => $reservation->fixed_driver_missed_after_at?->toIso8601String()],
            );
            return;
        }

        if ($reservation->fixed_driver_missed_after_at && $reservation->fixed_driver_missed_after_at->lessThanOrEqualTo($now)) {
            $updated = $this->refunds->cancelBySystem($reservation, 'driver_missed_stop');
            $updated->forceFill([
                'fixed_auto_processed_at' => $now,
                'fixed_auto_outcome' => 'driver_missed_stop',
            ])->save();

            $this->notifyDriverMissedStop($updated->fresh(), $now);
        }
    }


    private function notifyApproaching(SeatReservation $reservation, Carbon $now): void
    {
        $reservation = $this->loadNotificationReservation($reservation);
        if (!$reservation || $reservation->fixed_approaching_notified_at) {
            return;
        }

        $reservation->forceFill(["fixed_approaching_notified_at" => $now])->save();
        $this->events->record(
            $reservation,
            "vehicle_approaching",
            "Vehicle approaching pickup",
            "Customer was notified that the fixed vehicle is near " . $this->stopName($reservation) . ".",
        );
        $this->notifyCustomer($reservation, "fixed_vehicle_approaching", "Vehicle approaching", "Your fixed ride is near " . $this->stopName($reservation) . ". Please be ready to board.", "car");
    }

    private function notifyArrived(?SeatReservation $reservation, Carbon $now): void
    {
        $reservation = $reservation ? $this->loadNotificationReservation($reservation) : null;
        if (!$reservation || $reservation->fixed_arrived_notified_at) {
            return;
        }

        $reservation->forceFill(["fixed_arrived_notified_at" => $now])->save();
        $this->events->record(
            $reservation,
            "driver_arrived",
            "Driver arrived at pickup",
            "Customer was notified that the driver reached " . $this->stopName($reservation) . ".",
        );
        $this->notifyCustomer($reservation, "fixed_driver_arrived", "Driver arrived", "Your fixed ride has reached " . $this->stopName($reservation) . ". Please board now.", "map-pin");
    }

    private function notifyLeavingSoon(SeatReservation $reservation, Carbon $now): void
    {
        $reservation = $this->loadNotificationReservation($reservation);
        if (!$reservation || $reservation->fixed_leaving_soon_notified_at) {
            return;
        }

        $reservation->forceFill(["fixed_leaving_soon_notified_at" => $now])->save();
        $this->events->record(
            $reservation,
            "leaving_soon_warning",
            "Leaving soon warning sent",
            "Waiting time at " . $this->stopName($reservation) . " expired and the customer was warned to board now.",
        );
        $this->notifyCustomer($reservation, "fixed_leaving_soon", "Driver leaving soon", "Please board now. The waiting time at " . $this->stopName($reservation) . " has expired.", "alert-triangle");
    }

    private function notifyCustomerNoShow(?SeatReservation $reservation, Carbon $now): void
    {
        $reservation = $reservation ? $this->loadNotificationReservation($reservation) : null;
        if (!$reservation) {
            return;
        }

        $this->notifyCustomer($reservation, "fixed_customer_no_show", "Marked no-show", "The driver reached your pickup stop and the waiting time expired. This booking is marked no-show.", "alert-circle");
        $this->notifier->notifyAdmins(
            "fixed_customer_no_show",
            "Fixed customer no-show",
            "Booking #" . $reservation->id . " was automatically marked no-show at " . $this->stopName($reservation) . ".",
            $this->notificationData($reservation) + ["processed_at" => $now->toIso8601String()],
            "alert-circle"
        );
    }

    private function notifyDriverMissedStop(?SeatReservation $reservation, Carbon $now): void
    {
        $reservation = $reservation ? $this->loadNotificationReservation($reservation) : null;
        if (!$reservation) {
            return;
        }

        $refundText = $reservation->refund_status === "REFUNDED" ? " Your Razorpay refund was processed." : " Refund status: " . strtolower((string) $reservation->refund_status) . ".";
        $this->notifyCustomer($reservation, "fixed_driver_missed_stop", "Driver missed pickup", "The driver missed your pickup stop." . $refundText, "alert-triangle");
        $this->notifier->notifyAdmins(
            "fixed_driver_missed_stop",
            "Fixed driver missed pickup",
            "Booking #" . $reservation->id . " was cancelled because the driver missed " . $this->stopName($reservation) . ".",
            $this->notificationData($reservation) + ["processed_at" => $now->toIso8601String()],
            "alert-triangle"
        );
    }

    private function notifyCustomer(SeatReservation $reservation, string $type, string $title, string $body, string $icon): void
    {
        $this->notifier->notifyUserId(
            $reservation->customer_id,
            $type,
            $title,
            $body,
            $this->notificationData($reservation),
            $icon
        );
    }

    private function loadNotificationReservation(SeatReservation $reservation): ?SeatReservation
    {
        return SeatReservation::query()
            ->with(["route:id,name", "routeDeparture:id,status", "boardStop:id,name", "dropStop:id,name"])
            ->find($reservation->id);
    }

    private function notificationData(SeatReservation $reservation): array
    {
        return [
            "module" => "fixed",
            "reservation_id" => $reservation->id,
            "route_id" => $reservation->route_id,
            "route_departure_id" => $reservation->route_departure_id,
            "route_name" => $reservation->route?->name,
            "board_stop" => $this->stopName($reservation),
            "status" => $reservation->status,
            "refund_status" => $reservation->refund_status,
            "auto_outcome" => $reservation->fixed_auto_outcome,
        ];
    }

    private function stopName(SeatReservation $reservation): string
    {
        return $reservation->boardStop?->name ?: ($reservation->board_address ?: "your pickup stop");
    }

    private function customerIsNearPickup(SeatReservation $reservation, int $radiusMeters, Carbon $now): bool
    {
        $reservation->loadMissing('customer:id,current_lat,current_lng,current_location_updated_at', 'boardStop:id,lat,lng');
        $customer = $reservation->customer;
        $stop = $reservation->boardStop;
        if (!$customer || !$stop || $customer->current_lat === null || $customer->current_lng === null || !$customer->current_location_updated_at) {
            return false;
        }

        if ($customer->current_location_updated_at->lt($now->copy()->subMinutes(10))) {
            return false;
        }

        return $this->metersBetween((float) $customer->current_lat, (float) $customer->current_lng, (float) $stop->lat, (float) $stop->lng) <= $radiusMeters;
    }

    private function metersBetween(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadius = 6371000;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return $earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}

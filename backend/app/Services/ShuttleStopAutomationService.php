<?php

namespace App\Services;

use App\Models\CitySetting;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use App\Services\TripStateMachineService;

class ShuttleStopAutomationService
{
    public function __construct(
        private readonly ShuttleRefundService $refunds,
        private readonly NotificationCenter $notifier,
    ) {}

    public function processDriverLocation(int $driverId, float $lat, float $lng, ?Carbon $now = null): void
    {
        $now ??= now();

        $journeys = ShuttleJourney::query()
            ->with(['trip:id,status,driver_id,pickup_lat,pickup_lng,drop_lat,drop_lng,city_id', 'passengerBookings.customer:id,current_lat,current_lng,current_location_updated_at'])
            ->where('driver_id', $driverId)
            ->whereIn('status', ['ASSIGNED', 'IN_PROGRESS'])
            ->whereHas('trip', fn ($q) => $q->whereNotIn('status', ['COMPLETED', 'CANCELLED']))
            ->get();

        foreach ($journeys as $journey) {
            $this->processJourney($journey, $lat, $lng, $now);
        }
    }

    private function processJourney(ShuttleJourney $journey, float $driverLat, float $driverLng, Carbon $now): void
    {
        $trip = $journey->trip;
        if (!$trip) {
            return;
        }

        $settings = CitySetting::query()->where('city_id', $journey->city_id)->first();
        $driverRadius = (int) ($settings?->shuttle_pickup_arrival_radius_m ?? 150);
        $approachingRadius = max($driverRadius, (int) ($settings?->shuttle_approaching_alert_radius_m ?? 500));
        $customerRadius = (int) ($settings?->shuttle_customer_pickup_radius_m ?? 150);
        $waitMinutes = max(0, (int) ($settings?->shuttle_driver_waiting_time_minutes ?? 5));
        $customerGraceMinutes = max(0, (int) ($settings?->shuttle_customer_grace_minutes ?? 2));
        $driverMissedGraceMinutes = max(0, (int) ($settings?->shuttle_driver_missed_pickup_grace_minutes ?? 3));

        foreach ($journey->passengerBookings as $booking) {
            if (!in_array($booking->status, ['CONFIRMED', 'BOARDED'], true)) {
                continue;
            }

            $pickupLat = (float) ($booking->pickup_lat ?? $trip->pickup_lat);
            $pickupLng = (float) ($booking->pickup_lng ?? $trip->pickup_lng);
            $driverDistance = $this->metersBetween($driverLat, $driverLng, $pickupLat, $pickupLng);

            if ($driverDistance <= $approachingRadius && $driverDistance > $driverRadius) {
                $this->notifyApproaching($booking, $now);
            }

            if ($driverDistance <= $driverRadius) {
                $this->markDriverArrived($booking, $now, $waitMinutes);
                $this->maybeMarkCustomerNoShow($booking->fresh('customer'), $now, $customerRadius, $customerGraceMinutes);
                continue;
            }

            $this->maybeMarkDriverMissedPickup($booking, $trip, $driverLat, $driverLng, $customerRadius, $driverMissedGraceMinutes, $now);
        }
    }

    private function markDriverArrived(ShuttlePassengerBooking $booking, Carbon $now, int $waitMinutes): void
    {
        if ($booking->shuttle_pickup_arrived_at) {
            return;
        }

        $booking->forceFill([
            'shuttle_pickup_arrived_at' => $now,
            'shuttle_no_show_after_at' => $now->copy()->addMinutes($waitMinutes),
        ])->save();

        $this->notifyArrived($booking->fresh('customer'), $now);
    }

    private function maybeMarkCustomerNoShow(?ShuttlePassengerBooking $booking, Carbon $now, int $customerRadius, int $customerGraceMinutes): void
    {
        if (!$booking || !in_array($booking->status, ['CONFIRMED', 'BOARDED'], true) || !$booking->shuttle_no_show_after_at) {
            return;
        }

        if ($booking->shuttle_no_show_after_at->greaterThan($now)) {
            if ($booking->shuttle_no_show_after_at->lessThanOrEqualTo($now->copy()->addMinute())) {
                $this->notifyLeavingSoon($booking, $now);
            }
            return;
        }

        if (!$booking->shuttle_leaving_soon_notified_at) {
            $this->notifyLeavingSoon($booking, $now);
            return;
        }

        $customerPresent = $this->customerIsNearPickup($booking, $customerRadius, $now);
        if ($customerPresent && $booking->shuttle_no_show_after_at->copy()->addMinutes($customerGraceMinutes)->greaterThan($now)) {
            return;
        }

        try {
            $updated = $this->refunds->markNoShow($booking, 'customer_no_show');
            $updated->forceFill([
                'shuttle_auto_processed_at' => $now,
                'shuttle_auto_outcome' => 'customer_no_show',
            ])->save();
            $this->cancelLinkedTrip($updated, 'customer_no_show');
            $this->notifyCustomerNoShow($updated->fresh('customer'), $now);
        } catch (\Throwable $e) {
            Log::warning('Shuttle customer no-show automation failed', [
                'booking_id' => $booking->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function maybeMarkDriverMissedPickup(ShuttlePassengerBooking $booking, Trip $trip, float $driverLat, float $driverLng, int $customerRadius, int $driverMissedGraceMinutes, Carbon $now): void
    {
        if ($booking->shuttle_pickup_arrived_at || !$this->customerIsNearPickup($booking, $customerRadius, $now)) {
            return;
        }

        $dropLat = (float) ($booking->drop_lat ?? $trip->drop_lat);
        $dropLng = (float) ($booking->drop_lng ?? $trip->drop_lng);
        $pickupLat = (float) ($booking->pickup_lat ?? $trip->pickup_lat);
        $pickupLng = (float) ($booking->pickup_lng ?? $trip->pickup_lng);
        $driverToPickup = $this->metersBetween($driverLat, $driverLng, $pickupLat, $pickupLng);
        $driverToDrop = $this->metersBetween($driverLat, $driverLng, $dropLat, $dropLng);
        $pickupToDrop = max(1.0, $this->metersBetween($pickupLat, $pickupLng, $dropLat, $dropLng));

        $looksPastPickup = $driverToDrop < $pickupToDrop && $driverToPickup > min(500, max(200, $pickupToDrop * 0.2));
        if (!$looksPastPickup && !$booking->shuttle_driver_missed_after_at) {
            return;
        }

        if ($looksPastPickup && !$booking->shuttle_driver_missed_after_at) {
            $booking->forceFill([
                'shuttle_driver_missed_after_at' => $now->copy()->addMinutes($driverMissedGraceMinutes),
            ])->save();
            $this->notifyAdmins('shuttle_driver_missed_timer_started', 'Possible Shuttle missed pickup', 'Driver may have missed Shuttle booking #' . $booking->id . '. Grace timer started.', $booking, $now, 'alert-triangle');
            return;
        }

        if ($booking->shuttle_driver_missed_after_at && $booking->shuttle_driver_missed_after_at->lessThanOrEqualTo($now)) {
            $booking->forceFill([
                'status' => 'CANCELLED',
                'cancelled_at' => now(),
                'cancelled_reason' => 'driver_missed_pickup',
                'refund_status' => $booking->payment_status === 'PAID' ? 'APPROVED' : 'NONE',
                'shuttle_auto_processed_at' => $now,
                'shuttle_auto_outcome' => 'driver_missed_pickup',
            ])->save();

            $this->cancelLinkedTrip($booking, 'driver_missed_pickup');
            $this->notifyDriverMissedPickup($booking->fresh('customer'), $now);
        }
    }

    private function cancelLinkedTrip(ShuttlePassengerBooking $booking, string $reason): void
    {
        $booking->loadMissing('journey.trip');
        $trip = $booking->journey?->trip;
        if (!$trip || in_array($trip->status, ['COMPLETED', 'CANCELLED'], true)) {
            return;
        }

        try {
            app(TripStateMachineService::class)->transition($trip, 'CANCELLED', [
                'cancelled_reason' => $reason,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Shuttle automation could not cancel linked trip', [
                'booking_id' => $booking->id,
                'trip_id' => $trip->id,
                'reason' => $reason,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function notifyApproaching(ShuttlePassengerBooking $booking, Carbon $now): void
    {
        if ($booking->shuttle_approaching_notified_at) {
            return;
        }
        $booking->forceFill(['shuttle_approaching_notified_at' => $now])->save();
        $this->notifyCustomer($booking, 'shuttle_driver_approaching', 'Shuttle approaching', 'Your Shuttle is near pickup. Please be ready.', 'bus');
    }

    private function notifyArrived(?ShuttlePassengerBooking $booking, Carbon $now): void
    {
        if (!$booking || $booking->shuttle_arrived_notified_at) {
            return;
        }
        $booking->forceFill(['shuttle_arrived_notified_at' => $now])->save();
        $this->notifyCustomer($booking, 'shuttle_driver_arrived', 'Shuttle arrived', 'Your Shuttle has reached pickup. Please board now.', 'map-pin');
    }

    private function notifyLeavingSoon(ShuttlePassengerBooking $booking, Carbon $now): void
    {
        if ($booking->shuttle_leaving_soon_notified_at) {
            return;
        }
        $booking->forceFill(['shuttle_leaving_soon_notified_at' => $now])->save();
        $this->notifyCustomer($booking, 'shuttle_leaving_soon', 'Shuttle leaving soon', 'Your Shuttle waiting time has expired. Please board now.', 'alert-triangle');
    }

    private function notifyCustomerNoShow(?ShuttlePassengerBooking $booking, Carbon $now): void
    {
        if (!$booking) {
            return;
        }
        $this->notifyCustomer($booking, 'shuttle_customer_no_show', 'Marked no-show', 'The Shuttle reached pickup and waiting time expired. This booking is marked no-show.', 'alert-circle');
        $this->notifyAdmins('shuttle_customer_no_show', 'Shuttle customer no-show', 'Booking #' . $booking->id . ' was automatically marked no-show.', $booking, $now, 'alert-circle');
    }

    private function notifyDriverMissedPickup(?ShuttlePassengerBooking $booking, Carbon $now): void
    {
        if (!$booking) {
            return;
        }
        $this->notifyCustomer($booking, 'shuttle_driver_missed_pickup', 'Driver missed pickup', 'Your Shuttle driver missed pickup. Refund is approved for manual Razorpay processing.', 'alert-triangle');
        $this->notifyAdmins('shuttle_driver_missed_pickup', 'Shuttle driver missed pickup', 'Booking #' . $booking->id . ' was cancelled because the driver missed pickup.', $booking, $now, 'alert-triangle');
    }

    private function notifyCustomer(ShuttlePassengerBooking $booking, string $type, string $title, string $body, string $icon): void
    {
        $this->notifier->notifyUserId($booking->customer_id, $type, $title, $body, $this->notificationData($booking), $icon);
    }

    private function notifyAdmins(string $type, string $title, string $body, ShuttlePassengerBooking $booking, Carbon $now, string $icon): void
    {
        $this->notifier->notifyAdmins($type, $title, $body, $this->notificationData($booking) + ['processed_at' => $now->toIso8601String()], $icon);
    }

    private function notificationData(ShuttlePassengerBooking $booking): array
    {
        return [
            'module' => 'shuttle',
            'booking_id' => $booking->id,
            'shuttle_journey_id' => $booking->shuttle_journey_id,
            'trip_id' => $booking->journey?->trip_id,
            'status' => $booking->status,
            'refund_status' => $booking->refund_status,
            'auto_outcome' => $booking->shuttle_auto_outcome,
        ];
    }

    private function customerIsNearPickup(ShuttlePassengerBooking $booking, int $radiusMeters, Carbon $now): bool
    {
        $booking->loadMissing('customer:id,current_lat,current_lng,current_location_updated_at');
        $customer = $booking->customer;
        if (!$customer || $customer->current_lat === null || $customer->current_lng === null || !$customer->current_location_updated_at) {
            return false;
        }
        if ($customer->current_location_updated_at->lt($now->copy()->subMinutes(10))) {
            return false;
        }

        return $this->metersBetween((float) $customer->current_lat, (float) $customer->current_lng, (float) $booking->pickup_lat, (float) $booking->pickup_lng) <= $radiusMeters;
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

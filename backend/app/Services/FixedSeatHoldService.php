<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\FixedSeatHold;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class FixedSeatHoldService
{
    public function __construct(
        private readonly FixedAvailabilityService $availability,
        private readonly FixedPricingService $pricing,
        private readonly WalletService $wallet,
    ) {}

    public function createHold(User $customer, array $data): FixedSeatHold
    {
        $departure = RouteDeparture::query()->with('route')->findOrFail((int) $data['route_departure_id']);
        $seats = max(1, (int) ($data['seats'] ?? 1));
        $extraLuggageCount = max(0, (int) ($data['extra_luggage_count'] ?? (!empty($data['has_extra_luggage']) ? 1 : 0)));
        $hasExtraLuggage = $extraLuggageCount > 0;

        return DB::transaction(function () use ($customer, $departure, $seats, $extraLuggageCount, $hasExtraLuggage) {
            $dep = RouteDeparture::query()->with('route')->lockForUpdate()->find($departure->id);
            if (!$dep) {
                throw new ReservationException('This departure could not be found.', 404);
            }

            $this->availability->assertBookableDeparture($dep, true);
            $route = $dep->route;
            if (!$route) {
                throw new ReservationException('This fixed route is not available.', 404);
            }
            if ($seats > max(1, (int) $route->max_seats_per_booking)) {
                throw new ReservationException('You cannot book that many seats in one fixed booking.', 422);
            }

            $this->availability->releaseCustomerHeldSeats($customer->id, $dep->id);

            $remaining = $this->availability->seatsRemaining($dep);
            if ($remaining < $seats) {
                throw new ReservationException("Only {$remaining} seat(s) are still available.", 422);
            }

            $luggageRemaining = $this->availability->luggageRemaining($dep);
            if ($extraLuggageCount > $luggageRemaining) {
                throw new ReservationException("Only {$luggageRemaining} luggage space(s) are still available.", 422);
            }

            $luggageSurcharge = $hasExtraLuggage ? (float) $route->luggage_surcharge_amount * $extraLuggageCount : 0.0;
            $amount = $this->pricing->bookingAmount($route, $seats, $extraLuggageCount);

            return FixedSeatHold::query()->create([
                'route_departure_id' => $dep->id,
                'customer_id' => $customer->id,
                'seats' => $seats,
                'amount' => $amount,
                'has_extra_luggage' => $hasExtraLuggage,
                'extra_luggage_count' => $extraLuggageCount,
                'luggage_surcharge_amount' => $luggageSurcharge,
                'status' => 'HELD',
                'expires_at' => now()->addMinutes(5),
            ]);
        });
    }

    public function confirmHold(User $customer, FixedSeatHold $hold, array $data): SeatReservation
    {
        return DB::transaction(function () use ($customer, $hold, $data) {
            $lockedHold = FixedSeatHold::query()->lockForUpdate()->find($hold->id);
            if (!$lockedHold || $lockedHold->customer_id !== $customer->id) {
                throw new ReservationException('This seat hold could not be found.', 404);
            }

            $lockedHold = $this->availability->expireHoldIfNeeded($lockedHold);
            if ($lockedHold->status !== 'HELD') {
                throw new ReservationException('This seat hold is no longer active.', 422);
            }

            $dep = RouteDeparture::query()->with('route')->lockForUpdate()->find($lockedHold->route_departure_id);
            if (!$dep) {
                throw new ReservationException('This departure could not be found.', 404);
            }

            $this->availability->assertBookableDeparture($dep, true);
            $remainingForThisHold = $this->availability->seatsRemaining($dep, $lockedHold->id);
            if ($remainingForThisHold < (int) $lockedHold->seats) {
                throw new ReservationException('The held seats are no longer available.', 422);
            }

            $extraLuggageCount = max(0, (int) $lockedHold->extra_luggage_count);
            $luggageRemainingForThisHold = $this->availability->luggageRemaining($dep, $lockedHold->id);
            if ($extraLuggageCount > $luggageRemainingForThisHold) {
                throw new ReservationException('The held extra luggage space is no longer available.', 422);
            }

            $route = $dep->route;
            if (!$route) {
                throw new ReservationException('This fixed route is not available.', 404);
            }

            $paymentMethod = (string) $data['payment_method'];
            $paymentReference = isset($data['payment_reference']) ? trim((string) $data['payment_reference']) : null;
            if ($paymentMethod === 'wallet') {
                User::query()->whereKey($customer->id)->lockForUpdate()->first();
                if ($this->wallet->balance($customer) < (float) $lockedHold->amount) {
                    throw new ReservationException('Insufficient wallet balance for this fixed booking.', 402);
                }
                $this->wallet->recordTransaction(
                    $customer,
                    'debit',
                    (float) $lockedHold->amount,
                    'Fixed route seat — ' . $route->name,
                    $dep->trip_id,
                    null,
                );
            } elseif ($paymentMethod === 'razorpay') {
                if (!$paymentReference) {
                    throw new ReservationException('Payment reference is required for online confirmation.', 422);
                }
            } else {
                throw new ReservationException('Unsupported payment method for fixed booking.', 422);
            }

            $boardStop = $this->resolveStop($route->id, (int) $data['board_stop_id'], 'is_pickup', 'boarding');
            $dropStop = $this->resolveStop($route->id, (int) $data['drop_stop_id'], 'is_drop', 'drop');
            if ((int) $boardStop->seq >= (int) $dropStop->seq) {
                throw new ReservationException('Drop stop must come after the boarding stop.', 422);
            }

            $bookingChannel = $this->resolveChannel((string) $data['booking_channel']);
            $expectedAmount = $this->pricing->bookingAmount($route, (int) $lockedHold->seats, $extraLuggageCount);
            if (round((float) $lockedHold->amount, 2) !== round($expectedAmount, 2)) {
                throw new ReservationException('The hold amount is no longer valid. Please create a new hold.', 409);
            }

            $reservation = SeatReservation::query()->create([
                'route_departure_id' => $dep->id,
                'trip_id' => $dep->trip_id,
                'route_id' => $route->id,
                'customer_id' => $customer->id,
                'seats' => (int) $lockedHold->seats,
                'booking_channel' => $bookingChannel,
                'board_stop_id' => $boardStop->id,
                'board_lat' => (float) $boardStop->lat,
                'board_lng' => (float) $boardStop->lng,
                'board_address' => $boardStop->name,
                'drop_stop_id' => $dropStop->id,
                'drop_lat' => (float) $dropStop->lat,
                'drop_lng' => (float) $dropStop->lng,
                'drop_address' => $dropStop->name,
                'fare_amount' => (float) $lockedHold->amount,
                'payment_method' => $paymentMethod,
                'payment_status' => 'PAID',
                'has_extra_luggage' => $extraLuggageCount > 0,
                'extra_luggage_count' => $extraLuggageCount,
                'luggage_surcharge_amount' => (float) $lockedHold->luggage_surcharge_amount,
                'refund_status' => 'NONE',
                'status' => 'CONFIRMED',
            ]);

            $dep->increment('seats_taken', (int) $lockedHold->seats);
            if ($extraLuggageCount > 0) {
                $dep->increment('luggage_taken', $extraLuggageCount);
            }
            $lockedHold->update([
                'status' => 'CONFIRMED',
                'payment_reference' => $paymentReference,
            ]);

            return $reservation;
        });
    }

    private function resolveChannel(string $requested): string
    {
        if (!in_array($requested, ['advance', 'on_spot'], true)) {
            throw new ReservationException('This fixed route does not allow that booking channel.', 422);
        }

        return $requested;
    }

    private function resolveStop(int $routeId, int $stopId, string $flag, string $label): RouteStop
    {
        $stop = RouteStop::query()->where('route_id', $routeId)->where('id', $stopId)->first();
        if (!$stop || !$stop->{$flag}) {
            throw new ReservationException("That {$label} stop is not valid for this route.", 422);
        }
        if (!$stop->is_active || $stop->is_temporarily_unavailable) {
            throw new ReservationException("That {$label} stop is currently unavailable.", 422);
        }

        return $stop;
    }
}

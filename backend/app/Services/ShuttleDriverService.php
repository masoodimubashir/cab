<?php

namespace App\Services;

use App\Events\ShuttleManifestUpdated;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Module 8B — the driver's multi-passenger pool ride: the manifest (who's on the
 * van, where each gets on/off, their live status) and the per-rider board / drop
 * actions. Each action broadcasts ShuttleManifestUpdated so the driver's live
 * screen and the riders' apps refresh without a poll.
 *
 * Rider lifecycle on a pool: CONFIRMED (paid, waiting) → BOARDED (aboard) →
 * COMPLETED (dropped). CANCELLED / NO_SHOW leave the ride. Boarding modes
 * (5B, driver_only / customer_otp / …) layer on top of board(); driver_only is
 * the built-in tap-to-board with no code.
 */
class ShuttleDriverService
{
    /** Statuses that still count as "on the manifest / needs handling". */
    private const ACTIVE = ['CONFIRMED', 'BOARDED'];

    /**
     * The driver's view of a pool: every rider with their pickup, drop, seat and
     * live status, plus aboard / remaining counts.
     */
    public function manifest(User $driver, ShuttleJourney $journey): array
    {
        $this->guard($driver, $journey);

        $bookings = ShuttlePassengerBooking::query()
            ->where('shuttle_journey_id', $journey->id)
            ->whereIn('status', ['CONFIRMED', 'BOARDED', 'DROPPED', 'NO_SHOW'])
            ->orderBy('id')
            ->get();

        $active = $bookings->whereIn('status', self::ACTIVE);

        return [
            'journey' => [
                'id' => (int) $journey->id,
                'trip_id' => $journey->trip_id ? (int) $journey->trip_id : null,
                'status' => $journey->status,
                'capacity' => (int) $journey->capacity,
            ],
            'aboard' => $active->where('status', 'BOARDED')->count(),
            'remaining' => $active->count(),
            'passengers' => $bookings->map(fn (ShuttlePassengerBooking $b) => $this->shapePassenger($b))->values()->all(),
        ];
    }

    /**
     * Mark a rider aboard. driver_only mode is a plain tap (no code); other modes
     * verify a code before this is reached (layered by the caller/controller).
     */
    public function board(User $driver, ShuttlePassengerBooking $booking, ?string $code = null): ShuttlePassengerBooking
    {
        $journey = $booking->journey;
        $this->guard($driver, $journey);

        if ($booking->status !== 'CONFIRMED') {
            abort(422, 'This passenger cannot be boarded from the current status.');
        }

        $updated = DB::transaction(function () use ($booking) {
            $locked = ShuttlePassengerBooking::query()->lockForUpdate()->findOrFail($booking->id);
            if ($locked->status !== 'CONFIRMED') {
                abort(422, 'This passenger cannot be boarded from the current status.');
            }
            $locked->forceFill(['status' => 'BOARDED', 'boarded_at' => now()])->save();

            return $locked->fresh();
        });

        $this->broadcast($journey);

        return $updated;
    }

    /** Mark a boarded rider dropped at their destination — they leave the pool. */
    public function drop(User $driver, ShuttlePassengerBooking $booking): ShuttlePassengerBooking
    {
        $journey = $booking->journey;
        $this->guard($driver, $journey);

        if ($booking->status !== 'BOARDED') {
            abort(422, 'This passenger must be boarded before drop-off.');
        }

        $updated = DB::transaction(function () use ($booking, $journey) {
            $locked = ShuttlePassengerBooking::query()->lockForUpdate()->findOrFail($booking->id);
            if ($locked->status !== 'BOARDED') {
                abort(422, 'This passenger must be boarded before drop-off.');
            }
            $locked->forceFill(['status' => 'DROPPED', 'dropped_at' => now()])->save();

            $lockedJourney = ShuttleJourney::query()->lockForUpdate()->find($journey->id);
            if ($lockedJourney) {
                $lockedJourney->forceFill([
                    'seats_taken' => max(0, (int) $lockedJourney->seats_taken - (int) $locked->seats),
                ])->save();
            }

            return $locked->fresh();
        });

        $this->broadcast($journey);

        return $updated;
    }

    /**
     * Are all of the pool's riders finished (dropped / cancelled / no-show)? The
     * trip may only be completed once this is true — no one is left aboard.
     */
    public function allRidersFinished(ShuttleJourney $journey): bool
    {
        return ! ShuttlePassengerBooking::query()
            ->where('shuttle_journey_id', $journey->id)
            ->whereIn('status', self::ACTIVE)
            ->exists();
    }

    private function shapePassenger(ShuttlePassengerBooking $b): array
    {
        return [
            'booking_id' => (int) $b->id,
            'name' => $b->customer?->name,
            'seat' => $this->seatLabel($b),
            'status' => $b->status,
            'payment_method' => $b->payment_method,
            'pickup' => ['lat' => (float) $b->pickup_lat, 'lng' => (float) $b->pickup_lng, 'address' => $b->pickup_address],
            'drop' => ['lat' => (float) $b->drop_lat, 'lng' => (float) $b->drop_lng, 'address' => $b->drop_address],
            'boarded_at' => optional($b->boarded_at)->toIso8601String(),
            'dropped_at' => optional($b->dropped_at)->toIso8601String(),
        ];
    }

    private function seatLabel(ShuttlePassengerBooking $b): ?string
    {
        return \App\Models\JourneySeat::query()
            ->where('shuttle_passenger_booking_id', $b->id)
            ->whereIn('status', ['HELD', 'BOOKED'])
            ->orderBy('label')
            ->value('label');
    }

    private function guard(User $driver, ?ShuttleJourney $journey): void
    {
        if (! $journey) {
            abort(404, 'This shuttle pool could not be found.');
        }
        $journey->loadMissing('trip:id,driver_id');
        $tripDriver = $journey->trip?->driver_id;
        if ((int) $journey->driver_id !== (int) $driver->id && (int) $tripDriver !== (int) $driver->id) {
            abort(403, 'This is not your shuttle pool.');
        }
    }

    private function broadcast(ShuttleJourney $journey): void
    {
        if (! $journey->trip_id) {
            return;
        }
        DB::afterCommit(function () use ($journey) {
            broadcast(new ShuttleManifestUpdated((int) $journey->trip_id, (int) $journey->id))->toOthers();
        });
    }
}

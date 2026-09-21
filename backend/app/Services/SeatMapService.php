<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\DepartureSeat;
use App\Models\FixedSeatHold;
use App\Models\FixedSeatHoldSeat;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\VehicleSeatLayout;
use Illuminate\Support\Facades\DB;

/**
 * Owns the seat-level lifecycle for fixed departures:
 *   snapshot  → layout cells copied into departure_seats when driver opens
 *   hold      → AVAILABLE → HELD, link rows written into fixed_seat_hold_seats
 *   book      → HELD → BOOKED, seat_reservation_id set
 *   release   → HELD → AVAILABLE (hold expired / abandoned)
 *   free      → BOOKED → AVAILABLE (customer refunded)
 *
 * The existing hold TTL/concurrency/coupon plumbing (FixedSeatHoldService +
 * FixedAvailabilityService) is unchanged — this service is the per-seat leg
 * layered on top of it via fixed_seat_hold_seats.
 */
class SeatMapService
{
    /**
     * Pick a default layout for a route's city. M6 refines this to match the
     * driver's vehicle-type; M1 just uses "any active layout in this city" so
     * every create-site has a layout to attach.
     */
    public function resolveDefaultLayoutForRoute(Route $route): int
    {
        $id = VehicleSeatLayout::query()
            ->where('city_id', $route->city_id)
            ->where('is_active', true)
            ->orderBy('id')
            ->value('id');

        if (!$id) {
            throw new ReservationException(
                'No seat layout is configured for this city. Ask the operator to design one.',
                422,
            );
        }

        return (int) $id;
    }

    /**
     * Copy the layout's seat cells into departure_seats. Idempotent — if the
     * departure already has snapshotted seats, this is a no-op.
     */
    public function snapshotForDeparture(RouteDeparture $departure): void
    {
        if (DepartureSeat::query()->where('route_departure_id', $departure->id)->exists()) {
            return;
        }

        $layout = $departure->seatLayout()->with('seatCells')->first();
        if (!$layout) {
            throw new ReservationException('This departure has no seat layout attached.', 500);
        }

        $now = now();
        $rows = $layout->seatCells->map(fn ($cell) => [
            'route_departure_id' => $departure->id,
            'vehicle_seat_layout_cell_id' => $cell->id,
            'label' => $cell->label,
            'category' => $cell->category,
            'price_delta' => $cell->price_delta,
            'status' => 'AVAILABLE',
            'seat_reservation_id' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ])->all();

        if (!empty($rows)) {
            DB::table('departure_seats')->insert($rows);
        }
    }

    /**
     * Release all expired holds and restore their seats to AVAILABLE.
     */
    public function releaseExpiredHoldsForDeparture(int $routeDepartureId): int
    {
        $holdStatuses = ['HELD', 'PENDING_DRIVER_APPROVAL', 'ACCEPTED'];

        $expiredHolds = FixedSeatHold::query()
            ->where('route_departure_id', $routeDepartureId)
            ->whereIn('status', $holdStatuses)
            ->where(function ($q) {
                $q->whereNull('expires_at')
                  ->orWhere('expires_at', '<=', now());
            })
            ->get();

        $count = 0;
        foreach ($expiredHolds as $hold) {
            $this->releaseSeats($hold);
            $hold->update(['status' => 'EXPIRED']);
            $count++;
        }

        // Clean up any orphan HELD departure_seats without active valid holds
        $activeHoldIds = FixedSeatHold::query()
            ->where('route_departure_id', $routeDepartureId)
            ->whereIn('status', $holdStatuses)
            ->where('expires_at', '>', now())
            ->pluck('id');

        $activeDepartureSeatIds = FixedSeatHoldSeat::query()
            ->whereIn('fixed_seat_hold_id', $activeHoldIds)
            ->pluck('departure_seat_id');

        DepartureSeat::query()
            ->where('route_departure_id', $routeDepartureId)
            ->where('status', 'HELD')
            ->whereNotIn('id', $activeDepartureSeatIds)
            ->update([
                'status' => 'AVAILABLE',
                'seat_reservation_id' => null,
                'updated_at' => now(),
            ]);

        return $count;
    }

    /**
     * Lock the given labels on the departure for this hold. Transactional +
     * lockForUpdate: two customers holding "2A" at the same time → the second
     * one loses cleanly with a 422.
     *
     * @param string[] $labels
     */
    public function markSeatsHeld(FixedSeatHold $hold, array $labels): void
    {
        if (empty($labels)) {
            throw new ReservationException('Pick at least one seat.', 422);
        }
        $labels = array_values(array_unique($labels));

        // Purge expired holds on this departure before checking seat availability
        $this->releaseExpiredHoldsForDeparture((int) $hold->route_departure_id);

        DB::transaction(function () use ($hold, $labels) {
            $seats = DepartureSeat::query()
                ->where('route_departure_id', $hold->route_departure_id)
                ->whereIn('label', $labels)
                ->lockForUpdate()
                ->get();

            if ($seats->count() !== count($labels)) {
                $found = $seats->pluck('label')->all();
                $missing = array_values(array_diff($labels, $found));
                throw new ReservationException(
                    'Seat '.($missing[0] ?? '?').' is not on this vehicle.',
                    422,
                );
            }

            foreach ($seats as $seat) {
                if ($seat->status !== 'AVAILABLE') {
                    throw new ReservationException(
                        "Seat {$seat->label} is no longer available.",
                        422,
                    );
                }
            }

            $now = now();
            $linkRows = [];
            foreach ($seats as $seat) {
                $seat->status = 'HELD';
                $seat->save();
                $linkRows[] = [
                    'fixed_seat_hold_id' => $hold->id,
                    'departure_seat_id' => $seat->id,
                    'label' => $seat->label,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
            DB::table('fixed_seat_hold_seats')->insert($linkRows);
        });
    }

    /**
     * Flip the hold's seats HELD → BOOKED and bind them to the reservation.
     * Called from FixedSeatHoldService::confirmHold right after the
     * SeatReservation row is created.
     */
    public function markSeatsBooked(FixedSeatHold $hold, SeatReservation $reservation): void
    {
        DB::transaction(function () use ($hold, $reservation) {
            $seatIds = FixedSeatHoldSeat::query()
                ->where('fixed_seat_hold_id', $hold->id)
                ->pluck('departure_seat_id');

            if ($seatIds->isEmpty()) {
                return;
            }

            DepartureSeat::query()
                ->whereIn('id', $seatIds)
                ->lockForUpdate()
                ->update([
                    'status' => 'BOOKED',
                    'seat_reservation_id' => $reservation->id,
                    'updated_at' => now(),
                ]);

            $labels = DepartureSeat::query()
                ->whereIn('id', $seatIds)
                ->orderBy('label')
                ->pluck('label')
                ->all();

            if (!empty($labels)) {
                $reservation->update(['seat_labels' => $labels]);
            }
        });
    }

    /**
     * Free the hold's HELD seats — called when the hold expires, is released,
     * or fails payment. Link rows are dropped so the seats are truly reset.
     */
    public function releaseSeats(FixedSeatHold $hold): void
    {
        DB::transaction(function () use ($hold) {
            $links = FixedSeatHoldSeat::query()
                ->where('fixed_seat_hold_id', $hold->id)
                ->get();

            if ($links->isEmpty()) {
                return;
            }

            $seatIds = $links->pluck('departure_seat_id');

            DepartureSeat::query()
                ->whereIn('id', $seatIds)
                ->where('status', 'HELD')
                ->lockForUpdate()
                ->update([
                    'status' => 'AVAILABLE',
                    'seat_reservation_id' => null,
                    'updated_at' => now(),
                ]);

            FixedSeatHoldSeat::query()
                ->where('fixed_seat_hold_id', $hold->id)
                ->delete();
        });
    }

    /**
     * Render the seat map for the customer picker: the layout's grid + every
     * cell (seat/blocked/aisle) with the live status for seats. Snapshot is
     * idempotent so this is safe to call before any hold has been made.
     *
     * Blocked/aisle cells carry a synthetic status ('BLOCKED' / 'AISLE') so
     * the client can render them without null-checks.
     */
    public function mapForDeparture(RouteDeparture $departure): array
    {
        $this->snapshotForDeparture($departure);
        $this->releaseExpiredHoldsForDeparture((int) $departure->id);

        $layout = $departure->seatLayout()->with('cells')->first();
        if (!$layout) {
            throw new ReservationException('This departure has no seat layout attached.', 500);
        }

        $statusByLabel = DepartureSeat::query()
            ->where('route_departure_id', $departure->id)
            ->get(['label', 'status'])
            ->pluck('status', 'label')
            ->all();

        $cells = $layout->cells->map(function ($cell) use ($statusByLabel) {
            $status = match ($cell->kind) {
                'seat' => $statusByLabel[$cell->label] ?? 'AVAILABLE',
                'blocked' => 'BLOCKED',
                'aisle' => 'AISLE',
            };
            return [
                'row' => (int) $cell->row,
                'col' => (int) $cell->col,
                'kind' => $cell->kind,
                'label' => $cell->label,
                'category' => $cell->category,
                'price_delta' => (float) $cell->price_delta,
                'status' => $status,
            ];
        })->values()->all();

        return [
            'departure' => [
                'id' => (int) $departure->id,
                'route_id' => (int) $departure->route_id,
                'status' => $departure->status,
            ],
            'layout' => [
                'id' => (int) $layout->id,
                'name' => $layout->name,
                'rows' => (int) $layout->rows,
                'cols' => (int) $layout->cols,
            ],
            'cells' => $cells,
        ];
    }

    /**
     * Refund side: flip the reservation's BOOKED seats back to AVAILABLE so
     * the next customer can pick them again.
     *
     * Also drops any leftover `fixed_seat_hold_seats` link rows that pointed
     * to those seats — when a hold graduates HOLD→BOOKED via markSeatsBooked,
     * the link row is NOT deleted (so we can audit "which hold produced this
     * booking"). But once the booking is refunded, those rows must go, else
     * the departure_seat_id unique constraint blocks the next customer from
     * ever holding this seat again.
     */
    public function freeSeatsForReservation(SeatReservation $reservation): void
    {
        $seats = DepartureSeat::query()
            ->where('seat_reservation_id', $reservation->id)
            ->get(['id', 'label']);

        if ($seats->isEmpty()) {
            return;
        }

        $seatIds = $seats->pluck('id');
        $labels = $seats->pluck('label')->filter()->values()->all();

        DB::transaction(function () use ($reservation, $seatIds, $labels) {
            if (!empty($labels) && empty($reservation->seat_labels)) {
                $reservation->update(['seat_labels' => $labels]);
            }

            FixedSeatHoldSeat::query()->whereIn('departure_seat_id', $seatIds)->delete();
            DepartureSeat::query()
                ->whereIn('id', $seatIds)
                ->update([
                    'status' => 'AVAILABLE',
                    'seat_reservation_id' => null,
                    'updated_at' => now(),
                ]);
        });
    }

    /**
     * Driver offline walk-in booking: Lock a specific available seat as BLOCKED.
     */
    public function blockSeatForDeparture(RouteDeparture $departure, string $label): array
    {
        return DB::transaction(function () use ($departure, $label) {
            $this->snapshotForDeparture($departure);

            $seat = DepartureSeat::query()
                ->where('route_departure_id', $departure->id)
                ->where('label', $label)
                ->lockForUpdate()
                ->first();

            if (!$seat) {
                throw new ReservationException("Seat {$label} was not found on this vehicle.", 404);
            }

            if ($seat->status !== 'AVAILABLE') {
                throw new ReservationException("Seat {$label} is already {$seat->status} and cannot be blocked.", 422);
            }

            $seat->status = 'BLOCKED';
            $seat->save();

            // Increment departure seats_taken so customer search/booking reflects reduced capacity
            $lockedDeparture = RouteDeparture::query()
                ->where('id', $departure->id)
                ->lockForUpdate()
                ->first();

            if ($lockedDeparture) {
                $lockedDeparture->increment('seats_taken', 1);
            }

            return $this->mapForDeparture($departure);
        });
    }

    /**
     * Driver offline drop-off: Release a BLOCKED seat back to AVAILABLE for online bookings.
     */
    public function unblockSeatForDeparture(RouteDeparture $departure, string $label): array
    {
        return DB::transaction(function () use ($departure, $label) {
            $this->snapshotForDeparture($departure);

            $seat = DepartureSeat::query()
                ->where('route_departure_id', $departure->id)
                ->where('label', $label)
                ->lockForUpdate()
                ->first();

            if (!$seat) {
                throw new ReservationException("Seat {$label} was not found on this vehicle.", 404);
            }

            if ($seat->status !== 'BLOCKED') {
                throw new ReservationException("Seat {$label} is not blocked (current status: {$seat->status}).", 422);
            }

            $seat->status = 'AVAILABLE';
            $seat->save();

            // Decrement departure seats_taken so customer search/booking sees the freed seat
            $lockedDeparture = RouteDeparture::query()
                ->where('id', $departure->id)
                ->lockForUpdate()
                ->first();

            if ($lockedDeparture) {
                $lockedDeparture->update([
                    'seats_taken' => max(0, (int) $lockedDeparture->seats_taken - 1),
                ]);
            }

            return $this->mapForDeparture($departure);
        });
    }
}

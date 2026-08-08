<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\SeatReservation;
use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * B5 — the customer-refund register. One place that answers "who is owed
 * money, why, and has it been sent yet?" across fixed and shuttle bookings.
 *
 * Money captured by Razorpay is returned MANUALLY by the operator (GPay,
 * bank transfer, or a refund issued from the Razorpay dashboard) — the app
 * never moves it. APPROVED = owed and waiting; REFUNDED = sent and recorded.
 * Wallet-paid bookings never appear as "due": their refund is credited to
 * the customer wallet instantly at cancellation time.
 *
 * Rows are a permanent register, not a disappearing worklist: marked-paid
 * rows stay visible with method, reference, who marked them and when.
 */
class RefundRegisterService
{
    public const METHODS = ['gpay', 'bank', 'razorpay_dashboard', 'cash', 'other'];

    public function __construct(
        private readonly NotificationCenter $notifier,
        private readonly FixedBookingEventService $fixedEvents,
        private readonly CashDepositService $cashDeposit,
    ) {}

    /* ------------------------------------------------------------------ */
    /* Listing                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Everything the operator needs to see: all owed rows plus recent
     * settled ones. $status filters server-side: due | refunded | all.
     *
     * @return array{rows:array,total_due:float,due_count:int}
     */
    public function adminList(string $status = 'all', int $settledLimit = 300): array
    {
        $statuses = match ($status) {
            'due' => ['APPROVED'],
            'refunded' => ['REFUNDED'],
            default => ['APPROVED', 'REFUNDED'],
        };

        $rows = collect()
            ->merge($this->fixedRows(fn ($q) => $q->whereIn('refund_status', $statuses)))
            ->merge($this->shuttleRows(fn ($q) => $q->whereIn('refund_status', $statuses)));

        [$due, $settled] = $rows->partition(fn ($r) => $r['state'] === 'due');
        $due = $due->sortBy('owed_since')->values();          // oldest debt first
        $settled = $settled->sortByDesc('refunded_at')->take($settledLimit)->values();

        return [
            'rows' => $due->concat($settled)->values()->all(),
            'total_due' => round((float) $due->sum('amount'), 2),
            'due_count' => $due->count(),
        ];
    }

    /** The customer's own refunds — includes rejected ones so the "why not" is visible. */
    public function customerList(User $customer): array
    {
        $filter = fn ($q) => $q
            ->where('customer_id', $customer->id)
            ->whereIn('refund_status', ['APPROVED', 'REFUNDED', 'REJECTED']);

        return collect()
            ->merge($this->fixedRows($filter))
            ->merge($this->shuttleRows($filter))
            ->sortByDesc('owed_since')
            ->values()
            ->all();
    }

    /**
     * Refunds on bookings that rode (or were meant to ride) with this
     * driver. Informational only — refunds are paid by the operator from
     * company money, never taken from the driver.
     */
    public function driverList(User $driver): array
    {
        $fixed = $this->fixedRows(fn ($q) => $q
            ->whereIn('refund_status', ['APPROVED', 'REFUNDED'])
            ->whereHas('routeDeparture', fn ($d) => $d->where('driver_id', $driver->id)));

        $shuttle = $this->shuttleRows(fn ($q) => $q
            ->whereIn('refund_status', ['APPROVED', 'REFUNDED'])
            ->whereHas('journey', fn ($j) => $j->where('driver_id', $driver->id)));

        return collect()
            ->merge($fixed)
            ->merge($shuttle)
            ->sortByDesc('owed_since')
            ->values()
            ->all();
    }

    /* ------------------------------------------------------------------ */
    /* Marking a refund as sent                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Records that the operator has sent the money. The amount is LOCKED to
     * what is owed on the booking — it is not an input, so a typo can never
     * over- or under-pay.
     */
    public function markRefunded(string $module, int $id, User $actor, string $method, ?string $reference, ?string $note): array
    {
        if (!in_array($method, self::METHODS, true)) {
            throw new ReservationException('Unknown refund method.', 422);
        }

        return match ($module) {
            'fixed' => $this->markFixedRefunded($id, $actor, $method, $reference, $note),
            'shuttle' => $this->markShuttleRefunded($id, $actor, $method, $reference, $note),
            default => throw new ReservationException('Unknown refund module.', 422),
        };
    }

    private function markFixedRefunded(int $id, User $actor, string $method, ?string $reference, ?string $note): array
    {
        $row = DB::transaction(function () use ($id, $actor, $method, $reference, $note) {
            /** @var SeatReservation|null $res */
            $res = SeatReservation::query()->lockForUpdate()->find($id);
            if (!$res) {
                throw new ReservationException('This fixed booking could not be found.', 404);
            }
            if ($res->refund_status === 'REFUNDED') {
                throw new ReservationException('This refund is already marked as sent.', 409);
            }
            if ($res->refund_status !== 'APPROVED') {
                throw new ReservationException('This booking has no refund due.', 422);
            }

            $res->update([
                'refund_status' => 'REFUNDED',
                'payment_status' => 'REFUNDED',
                'refund_amount' => $res->refund_amount ?? (float) $res->fare_amount,
                'refund_method' => $method,
                'refund_reference' => $reference ?: $res->refund_reference,
                'refund_note' => $note,
                'refunded_by' => $actor->id,
                'refunded_at' => now(),
            ]);

            $this->fixedEvents->record(
                $res,
                'refund_marked_paid',
                'Refund sent to customer',
                'The operator sent the refund manually (' . $this->methodLabel($method) . ') and recorded it in the refund register.',
                [
                    'refund_amount' => $res->refund_amount,
                    'refund_method' => $method,
                    'refund_reference' => $reference,
                ],
                $actor,
            );

            return $res;
        });

        $this->notifyCustomerRefunded(
            (int) $row->customer_id,
            (float) $row->refund_amount,
            $method,
            $reference,
            ['module' => 'fixed', 'reservation_id' => $row->id],
        );

        return $this->shapeFixed($row->fresh(['route:id,name', 'routeDeparture:id,service_date,depart_at,driver_id', 'routeDeparture.driver:id,name', 'customer:id,name,phone', 'boardStop:id,name', 'dropStop:id,name', 'refundedBy:id,name']));
    }

    private function markShuttleRefunded(int $id, User $actor, string $method, ?string $reference, ?string $note): array
    {
        $row = DB::transaction(function () use ($id, $actor, $method, $reference, $note) {
            /** @var ShuttlePassengerBooking|null $booking */
            $booking = ShuttlePassengerBooking::query()->lockForUpdate()->find($id);
            if (!$booking) {
                throw new ReservationException('This Shuttle booking could not be found.', 404);
            }
            if ($booking->refund_status === 'REFUNDED') {
                throw new ReservationException('This refund is already marked as sent.', 409);
            }
            if ($booking->refund_status !== 'APPROVED') {
                throw new ReservationException('This booking has no refund due.', 422);
            }

            $booking->update([
                'refund_status' => 'REFUNDED',
                'payment_status' => 'REFUNDED',
                'refund_amount' => $booking->refund_amount ?? (float) $booking->fare_amount,
                'refund_method' => $method,
                'refund_reference' => $reference ?: $booking->refund_reference,
                'refund_note' => $note,
                'refunded_by' => $actor->id,
                'refunded_at' => now(),
            ]);

            return $booking;
        });

        $this->notifyCustomerRefunded(
            (int) $row->customer_id,
            (float) $row->refund_amount,
            $method,
            $reference,
            ['module' => 'shuttle', 'shuttle_booking_id' => $row->id],
        );

        return $this->shapeShuttle($row->fresh(['customer:id,name,phone', 'journey:id,driver_id,trip_id', 'journey.driver:id,name', 'refundedBy:id,name']));
    }

    private function notifyCustomerRefunded(int $customerId, float $amount, string $method, ?string $reference, array $data): void
    {
        $body = 'Your refund of ₹' . number_format($amount, 2) . ' has been sent via ' . $this->methodLabel($method) . '.'
            . ($reference ? ' Reference: ' . $reference . '.' : '');

        $this->notifier->notifyUserId(
            $customerId,
            'refund_completed',
            'Refund sent ✓',
            $body,
            $data + ['refund_amount' => $amount, 'refund_method' => $method, 'refund_reference' => $reference],
            'check-circle',
        );
    }

    /* ------------------------------------------------------------------ */
    /* Row shaping                                                         */
    /* ------------------------------------------------------------------ */

    private function fixedRows(callable $filter): array
    {
        $query = SeatReservation::query()
            ->with([
                'route:id,name',
                'routeDeparture:id,service_date,depart_at,driver_id',
                'routeDeparture.driver:id,name',
                'customer:id,name,phone',
                'boardStop:id,name',
                'dropStop:id,name',
                'refundedBy:id,name',
            ]);
        $filter($query);

        return $query->orderByDesc('id')->limit(1000)->get()
            ->map(fn (SeatReservation $r) => $this->shapeFixed($r))
            ->all();
    }

    private function shuttleRows(callable $filter): array
    {
        $query = ShuttlePassengerBooking::query()
            ->with([
                'customer:id,name,phone',
                'journey:id,driver_id,trip_id',
                'journey.driver:id,name',
                'refundedBy:id,name',
            ]);
        $filter($query);

        return $query->orderByDesc('id')->limit(1000)->get()
            ->map(fn (ShuttlePassengerBooking $b) => $this->shapeShuttle($b))
            ->all();
    }

    private function shapeFixed(SeatReservation $r): array
    {
        $board = $r->boardStop?->name;
        $drop = $r->dropStop?->name;
        $tripLabel = ($r->route?->name ?: 'Fixed route')
            . ($board && $drop ? " ({$board} → {$drop})" : '');

        [$cashDeposit, $cashBalance] = $this->cashSplit(
            (string) $r->payment_method,
            (float) $r->fare_amount,
            $r->refund_amount !== null ? (float) $r->refund_amount : null,
        );

        return $this->baseRow(
            module: 'fixed',
            id: $r->id,
            customer: $r->customer,
            driverName: $r->routeDeparture?->driver?->name,
            tripLabel: $tripLabel,
            travelDate: $r->routeDeparture?->service_date ? substr((string) $r->routeDeparture->service_date, 0, 10) : null,
            reason: $this->fixedReason($r),
            paymentMethod: (string) $r->payment_method,
            fareAmount: (float) $r->fare_amount,
            refundStatus: (string) $r->refund_status,
            refundAmount: $r->refund_amount,
            cashDeposit: $cashDeposit,
            cashBalance: $cashBalance,
            refundMethod: $r->refund_method,
            refundReference: $r->refund_reference,
            refundNote: $r->refund_note,
            refundedByName: $r->refundedBy?->name,
            refundedAt: $r->refunded_at,
            owedSince: $r->cancelled_at ?? $r->updated_at,
            createdAt: $r->created_at,
        );
    }

    private function shapeShuttle(ShuttlePassengerBooking $b): array
    {
        $tripLabel = 'Shuttle'
            . ($b->pickup_address && $b->drop_address
                ? ' (' . $this->shortPlace($b->pickup_address) . ' → ' . $this->shortPlace($b->drop_address) . ')'
                : '');

        [$cashDeposit, $cashBalance] = $this->cashSplit(
            (string) ($b->payment_method ?: 'razorpay'),
            (float) $b->fare_amount,
            $b->refund_amount !== null ? (float) $b->refund_amount : null,
        );

        return $this->baseRow(
            module: 'shuttle',
            id: $b->id,
            customer: $b->customer,
            driverName: $b->journey?->driver?->name,
            tripLabel: $tripLabel,
            travelDate: optional($b->created_at)->toDateString(),
            reason: $this->shuttleReason($b),
            paymentMethod: (string) ($b->payment_method ?: 'razorpay'),
            fareAmount: (float) $b->fare_amount,
            refundStatus: (string) $b->refund_status,
            refundAmount: $b->refund_amount,
            cashDeposit: $cashDeposit,
            cashBalance: $cashBalance,
            refundMethod: $b->refund_method,
            refundReference: $b->refund_reference,
            refundNote: $b->refund_note,
            refundedByName: $b->refundedBy?->name,
            refundedAt: $b->refunded_at,
            owedSince: $b->cancelled_at ?? $b->updated_at,
            createdAt: $b->created_at,
        );
    }

    private function baseRow(
        string $module,
        int $id,
        ?User $customer,
        ?string $driverName,
        string $tripLabel,
        ?string $travelDate,
        string $reason,
        string $paymentMethod,
        float $fareAmount,
        string $refundStatus,
        ?float $refundAmount,
        ?string $refundMethod,
        ?string $refundReference,
        ?string $refundNote,
        ?string $refundedByName,
        $refundedAt,
        $owedSince,
        $createdAt,
        ?float $cashDeposit = null,
        ?float $cashBalance = null,
    ): array {
        $state = match ($refundStatus) {
            'APPROVED' => 'due',
            'REFUNDED' => 'refunded',
            'REJECTED' => 'rejected',
            default => 'none',
        };

        // Old razorpay-issued refunds carry a rfnd_ reference but no method.
        if (!$refundMethod && $refundReference && str_starts_with($refundReference, 'rfnd_')) {
            $refundMethod = 'razorpay';
        }

        // A cash booking only put its deposit online, so THAT is the amount the
        // register tracks — the balance was cash to the driver and never flows
        // through a refund here (a physical-cash dispute is handled manually).
        $isCash = strtolower($paymentMethod) === 'cash';

        return [
            'key' => $module . ':' . $id,
            'module' => $module,
            'id' => $id,
            'customer_id' => $customer?->id,
            'customer_name' => $customer?->name,
            'customer_phone' => $customer?->phone,
            'driver_name' => $driverName,
            'trip_label' => $tripLabel,
            'travel_date' => $travelDate,
            'reason' => $reason,
            'payment_method' => $paymentMethod,
            'is_cash' => $isCash,
            'cash_deposit' => $isCash && $cashDeposit !== null ? round($cashDeposit, 2) : null,
            'cash_balance' => $isCash && $cashBalance !== null ? round($cashBalance, 2) : null,
            'amount' => round($isCash && $cashDeposit !== null ? $cashDeposit : ($refundAmount ?? $fareAmount), 2),
            'state' => $state,
            'refund_status' => $refundStatus,
            'refund_method' => $refundMethod,
            'refund_method_label' => $refundMethod ? $this->methodLabel($refundMethod) : null,
            'refund_reference' => $refundReference,
            'refund_note' => $refundNote,
            'refunded_by_name' => $refundedByName,
            'refunded_at' => optional($refundedAt)->toIso8601String(),
            'owed_since' => optional($owedSince)->toIso8601String(),
            'created_at' => optional($createdAt)->toIso8601String(),
        ];
    }

    /**
     * The online-deposit / cash-balance split for a cash booking, for display.
     * Prefers the exact deposit recorded on the refund (what actually went back
     * online); otherwise quotes it from the operator's current percentage. The
     * balance is the cash the driver was to collect — never auto-refunded.
     *
     * @return array{0:?float,1:?float} [deposit, balance] — [null, null] if not cash
     */
    private function cashSplit(string $paymentMethod, float $fare, ?float $refundAmount): array
    {
        if (strtolower($paymentMethod) !== 'cash') {
            return [null, null];
        }

        $deposit = $refundAmount !== null && $refundAmount > 0
            ? round($refundAmount, 2)
            : $this->cashDeposit->quote($fare)['deposit'];
        $deposit = min($deposit, max(0.0, $fare));

        return [$deposit, round(max(0.0, $fare - $deposit), 2)];
    }

    private function fixedReason(SeatReservation $r): string
    {
        if ($r->status === 'NO_SHOW') {
            return 'Customer did not board (no-show)';
        }

        return match ($r->rating_comment) {
            'driver_missed_stop' => 'Driver missed the pickup stop',
            'admin_passenger_cancelled' => 'Operator cancelled the passenger booking',
            'admin_vehicle_cancelled' => 'Operator cancelled the departure',
            'operator_cancelled' => 'Operator cancelled the booking',
            default => $r->status === 'CANCELLED' ? 'Customer cancelled the booking' : 'Booking cancelled',
        };
    }

    private function shuttleReason(ShuttlePassengerBooking $b): string
    {
        if ($b->status === 'NO_SHOW') {
            return 'Customer did not board (no-show)';
        }
        if ($b->cancelled_reason) {
            return ucfirst(str_replace('_', ' ', $b->cancelled_reason));
        }

        return $b->status === 'CANCELLED' ? 'Booking cancelled' : 'Shuttle booking refund';
    }

    private function shortPlace(?string $address): string
    {
        $first = trim(explode(',', (string) $address)[0] ?? '');

        return $first !== '' ? $first : 'Point';
    }

    public function methodLabel(string $method): string
    {
        return match ($method) {
            'gpay' => 'GPay / UPI',
            'bank' => 'Bank transfer',
            'razorpay_dashboard' => 'Razorpay dashboard',
            'cash' => 'Cash',
            'razorpay' => 'Razorpay (auto)',
            'wallet' => 'DreamCabs wallet',
            default => 'Other',
        };
    }
}

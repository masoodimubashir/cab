<?php

namespace App\Services;

use App\Models\SeatReservation;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;

/**
 * Boarding OTP for fixed rides.
 *
 * Flow: driver taps "Board" → send() generates a 4-digit code and shows it on
 * the customer's OWN booking screen (the permanent channel — no SMS; email/push
 * still ride the operator toggles via NotificationCenter) → driver types the
 * code the customer reads out → verify() confirms it and board() flips the seat
 * to BOARDED.
 *
 * Safety rails (mirrors PhoneOtpService): code stored hashed with a TTL,
 * 30s resend cooldown, and MAX_ATTEMPTS wrong tries locks the reservation
 * for LOCKOUT_MINUTES so a driver can't brute-force 0000–9999.
 */
class FixedBoardingOtpService
{
    public const RESEND_COOLDOWN_SEC = 30;
    public const MAX_ATTEMPTS = 3;
    public const LOCKOUT_MINUTES = 5;
    public const TTL_MINUTES = 10;

    /**
     * Cache key for the plaintext code shown on the customer's booking screen.
     * This is the boarding code's delivery channel: the customer reads it off
     * their own screen and tells it to the driver. No SMS is sent.
     */
    public static function codeCacheKey(int $reservationId): string
    {
        return "fixed:boarding-code:{$reservationId}";
    }

    public function __construct(
        private readonly NotificationCenter $notifier,
    ) {
    }

    /**
     * Generate + dispatch a fresh code to the reservation's customer.
     *
     * Returns:
     *   ['sent' => true,  'dev_code' => '1234'|null]   on success (dev_code only in SMS mock mode)
     *   ['sent' => false, 'retry_after' => <sec>]      resend cooldown still running
     *   ['sent' => false, 'locked_for' => <sec>]       reservation locked after too many wrong tries
     */
    public function send(SeatReservation $reservation): array
    {
        if ($locked = $this->lockedForSeconds($reservation)) {
            return ['sent' => false, 'locked_for' => $locked];
        }

        if ($reservation->boarding_otp_last_sent_at) {
            $elapsed = (int) $reservation->boarding_otp_last_sent_at->diffInSeconds(now());
            if ($elapsed < self::RESEND_COOLDOWN_SEC) {
                return ['sent' => false, 'retry_after' => self::RESEND_COOLDOWN_SEC - $elapsed];
            }
        }

        $code = str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);

        // A fresh code resets the attempt counter (fresh 3 tries), but any
        // active lockout above still stands — resend is no escape hatch.
        $reservation->forceFill([
            'boarding_otp_hash' => Hash::make($code),
            'boarding_otp_attempts' => 0,
            'boarding_otp_expires_at' => now()->addMinutes(self::TTL_MINUTES),
            'boarding_otp_last_sent_at' => now(),
        ])->save();

        $customer = $reservation->customer;
        $body = "Your boarding code is {$code}. Tell it to the driver only when you board the vehicle — do not share it with anyone before that.";

        // Delivery: the code is shown on the customer's OWN booking screen
        // (FixedBookingService exposes it as `boarding_code`, read from this
        // cache). This is the permanent channel — NO SMS is sent. The cache TTL
        // matches the code's own expiry.
        Cache::put(self::codeCacheKey($reservation->id), $code, now()->addMinutes(self::TTL_MINUTES));

        // In-app + push (per-user unsubscribe respected) + email (operator
        // fixed_* email toggles, via OperatorNotificationDeliveryService).
        if ($customer) {
            $this->notifier->notify(
                $customer,
                'fixed_boarding_otp',
                'Boarding code',
                $body,
                [
                    'reservation_id' => $reservation->id,
                    'route_departure_id' => $reservation->route_departure_id,
                ],
            );
        }

        return ['sent' => true];
    }

    /**
     * Check a driver-typed code. Consumes the OTP on success.
     *
     * Returns:
     *   ['ok' => true]
     *   ['ok' => false, 'error' => 'locked',  'locked_for' => <sec>]
     *   ['ok' => false, 'error' => 'expired']                      no active code / TTL passed
     *   ['ok' => false, 'error' => 'wrong',   'attempts_left' => n] (locks when n hits 0)
     */
    public function verify(SeatReservation $reservation, string $code): array
    {
        if ($locked = $this->lockedForSeconds($reservation)) {
            return ['ok' => false, 'error' => 'locked', 'locked_for' => $locked];
        }

        if (!$reservation->boarding_otp_hash
            || !$reservation->boarding_otp_expires_at
            || $reservation->boarding_otp_expires_at->isPast()) {
            return ['ok' => false, 'error' => 'expired'];
        }

        if (Hash::check(trim($code), $reservation->boarding_otp_hash)) {
            $this->clear($reservation);
            return ['ok' => true];
        }

        $attempts = (int) $reservation->boarding_otp_attempts + 1;
        if ($attempts >= self::MAX_ATTEMPTS) {
            // Third strike: lock the reservation and burn the code — after the
            // cooldown the driver must resend, not keep guessing the old code.
            $reservation->forceFill([
                'boarding_otp_hash' => null,
                'boarding_otp_attempts' => 0,
                'boarding_otp_expires_at' => null,
                'boarding_otp_locked_until' => now()->addMinutes(self::LOCKOUT_MINUTES),
            ])->save();
            Cache::forget(self::codeCacheKey($reservation->id));

            return ['ok' => false, 'error' => 'locked', 'locked_for' => self::LOCKOUT_MINUTES * 60];
        }

        $reservation->forceFill(['boarding_otp_attempts' => $attempts])->save();

        return ['ok' => false, 'error' => 'wrong', 'attempts_left' => self::MAX_ATTEMPTS - $attempts];
    }

    /** Seconds of lockout remaining, or 0 when not locked. */
    private function lockedForSeconds(SeatReservation $reservation): int
    {
        $until = $reservation->boarding_otp_locked_until;
        if (!$until || $until->isPast()) {
            return 0;
        }
        return max(1, (int) now()->diffInSeconds($until));
    }

    private function clear(SeatReservation $reservation): void
    {
        $reservation->forceFill([
            'boarding_otp_hash' => null,
            'boarding_otp_attempts' => 0,
            'boarding_otp_expires_at' => null,
            'boarding_otp_locked_until' => null,
        ])->save();
        Cache::forget(self::codeCacheKey($reservation->id));
    }
}

<?php

namespace App\Services;

use App\Models\ShuttlePassengerBooking;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;

/**
 * Boarding OTP for shuttle pool riders — the shuttle mirror of
 * FixedBoardingOtpService. The code is SYSTEM-GENERATED and shown on the
 * customer's OWN booking screen (read from the cache below) — there is NO SMS
 * (no MSG91). The rider reads the code out and the driver types it.
 *
 * Safety rails: code stored hashed with a TTL, 30s resend cooldown, and
 * MAX_ATTEMPTS wrong tries locks the booking for LOCKOUT_MINUTES.
 */
class ShuttleBoardingOtpService
{
    public const RESEND_COOLDOWN_SEC = 30;
    public const MAX_ATTEMPTS = 3;
    public const LOCKOUT_MINUTES = 5;
    public const TTL_MINUTES = 15;

    /** Cache key for the plaintext code shown on the customer's booking screen. */
    public static function codeCacheKey(int $bookingId): string
    {
        return "shuttle:boarding-code:{$bookingId}";
    }

    public function __construct(private readonly NotificationCenter $notifier) {}

    /**
     * Generate a fresh code and surface it to the rider (in-app screen + push).
     *
     * @return array{sent:bool,retry_after?:int,locked_for?:int}
     */
    public function send(ShuttlePassengerBooking $booking): array
    {
        if ($locked = $this->lockedForSeconds($booking)) {
            return ['sent' => false, 'locked_for' => $locked];
        }

        if ($booking->boarding_otp_last_sent_at) {
            $elapsed = (int) $booking->boarding_otp_last_sent_at->diffInSeconds(now());
            if ($elapsed < self::RESEND_COOLDOWN_SEC) {
                return ['sent' => false, 'retry_after' => self::RESEND_COOLDOWN_SEC - $elapsed];
            }
        }

        $code = str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);

        $booking->forceFill([
            'boarding_otp_hash' => Hash::make($code),
            'boarding_otp_attempts' => 0,
            'boarding_otp_expires_at' => now()->addMinutes(self::TTL_MINUTES),
            'boarding_otp_last_sent_at' => now(),
        ])->save();

        // The customer's own booking screen is the delivery channel (exposed as
        // `boarding_code`, read from this cache) — no SMS.
        Cache::put(self::codeCacheKey($booking->id), $code, now()->addMinutes(self::TTL_MINUTES));

        if ($booking->customer) {
            $this->notifier->notify(
                $booking->customer,
                'shuttle_boarding_otp',
                'Boarding code',
                "Your boarding code is {$code}. Show it to the driver only when you board the vehicle.",
                ['booking_id' => $booking->id, 'shuttle_journey_id' => $booking->shuttle_journey_id],
            );
        }

        // Live nudge so the rider's active-ride screen pops the full-screen prompt
        // instantly instead of waiting for its next poll.
        $tripId = $booking->journey?->trip_id;
        if ($tripId) {
            broadcast(new \App\Events\ShuttleBoardingCodeReady((int) $tripId));
        }

        return ['sent' => true];
    }

    /**
     * Check a driver-typed / scanned code. Consumes the code on success.
     *
     * @return array{ok:bool,error?:string,locked_for?:int,attempts_left?:int}
     */
    public function verify(ShuttlePassengerBooking $booking, string $code): array
    {
        if ($locked = $this->lockedForSeconds($booking)) {
            return ['ok' => false, 'error' => 'locked', 'locked_for' => $locked];
        }

        if (! $booking->boarding_otp_hash
            || ! $booking->boarding_otp_expires_at
            || $booking->boarding_otp_expires_at->isPast()) {
            return ['ok' => false, 'error' => 'expired'];
        }

        if (Hash::check(trim($code), $booking->boarding_otp_hash)) {
            $this->clear($booking);

            return ['ok' => true];
        }

        $attempts = (int) $booking->boarding_otp_attempts + 1;
        if ($attempts >= self::MAX_ATTEMPTS) {
            $booking->forceFill([
                'boarding_otp_hash' => null,
                'boarding_otp_attempts' => 0,
                'boarding_otp_expires_at' => null,
                'boarding_otp_locked_until' => now()->addMinutes(self::LOCKOUT_MINUTES),
            ])->save();
            Cache::forget(self::codeCacheKey($booking->id));

            return ['ok' => false, 'error' => 'locked', 'locked_for' => self::LOCKOUT_MINUTES * 60];
        }

        $booking->forceFill(['boarding_otp_attempts' => $attempts])->save();

        return ['ok' => false, 'error' => 'wrong', 'attempts_left' => self::MAX_ATTEMPTS - $attempts];
    }

    /** The plaintext code for the customer's own screen (null once consumed/expired). */
    public function codeForCustomer(ShuttlePassengerBooking $booking): ?string
    {
        return Cache::get(self::codeCacheKey($booking->id));
    }

    private function lockedForSeconds(ShuttlePassengerBooking $booking): int
    {
        $until = $booking->boarding_otp_locked_until;
        if (! $until || $until->isPast()) {
            return 0;
        }

        return max(1, (int) now()->diffInSeconds($until));
    }

    private function clear(ShuttlePassengerBooking $booking): void
    {
        $booking->forceFill([
            'boarding_otp_hash' => null,
            'boarding_otp_attempts' => 0,
            'boarding_otp_expires_at' => null,
            'boarding_otp_locked_until' => null,
        ])->save();
        Cache::forget(self::codeCacheKey($booking->id));
    }
}

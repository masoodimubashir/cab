<?php

namespace App\Services;

use App\Models\CitySetting;
use App\Models\PhoneOtp;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;

/**
 * Server-side login OTP: generates a 6-digit code, stores it hashed with an
 * expiry + attempt counter, sends it via MSG91, and verifies it. Replaces the
 * Firebase client-side OTP so the operator's "Login OTP message" template is
 * finally used.
 */
class PhoneOtpService
{
    public function __construct(private Msg91Service $msg91)
    {
    }

    /**
     * Generate + send an OTP. Returns:
     *   ['sent' => true, 'dev_code' => '123456'|null]            on success
     *   ['sent' => false, 'cooldown' => <seconds>]              when asked again too soon
     *
     * dev_code is only included in MOCK mode (no MSG91 key) so the flow is testable.
     */
    public function start(string $phone, ?string $platform = null): array
    {
        $phone = $this->normalize($phone);
        $cooldown = (int) config('services.msg91.resend_cooldown_sec', 30);

        $existing = PhoneOtp::query()->where('phone', $phone)->first();
        if ($existing && $existing->last_sent_at) {
            $elapsed = $existing->last_sent_at->diffInSeconds(Carbon::now());
            if ($elapsed < $cooldown) {
                return ['sent' => false, 'cooldown' => $cooldown - $elapsed];
            }
        }

        // Cryptographically-strong 6-digit code.
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $ttlMin = (int) config('services.msg91.otp_ttl_min', 5);

        PhoneOtp::query()->updateOrCreate(
            ['phone' => $phone],
            [
                'code_hash' => Hash::make($code),
                'attempts' => 0,
                'expires_at' => Carbon::now()->addMinutes($ttlMin),
                'last_sent_at' => Carbon::now(),
            ],
        );

        $message = $this->buildMessage($code, $platform, $ttlMin);
        $this->msg91->sendOtp($phone, $code, $message);

        return [
            'sent' => true,
            // Only leak the code when no real SMS went out (mock mode).
            'dev_code' => $this->msg91->isLive() ? null : $code,
        ];
    }

    /**
     * Verify a submitted code. Consumes the OTP on success. Enforces expiry +
     * a max-attempts cap.
     */
    public function verify(string $phone, string $code): bool
    {
        $phone = $this->normalize($phone);
        $row = PhoneOtp::query()->where('phone', $phone)->first();

        if (!$row || $row->expires_at->isPast()) {
            return false;
        }
        if ($row->attempts >= (int) config('services.msg91.max_attempts', 5)) {
            return false;
        }

        $row->increment('attempts');

        if (!Hash::check(trim($code), $row->code_hash)) {
            return false;
        }

        $row->delete(); // single-use
        return true;
    }

    /**
     * Build the SMS text. Uses the operator's per-city "Login OTP message"
     * template (Android/iOS variant) when one is set, else a default. Login has
     * no city context, so we use the first city that has a template configured.
     */
    private function buildMessage(string $code, ?string $platform, int $ttlMin): string
    {
        $column = $platform === 'ios' ? 'customer_login_otp_message_ios' : 'customer_login_otp_message';

        $template = CitySetting::query()->whereNotNull($column)->value($column)
            ?: CitySetting::query()->whereNotNull('customer_login_otp_message')->value('customer_login_otp_message')
            ?: (string) config('services.msg91.default_message');

        return str_replace(
            ['{otp}', '##OTP##', '{{otp}}', '{ttl}'],
            [$code, $code, $code, (string) $ttlMin],
            $template,
        );
    }

    private function normalize(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        return $phone !== '' && $phone[0] === '+' ? '+' . $digits : $digits;
    }
}

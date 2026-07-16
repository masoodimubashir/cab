<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Thin wrapper around the MSG91 SMS gateway. ALL network specifics live here —
 * to change the API/template later you only touch this one method.
 *
 * MOCK MODE: when MSG91_AUTH_KEY is blank, no SMS is sent — the code is logged
 * (storage/logs/laravel.log) and reported as sent, so the full OTP flow is
 * testable without real credentials.
 */
class Msg91Service
{
    /** True when real credentials are configured (i.e. real SMS will be sent). */
    public function isLive(): bool
    {
        return (string) config('services.msg91.authkey') !== '';
    }

    /**
     * Send the OTP code to a phone. Returns true on success (always true in mock
     * mode). $previewMessage is the human-readable text (used for the mock log
     * and for gateways that accept a raw body).
     */
    public function sendOtp(string $phone, string $code, string $previewMessage): bool
    {
        return $this->sendCode($phone, $code, $previewMessage, (string) config('services.msg91.template_id'));
    }

    /** True once MSG91_BOARDING_TEMPLATE_ID is filled (boarding DLT template approved). */
    public function hasBoardingTemplate(): bool
    {
        return (string) config('services.msg91.boarding_template_id') !== '';
    }

    /**
     * Boarding-code SMS. Sends ONLY when the dedicated boarding DLT template
     * is configured (MSG91_BOARDING_TEMPLATE_ID). While it's blank — i.e.
     * until the template is "Verified by DLT" — NO SMS goes out at all (we
     * don't reuse the login template: wrong wording + per-SMS cost); instead
     * FixedBoardingOtpService surfaces the code on the customer's own booking
     * screen as the testing bridge.
     */
    public function sendBoardingOtp(string $phone, string $code, string $previewMessage): bool
    {
        if (!$this->hasBoardingTemplate()) {
            Log::info('[msg91] boarding OTP SMS skipped — boarding template not configured (code shown in customer app instead)', [
                'phone' => $this->normalizeMobile($phone),
            ]);
            return false;
        }

        return $this->sendCode($phone, $code, $previewMessage, (string) config('services.msg91.boarding_template_id'));
    }

    private function sendCode(string $phone, string $code, string $previewMessage, string $templateId): bool
    {
        $mobile = $this->normalizeMobile($phone);

        if (!$this->isLive()) {
            Log::info('[msg91:mock] OTP SMS (no auth key — not actually sent)', [
                'phone' => $mobile,
                'code' => $code,
                'message' => $previewMessage,
            ]);
            return true;
        }

        $otpVar = (string) (config('services.msg91.otp_var') ?: 'otp');

        try {
            // Force IPv4: MSG91's IP-security whitelist holds our IPv4 address,
            // but dual-stack networks (e.g. Jio) prefer IPv6 outbound, which MSG91
            // then rejects with "IP not whitelisted". Residential IPv6 prefixes
            // also rotate, so pinning the request to IPv4 keeps the whitelist stable.
            $response = Http::asJson()
                ->withOptions(['force_ip_resolve' => 'v4'])
                ->withHeaders([
                    'authkey' => (string) config('services.msg91.authkey'),
                    'accept' => 'application/json',
                ])
                ->post((string) config('services.msg91.flow_url'), [
                    'template_id' => $templateId,
                    'sender' => (string) config('services.msg91.sender'),
                    'recipients' => [
                        [
                            'mobiles' => $mobile,
                            $otpVar => $code,
                        ],
                    ],
                ]);

            if (!$response->successful()) {
                Log::warning('[msg91] OTP send failed', [
                    'phone' => $mobile,
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);
                return false;
            }

            return true;
        } catch (\Throwable $e) {
            Log::warning('[msg91] OTP send exception', [
                'phone' => $mobile,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /** MSG91 wants country-code + number, digits only (no '+', spaces or dashes). */
    private function normalizeMobile(string $phone): string
    {
        return preg_replace('/\D+/', '', $phone) ?? '';
    }
}

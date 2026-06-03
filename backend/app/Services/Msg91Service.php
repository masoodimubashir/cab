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
            $response = Http::asJson()
                ->withHeaders([
                    'authkey' => (string) config('services.msg91.authkey'),
                    'accept' => 'application/json',
                ])
                ->post((string) config('services.msg91.flow_url'), [
                    'template_id' => (string) config('services.msg91.template_id'),
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

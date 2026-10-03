<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Thin wrapper around the MSG91 SMS gateway. ALL network specifics live here —
 * to change the API/template later you only touch this one method.
 *
 * Missing credentials fail without logging or returning the OTP.
 */
class Msg91Service
{
    /** True when real credentials are configured (i.e. real SMS will be sent). */
    public function isLive(): bool
    {
        return (string) config('services.msg91.authkey') !== '';
    }

    /**
     * Send the OTP code to a phone. Returns true only when the gateway succeeds.
     */
    public function sendOtp(string $phone, string $code, string $previewMessage): bool
    {
        return $this->sendCode($phone, $code, $previewMessage, (string) config('services.msg91.template_id'));
    }

    private function sendCode(string $phone, string $code, string $previewMessage, string $templateId): bool
    {
        $mobile = $this->normalizeMobile($phone);

        if (!$this->isLive()) {
            return false;
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

            // MSG91's v5 flow API returns HTTP 200 even when it REJECTS the send
            // (bad template, IP-not-whitelisted, insufficient balance, …) and puts
            // the real outcome in the body: {"type":"success"|"error","message":…}.
            // So HTTP-2xx alone does NOT mean delivered — inspect the body's type.
            $type = strtolower((string) ($response->json('type') ?? ''));
            $ok = $response->successful() && $type === 'success';

            if (!$ok) {
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

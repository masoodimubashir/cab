<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * Stub SMS provider. Wire this to Twilio / MSG91 / etc. when ready.
 * For now it just logs — admin send flow returns "queued" so the UI works end-to-end.
 */
class SmsService
{
    public function send(string $phone, string $body): bool
    {
        if ($phone === '') {
            return false;
        }

        Log::info('SMS (stub)', ['to' => $phone, 'body' => $body]);
        return true;
    }
}

<?php

namespace App\Services;

use App\Models\OperatorSetting;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class OperatorNotificationDeliveryService
{
    private const CUSTOMER_SMS_TYPES = [
        "fixed_booking_confirmed",
        "fixed_booking_cancelled",
        "fixed_booking_cancelled_by_admin",
        "fixed_driver_missed_pickup",
        "fixed_driver_missed_stop",
        "fixed_driver_arrived",
        "fixed_customer_no_show",
    ];

    private const CUSTOMER_EMAIL_TYPES = [
        "fixed_booking_confirmed",
        "fixed_booking_cancelled",
        "fixed_booking_cancelled_by_admin",
        "fixed_driver_missed_pickup",
        "fixed_driver_missed_stop",
        "fixed_customer_no_show",
    ];

    private const DRIVER_SMS_TYPES = [
        "fixed_vehicle_cancelled",
        "fixed_admin_cancelled_booking",
        "fixed_bookings_closed",
        "fixed_customer_cancelled",
    ];

    private const DRIVER_EMAIL_TYPES = [
        "fixed_vehicle_completed",
    ];

    private const ADMIN_SMS_TYPES = [
        "fixed_driver_missed_pickup",
        "fixed_driver_missed_stop",
        "fixed_driver_missed_pickup",
        "fixed_customer_no_show",
        "fixed_vehicle_cancelled",
        "fixed_booking_cancelled_by_admin",
    ];

    private const ADMIN_EMAIL_TYPES = [
        "fixed_booking_created",
        "fixed_customer_cancelled",
        "fixed_customer_no_show",
        "fixed_driver_missed_pickup",
        "fixed_driver_missed_stop",
        "fixed_vehicle_started",
        "fixed_vehicle_completed",
        "fixed_vehicle_cancelled",
        "fixed_booking_cancelled_by_admin",
    ];

    public function __construct(private readonly SmsService $sms)
    {
    }

    public function deliver(User $user, string $type, string $title, string $body, array $data = []): void
    {
        if (!str_starts_with($type, "fixed_")) {
            return;
        }

        $settings = OperatorSetting::instance();
        $audience = $this->audience($user);

        if ($this->shouldSendSms($settings, $audience, $type)) {
            $this->sendSms($user, $this->message($title, $body));
        }

        if ($this->shouldSendEmail($settings, $audience, $type)) {
            $this->sendEmail($user, $title, $this->emailBody($title, $body, $data));
        }
    }

    private function audience(User $user): string
    {
        if ($user->hasRole("admin")) {
            return "admin";
        }
        if ($user->hasRole("driver")) {
            return "driver";
        }
        return "customer";
    }

    private function shouldSendSms(OperatorSetting $settings, string $audience, string $type): bool
    {
        if (!$settings->notifications_sms_enabled) {
            return false;
        }

        return match ($audience) {
            "customer" => $settings->fixed_customer_sms_enabled && in_array($type, self::CUSTOMER_SMS_TYPES, true),
            "driver" => $settings->fixed_driver_sms_enabled && in_array($type, self::DRIVER_SMS_TYPES, true),
            "admin" => $settings->fixed_admin_sms_enabled && in_array($type, self::ADMIN_SMS_TYPES, true),
            default => false,
        };
    }

    private function shouldSendEmail(OperatorSetting $settings, string $audience, string $type): bool
    {
        if (!$settings->notifications_email_enabled) {
            return false;
        }

        return match ($audience) {
            "customer" => $settings->fixed_customer_email_enabled && in_array($type, self::CUSTOMER_EMAIL_TYPES, true),
            "driver" => $settings->fixed_driver_email_enabled && in_array($type, self::DRIVER_EMAIL_TYPES, true),
            "admin" => $settings->fixed_admin_email_enabled && in_array($type, self::ADMIN_EMAIL_TYPES, true),
            default => false,
        };
    }

    private function sendSms(User $user, string $message): void
    {
        $phone = trim((string) $user->phone);
        if ($phone === "") {
            return;
        }

        try {
            $this->sms->send($phone, $message);
        } catch (\Throwable $e) {
            Log::warning("Operator SMS notification failed", [
                "user_id" => $user->id,
                "error" => $e->getMessage(),
            ]);
        }
    }

    private function sendEmail(User $user, string $subject, string $body): void
    {
        $email = trim((string) $user->email);
        if ($email === "" || str_ends_with($email, "@otp.local")) {
            return;
        }

        try {
            Mail::raw($body, function ($message) use ($user, $email, $subject) {
                $message->to($email, $user->name ?: null)->subject($subject);
            });
        } catch (\Throwable $e) {
            Log::warning("Operator email notification failed", [
                "user_id" => $user->id,
                "email" => $email,
                "error" => $e->getMessage(),
            ]);
        }
    }

    private function message(string $title, string $body): string
    {
        return trim($title . ($body !== "" ? ": " . $body : ""));
    }

    private function emailBody(string $title, string $body, array $data): string
    {
        $lines = [$title, "", $body];

        $refs = array_filter([
            "Booking" => $data["reservation_id"] ?? null,
            "Vehicle" => $data["route_departure_id"] ?? null,
            "Trip" => $data["trip_id"] ?? null,
            "Refund" => $data["refund_status"] ?? null,
        ], fn ($value) => $value !== null && $value !== "");

        if ($refs) {
            $lines[] = "";
            foreach ($refs as $label => $value) {
                $lines[] = $label . ": " . $value;
            }
        }

        return trim(implode("\n", $lines));
    }
}

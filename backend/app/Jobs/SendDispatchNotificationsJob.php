<?php

namespace App\Jobs;

use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Fan out a "new ride request" FCM to a precomputed list of driver user IDs.
 * Runs on the queue so the customer-offer HTTP request returns immediately
 * even with hundreds of online drivers.
 *
 * @phpstan-type DriverPayload array{trip_id:int,amount:float,pickup_address:?string,payment_method:?string}
 */
class SendDispatchNotificationsJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 3;
    public int $backoff = 5;

    /**
     * @param  array<int, int>  $driverUserIds
     */
    public function __construct(
        public array $driverUserIds,
        public int $tripId,
        public float $amount,
        public ?string $pickupAddress,
        public ?string $paymentMethod,
    ) {
    }

    public function handle(NotificationService $notificationService): void
    {
        if (empty($this->driverUserIds)) {
            return;
        }

        $drivers = User::query()->whereIn('id', $this->driverUserIds)->get();
        $body = 'Pickup: ' . ($this->pickupAddress ?? 'nearby') . ' — \u{20B9}' . number_format($this->amount, 0);

        foreach ($drivers as $driver) {
            if ($this->paymentMethod && !$driver->acceptsPaymentMethod($this->paymentMethod)) {
                continue;
            }
            $notificationService->sendToUser(
                $driver,
                'New ride request',
                $body,
                [
                    'type' => 'new_trip',
                    'trip_id' => $this->tripId,
                    'amount' => $this->amount,
                ]
            );
        }
    }
}

<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Existing feature tests use a payment fixture without external checkout.
        // Register it here so application deployments contain no bypass endpoint.
        \Illuminate\Support\Facades\Route::middleware(['api', 'auth:sanctum', 'role:customer', 'throttle:booking', 'idempotent'])
            ->post('/api/fixed/seat-holds/{fixedSeatHold}/test-confirm-payment', function (
                \Illuminate\Http\Request $request,
                \App\Models\FixedSeatHold $fixedSeatHold
            ) {
                abort_unless(app()->environment('testing'), 404);
                abort_unless($fixedSeatHold->customer_id === $request->user()->id, 404);
                $data = $request->validate(['booking_channel' => ['nullable', 'in:advance,on_spot']]);
                $reservation = \Tests\Support\FixedTestPaymentFixture::confirm(
                    app(\App\Services\FixedSeatHoldService::class), $request->user(), $fixedSeatHold,
                    $data['booking_channel'] ?? 'advance'
                );
                return response()->json([
                    'reservation' => app(\App\Services\FixedBookingService::class)->shapeBooking($reservation->fresh([
                        'route:id,name,scope,mode',
                        'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status',
                        'boardStop:id,name,lat,lng', 'dropStop:id,name,lat,lng',
                    ])),
                    'message' => 'Fixed booking confirmed with test payment.',
                ], 201);
            });
    }
}

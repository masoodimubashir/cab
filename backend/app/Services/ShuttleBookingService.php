<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\CityVehicleType;
use App\Models\PricingRule;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class ShuttleBookingService
{
    public function __construct(private readonly FareEstimationService $fares) {}

    public function createBooking(User $customer, array $data): ShuttlePassengerBooking
    {
        $cvt = $this->resolveShuttleVehicle($data);
        $pricingRule = PricingRule::resolveFor((int) $cvt->id);
        if (!$pricingRule) {
            throw new ReservationException('Shuttle fare is not configured for this vehicle yet.', 404);
        }

        $estimate = $this->fares->estimateFare(
            $pricingRule->toArray(),
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (float) $data['drop_lat'],
            (float) $data['drop_lng'],
            null,
            null,
            isset($data['route_distance_km']) ? (float) $data['route_distance_km'] : null,
            isset($data['route_time_min']) ? (float) $data['route_time_min'] : null,
            $cvt->toll_mode === 'yes' ? (float) ($data['toll_amount'] ?? 0) : 0.0,
        );

        return DB::transaction(function () use ($customer, $data, $cvt, $pricingRule, $estimate) {
            $journey = ShuttleJourney::query()->create([
                'city_id' => $cvt->city_id,
                'city_vehicle_type_id' => $cvt->id,
                'status' => 'DISPATCH_DISABLED',
                'capacity' => max(1, (int) $cvt->max_people),
                'seats_taken' => 1,
            ]);

            return ShuttlePassengerBooking::query()->create([
                'shuttle_journey_id' => $journey->id,
                'city_id' => $cvt->city_id,
                'city_vehicle_type_id' => $cvt->id,
                'pricing_rule_id' => $pricingRule->id,
                'customer_id' => $customer->id,
                'seats' => 1,
                'pickup_lat' => (float) $data['pickup_lat'],
                'pickup_lng' => (float) $data['pickup_lng'],
                'pickup_address' => $data['pickup_address'] ?? null,
                'drop_lat' => (float) $data['drop_lat'],
                'drop_lng' => (float) $data['drop_lng'],
                'drop_address' => $data['drop_address'] ?? null,
                'quote_distance_km' => $estimate['distance_km'] ?? null,
                'quote_time_min' => $estimate['time_min'] ?? null,
                'fare_amount' => (float) $estimate['estimated_fare'],
                'fare_breakdown' => $estimate['fare_breakdown'] ?? [],
                'currency' => 'INR',
                'payment_status' => 'PENDING',
                'status' => 'PAYMENT_PENDING',
            ]);
        });
    }

    public function createRazorpayOrder(User $customer, ShuttlePassengerBooking $booking, RazorpayService $razorpay): array
    {
        return DB::transaction(function () use ($customer, $booking, $razorpay) {
            $locked = ShuttlePassengerBooking::query()->lockForUpdate()->find($booking->id);
            if (!$locked || $locked->customer_id !== $customer->id) {
                throw new ReservationException('This Shuttle booking could not be found.', 404);
            }
            if ($locked->status !== 'PAYMENT_PENDING') {
                throw new ReservationException('This Shuttle booking is not waiting for payment.', 422);
            }
            if ((float) $locked->fare_amount <= 0) {
                throw new ReservationException('Shuttle fare is not available for this booking.', 422);
            }
            if ($locked->razorpay_order_id) {
                return $this->razorpayOrderResponse($locked);
            }

            $amountPaise = max(100, (int) round(((float) $locked->fare_amount) * 100));
            $receipt = 'shuttle_' . $locked->id . '_' . now()->format('YmdHis');
            $order = $razorpay->createOrder($amountPaise, $receipt);

            $locked->update([
                'payment_method' => 'razorpay',
                'payment_status' => 'ORDER_CREATED',
                'razorpay_order_id' => $order['order_id'],
            ]);

            return [
                'key_id' => (string) config('services.razorpay.key_id'),
                'order_id' => $order['order_id'],
                'amount_paise' => $order['amount'],
                'currency' => $order['currency'],
            ];
        });
    }

    public function shapeBooking(ShuttlePassengerBooking $booking): array
    {
        $booking->loadMissing(['journey:id,status,capacity,seats_taken', 'cityVehicleType:id,display_name,vehicle_type_id,ride_type_id']);

        return [
            'id' => $booking->id,
            'shuttle_journey_id' => $booking->shuttle_journey_id,
            'journey_status' => $booking->journey?->status,
            'city_id' => $booking->city_id,
            'city_vehicle_type_id' => $booking->city_vehicle_type_id,
            'vehicle_name' => $booking->cityVehicleType?->display_name,
            'pickup' => [
                'lat' => (float) $booking->pickup_lat,
                'lng' => (float) $booking->pickup_lng,
                'address' => $booking->pickup_address,
            ],
            'drop' => [
                'lat' => (float) $booking->drop_lat,
                'lng' => (float) $booking->drop_lng,
                'address' => $booking->drop_address,
            ],
            'fare_amount' => (float) $booking->fare_amount,
            'currency' => $booking->currency,
            'payment_method' => $booking->payment_method,
            'payment_status' => $booking->payment_status,
            'status' => $booking->status,
            'booking_enabled_for_driver' => false,
            'created_at' => optional($booking->created_at)->toIso8601String(),
        ];
    }

    private function resolveShuttleVehicle(array $data): CityVehicleType
    {
        $query = CityVehicleType::query()
            ->with('rideType:id,name')
            ->where('is_active', true)
            ->whereHas('rideType', fn ($q) => $q->whereRaw('LOWER(name) LIKE ?', ['%shuttle%']));

        if (isset($data['city_vehicle_type_id'])) {
            $query->where('id', (int) $data['city_vehicle_type_id']);
        } else {
            $query->where('city_id', (int) $data['city_id']);
            if (isset($data['vehicle_type_id'])) {
                $query->where('vehicle_type_id', (int) $data['vehicle_type_id']);
            }
        }

        $cvt = $query->orderBy('display_order')->orderBy('id')->first();
        if (!$cvt) {
            throw new ReservationException('Shuttle is not available for this vehicle in this city yet.', 404);
        }

        return $cvt;
    }

    private function razorpayOrderResponse(ShuttlePassengerBooking $booking): array
    {
        return [
            'key_id' => (string) config('services.razorpay.key_id'),
            'order_id' => (string) $booking->razorpay_order_id,
            'amount_paise' => max(100, (int) round(((float) $booking->fare_amount) * 100)),
            'currency' => (string) config('services.razorpay.currency', 'INR'),
        ];
    }
}

<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\ShuttlePassengerBooking;
use App\Services\ShuttleRefundService;
use Illuminate\Http\Request;

class AdminShuttleBookingsController
{
    public function __construct(private readonly ShuttleRefundService $refunds) {}

    public function index(Request $request, City $city)
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', 'string', 'max:30'],
            'payment_status' => ['nullable', 'string', 'max:30'],
            'refund_status' => ['nullable', 'string', 'max:30'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $perPage = (int) ($data['per_page'] ?? 25);
        $page = (int) ($data['page'] ?? 1);
        $query = ShuttlePassengerBooking::query()
            ->where('city_id', $city->id)
            ->with([
                'customer:id,name,phone',
                'cityVehicleType:id,display_name,vehicle_type_id,ride_type_id',
                'cityVehicleType.vehicleType:id,name',
                'cityVehicleType.rideType:id,name',
                'pricingRule:id,base_fare',
                'journey:id,status,capacity,seats_taken,driver_id,trip_id,created_at',
                'journey.driver:id,name,phone',
                'journey.trip:id,status,driver_id,scope,created_at,assigned_at,completed_at',
                'journey.trip.driver:id,name,phone',
            ])
            ->when(isset($data['status']), fn ($q) => $q->where('status', $data['status']))
            ->when(isset($data['payment_status']), fn ($q) => $q->where('payment_status', $data['payment_status']))
            ->when(isset($data['refund_status']), fn ($q) => $q->where('refund_status', $data['refund_status']))
            ->when(isset($data['date_from']), fn ($q) => $q->whereDate('created_at', '>=', $data['date_from']))
            ->when(isset($data['date_to']), fn ($q) => $q->whereDate('created_at', '<=', $data['date_to']));

        if (!empty($data['q'])) {
            $term = '%' . str_replace('%', '\\%', $data['q']) . '%';
            $query->where(function ($q) use ($term) {
                $q->where('id', 'like', $term)
                    ->orWhere('payment_reference', 'like', $term)
                    ->orWhere('razorpay_order_id', 'like', $term)
                    ->orWhere('razorpay_payment_id', 'like', $term)
                    ->orWhere('pickup_address', 'like', $term)
                    ->orWhere('drop_address', 'like', $term)
                    ->orWhereHas('customer', fn ($customer) => $customer->where('name', 'like', $term)->orWhere('phone', 'like', $term))
                    ->orWhereHas('cityVehicleType', fn ($vehicle) => $vehicle->where('display_name', 'like', $term));
            });
        }

        $query->orderByDesc('id');
        $total = (clone $query)->count();
        $rows = $query->forPage($page, $perPage)->get()
            ->map(fn (ShuttlePassengerBooking $booking) => $this->shapeBooking($booking))
            ->values();

        return response()->json(['data' => [
            'data' => $rows,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ]]);
    }

    public function resolveRefund(Request $request, City $city, ShuttlePassengerBooking $booking)
    {
        if ((int) $booking->city_id !== (int) $city->id) {
            abort(404);
        }

        $data = $request->validate([
            'reference' => ['nullable', 'string', 'max:191'],
            'amount' => ['nullable', 'numeric', 'min:0', 'max:1000000'],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $updated = $this->refunds->resolveManualRefund(
            $booking,
            $request->user(),
            $data['reference'] ?? null,
            array_key_exists('amount', $data) && $data['amount'] !== null ? (float) $data['amount'] : null,
            $data['note'] ?? null,
        );

        return response()->json([
            'booking' => $this->shapeBooking($updated->fresh([
                'customer:id,name,phone',
                'cityVehicleType:id,display_name,vehicle_type_id,ride_type_id',
                'cityVehicleType.vehicleType:id,name',
                'cityVehicleType.rideType:id,name',
                'journey:id,status,capacity,seats_taken,driver_id,trip_id,created_at',
                'journey.driver:id,name,phone',
                'journey.trip:id,status,driver_id,scope,created_at,assigned_at,completed_at',
                'journey.trip.driver:id,name,phone',
            ])),
            'message' => 'Shuttle refund marked resolved manually.',
        ]);
    }

    private function shapeBooking(ShuttlePassengerBooking $booking): array
    {
        $journey = $booking->journey;
        $vehicle = $booking->cityVehicleType;

        return [
            'id' => $booking->id,
            'shuttle_journey_id' => $booking->shuttle_journey_id,
            'trip_id' => $journey?->trip_id,
            'trip_status' => $journey?->trip?->status,
            'scope' => $booking->scope ?? $journey?->trip?->scope ?? 'local',
            'customer_name' => $booking->customer?->name,
            'customer_phone' => $booking->customer?->phone,
            'driver_name' => $journey?->driver?->name ?? $journey?->trip?->driver?->name,
            'driver_phone' => $journey?->driver?->phone ?? $journey?->trip?->driver?->phone,
            'vehicle_name' => $vehicle?->display_name,
            'vehicle_type_name' => $vehicle?->vehicleType?->name,
            'ride_type_name' => $vehicle?->rideType?->name,
            'seats' => $booking->seats,
            'journey_capacity' => $journey?->capacity,
            'journey_seats_taken' => $journey?->seats_taken,
            'pickup_address' => $booking->pickup_address,
            'drop_address' => $booking->drop_address,
            'pickup_lat' => $booking->pickup_lat,
            'pickup_lng' => $booking->pickup_lng,
            'drop_lat' => $booking->drop_lat,
            'drop_lng' => $booking->drop_lng,
            'quote_distance_km' => $booking->quote_distance_km,
            'quote_time_min' => $booking->quote_time_min,
            'fare_amount' => $booking->fare_amount,
            'currency' => $booking->currency,
            'payment_method' => $booking->payment_method,
            'payment_status' => $booking->payment_status,
            'refund_status' => $booking->refund_status,
            'refund_reference' => $booking->refund_reference,
            'refund_amount' => $booking->refund_amount,
            'cancelled_reason' => $booking->cancelled_reason,
            'shuttle_pickup_arrived_at' => optional($booking->shuttle_pickup_arrived_at)->toIso8601String(),
            'shuttle_no_show_after_at' => optional($booking->shuttle_no_show_after_at)->toIso8601String(),
            'shuttle_driver_missed_after_at' => optional($booking->shuttle_driver_missed_after_at)->toIso8601String(),
            'shuttle_auto_processed_at' => optional($booking->shuttle_auto_processed_at)->toIso8601String(),
            'shuttle_auto_outcome' => $booking->shuttle_auto_outcome,
            'payment_reference' => $booking->payment_reference,
            'razorpay_order_id' => $booking->razorpay_order_id,
            'razorpay_payment_id' => $booking->razorpay_payment_id,
            'status' => $booking->status,
            'journey_status' => $journey?->status,
            'boarded_at' => optional($booking->boarded_at)->toIso8601String(),
            'dropped_at' => optional($booking->dropped_at)->toIso8601String(),
            'cancelled_at' => optional($booking->cancelled_at)->toIso8601String(),
            'created_at' => optional($booking->created_at)->toIso8601String(),
        ];
    }
}

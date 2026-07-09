<?php

namespace App\Events;

use App\Models\Driver;
use App\Models\DriverLocation;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class DispatchDriverLocationUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public DriverLocation $location,
        public ?Driver $driver = null,
    ) {
    }

    public function broadcastOn(): array
    {
        return [new PrivateChannel('dispatch.live')];
    }

    public function broadcastAs(): string
    {
        return 'DispatchDriverLocationUpdated';
    }

    public function broadcastWith(): array
    {
        $driver = $this->driver;

        return [
            'type' => 'driver_location_updated',
            'driver_id' => (int) $this->location->driver_id,
            'trip_id' => $this->location->trip_id !== null ? (int) $this->location->trip_id : null,
            'location' => [
                'driver_id' => (int) $this->location->driver_id,
                'trip_id' => $this->location->trip_id !== null ? (int) $this->location->trip_id : null,
                'lat' => (float) $this->location->lat,
                'lng' => (float) $this->location->lng,
                'accuracy_m' => $this->location->accuracy_m,
                'speed_kmh' => $this->location->speed_kmh,
                'bearing_deg' => $this->location->bearing_deg,
                'recorded_at' => optional($this->location->recorded_at)->toIso8601String(),
            ],
            'driver' => $driver ? [
                'id' => $driver->id,
                'user_id' => $driver->user_id,
                'name' => $driver->user?->name,
                'phone' => $driver->user?->phone,
                'vehicle_type' => $driver->vehicleTypeRef?->name ?? $driver->vehicle_type,
                'vehicle_reg_no' => $driver->vehicle_reg_no,
                'is_online' => (bool) $driver->is_online,
            ] : null,
        ];
    }
}

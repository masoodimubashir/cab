<?php

namespace Tests\Unit;

use App\Models\Route;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Services\FixedRouteService;
use PHPUnit\Framework\TestCase;

class FixedDisplayNamesTest extends TestCase
{
    public function test_corridor_titles_use_display_endpoints_and_standalone_titles_remain_intact(): void
    {
        $route = new Route(['mode' => 'fixed', 'name' => 'Google start → Google end',
            'origin_name' => 'Custom start', 'dest_name' => 'Custom end']);
        $this->assertSame('Custom start → Custom end', $route->name);
        $this->assertSame('Custom start → Custom end', $route->toArray()['name']);
        $route->name = 'Airport Express';
        $this->assertSame('Airport Express', $route->name);
    }

    public function test_fixed_booking_serialization_uses_live_labels_without_rewriting_snapshots(): void
    {
        $route = new Route(['mode' => 'fixed', 'name' => 'Display corridor']);
        $booking = new SeatReservation(['route_id' => 1, 'route_name' => 'Old Google corridor',
            'board_stop_id' => 10, 'drop_stop_id' => 11,
            'board_address' => 'Old Google start', 'drop_address' => 'Old Google end']);
        $booking->setRelation('route', $route);
        $booking->setRelation('boardStop', new RouteStop(['name' => 'Display start']));
        $booking->setRelation('dropStop', new RouteStop(['name' => 'Display end']));
        $payload = $booking->toArray();
        $this->assertSame('Display corridor', $payload['route_name']);
        $this->assertSame('Display start', $payload['board_address']);
        $this->assertSame('Display end', $payload['drop_address']);
        $this->assertSame('Old Google start', $booking->getAttributes()['board_address']);
        $this->assertSame('Old Google corridor', $booking->getAttributes()['route_name']);
    }

    public function test_unmapped_locations_and_non_fixed_bookings_keep_their_own_addresses(): void
    {
        foreach (['fixed', 'shuttle'] as $mode) {
            $booking = new SeatReservation(['route_id' => 1, 'board_address' => 'Passenger pickup', 'drop_address' => 'Passenger drop']);
            $booking->setRelation('route', new Route(['mode' => $mode]));
            $this->assertSame('Passenger pickup', $booking->board_address);
            $this->assertSame('Passenger drop', $booking->drop_address);
        }
    }

    public function test_legacy_endpoint_coordinates_use_display_names_but_middle_pins_keep_their_labels(): void
    {
        $booking = new SeatReservation(['route_id' => 1, 'board_address' => 'Old Google start',
            'drop_address' => 'Middle drop', 'board_lat' => 34, 'board_lng' => 74,
            'drop_lat' => 34.5, 'drop_lng' => 74.5]);
        $booking->setRelation('route', new Route(['mode' => 'fixed', 'origin_name' => 'Custom start', 'dest_name' => 'Custom end',
            'origin_lat' => 34, 'origin_lng' => 74, 'dest_lat' => 35, 'dest_lng' => 75]));
        $this->assertSame('Custom start', $booking->board_address);
        $this->assertSame('Middle drop', $booking->drop_address);
    }

    public function test_fixed_trip_history_uses_endpoint_labels_and_keeps_coordinates(): void
    {
        $trip = new Trip(['route_id' => 1, 'pickup_address' => 'Old start', 'drop_address' => 'Old end',
            'pickup_lat' => 34, 'pickup_lng' => 74, 'drop_lat' => 35, 'drop_lng' => 75]);
        $trip->setRelation('route', new Route(['mode' => 'fixed', 'origin_name' => 'Display start', 'dest_name' => 'Display end', 'origin_lat' => 34, 'origin_lng' => 74, 'dest_lat' => 35, 'dest_lng' => 75]));
        $this->assertSame('Display start', $trip->pickup_address);
        $this->assertSame('Display end', $trip->drop_address);
        $this->assertEquals(34, $trip->pickup_lat); $this->assertEquals(35, $trip->drop_lat);
        $trip->drop_lat = 34.5;
        $this->assertSame('Old end', $trip->drop_address);
        $trip->route->mode = 'shuttle';
        $this->assertSame('Old start', $trip->pickup_address);
        $this->assertSame('Old end', $trip->drop_address);
    }

    public function test_saved_endpoint_stop_labels_follow_operator_names_in_sequence_order(): void
    {
        $service = (new \ReflectionClass(FixedRouteService::class))->newInstanceWithoutConstructor();
        $method = new \ReflectionMethod($service, 'withEndpointDisplayNames');
        $result = $method->invoke($service, ['origin_name' => 'Custom start', 'dest_name' => 'Custom end', 'stops' => [
            ['id' => 2, 'seq' => 3, 'name' => 'Google end'],
            ['id' => 3, 'seq' => 2, 'name' => 'Middle stop'],
            ['id' => 1, 'seq' => 1, 'name' => 'Google start'],
        ]]);
        $this->assertSame(['Custom end', 'Middle stop', 'Custom start'], array_column($result['stops'], 'name'));
        $this->assertSame([2, 3, 1], array_column($result['stops'], 'id'));
    }
}

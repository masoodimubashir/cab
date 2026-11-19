<?php

namespace Tests\Unit\Carpool;

use App\Services\Carpool\RouteGeometry;
use PHPUnit\Framework\TestCase;

/** M4: positions along a route, direction and loops (Carpool.md section 11, geometry tests). */
class RouteGeometryTest extends TestCase
{
    /** About 9 km from Bemina towards Hazratbal, in 20 steps. */
    private function line(): array
    {
        $out = [];
        for ($i = 0; $i <= 20; $i++) {
            $out[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }

        return $out;
    }

    public function test_length_and_fraction(): void
    {
        $geo = RouteGeometry::of($this->line());
        $this->assertEqualsWithDelta(9300, $geo->length(), 400);
        $this->assertSame(0.0, $geo->fraction(-5));
        $this->assertSame(1.0, $geo->fraction($geo->length() + 100));
        $this->assertEqualsWithDelta(0.5, $geo->fraction($geo->length() / 2), 0.0001);
    }

    public function test_match_finds_pickup_before_drop_with_short_walks(): void
    {
        $geo = RouteGeometry::of($this->line());
        // A quarter and three quarters along, each about 100 m off the line.
        $m = $geo->match(34.0859, 74.7875, 34.1159, 74.8225, 2000);

        $this->assertNotNull($m);
        $this->assertLessThan(150, $m['pickup']['distance_m']);
        $this->assertLessThan(150, $m['drop']['distance_m']);
        $this->assertEqualsWithDelta(0.25, $geo->fraction($m['pickup']['along_m']), 0.03);
        $this->assertEqualsWithDelta(0.75, $geo->fraction($m['drop']['along_m']), 0.03);
    }

    public function test_the_wrong_direction_or_a_far_place_does_not_match(): void
    {
        $geo = RouteGeometry::of($this->line());
        $this->assertNull($geo->match(34.1159, 74.8225, 34.0859, 74.7875, 2000), 'drop before pickup');
        $this->assertNull($geo->match(34.0859, 74.7875, 34.30, 74.80, 2000), 'drop far from the route');
        // Two places 40 m apart: nothing on the line gives a ride of at least 300 m
        // without walking further than the search distance.
        $this->assertNull($geo->match(34.0859, 74.7875, 34.0862, 74.7879, 150), 'a ride of a few metres');
    }

    public function test_a_route_that_comes_back_is_read_in_travel_order(): void
    {
        // Out east about 4.6 km, 220 m north, then back west on a parallel road.
        $loop = [[34.0, 74.80], [34.0, 74.85], [34.002, 74.85], [34.002, 74.80]];
        $geo = RouteGeometry::of($loop);

        // Between the two roads: near the far end first, then near the start.
        $m = $geo->match(34.001, 74.84, 34.001, 74.81, 2000);
        $this->assertNotNull($m);
        $this->assertGreaterThan($m['pickup']['along_m'], $m['drop']['along_m']);
        // The drop can only be reached on the way back.
        $this->assertGreaterThan(5000, $m['drop']['along_m']);

        // The same two places the other way round ride the outward leg.
        $back = $geo->match(34.001, 74.81, 34.001, 74.84, 2000);
        $this->assertNotNull($back);
        $this->assertLessThan(5000, $back['drop']['along_m']);
    }

    public function test_nearest_respects_distance_and_order(): void
    {
        $geo = RouteGeometry::of($this->line());
        $p = $geo->nearest(34.0859, 74.7875, 300);
        $this->assertNotNull($p);
        $this->assertNull($geo->nearest(34.0950, 74.7875, 300), 'about 1 km off the line');
        $this->assertNull($geo->nearest(34.0859, 74.7875, 300, $p['along_m'] + 10), 'nothing near it further along');
        $this->assertFalse(RouteGeometry::of([[34.0, 74.0]])->isUsable());
    }
}

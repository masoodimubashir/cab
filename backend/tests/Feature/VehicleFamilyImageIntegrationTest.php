<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\VehicleFamilyImage;
use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\RideType;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Models\VehicleSeatLayout;
use App\Models\VehicleType;
use App\Services\FixedBookingService;
use App\Services\InvoiceGeneratorService;
use App\Services\RazorpayService;
use App\Services\VehicleFamilyImageService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class VehicleFamilyImageIntegrationTest extends TestCase
{
    use RefreshDatabase;

    private function createCity(): City
    {
        return City::create([
            'name' => 'Bangalore',
            'country_code' => 'IN',
            'boundary_polygon' => [
                ['lat' => 12.0, 'lng' => 77.0],
                ['lat' => 13.0, 'lng' => 77.0],
                ['lat' => 13.0, 'lng' => 78.0],
                ['lat' => 12.0, 'lng' => 78.0],
            ],
        ]);
    }

    public function test_preload_for_platform_exists_and_groups_images(): void
    {
        $city = $this->createCity();

        VehicleFamilyImage::create([
            'display_name' => 'Sedan',
            'key' => 'map_marker',
            'image_path' => 'vehicle_families/1/android/marker.png',
        ]);

        VehicleFamilyImage::create([
            'display_name' => 'Sedan',
            'key' => 'booking_card',
            'image_path' => 'vehicle_families/1/android/card.png',
        ]);

        $service = app(VehicleFamilyImageService::class);

        $this->assertTrue(method_exists($service, 'preloadForPlatform'));

        $preloaded = $service->preloadForPlatform('android', $city->id);
        $this->assertTrue($preloaded->has('sedan'));
        $this->assertCount(2, $preloaded->get('sedan'));

        $resolved = $service->resolveForVehicle($city->id, 'Sedan', 'android', preloadedImages: $preloaded->get('sedan'));
        $this->assertNotNull($resolved['map_marker_url']);
        $this->assertNotNull($resolved['image_url']);
    }

    public function test_fixed_booking_shape_returns_marker_and_image_payload(): void
    {
        $city = $this->createCity();
        $user = User::factory()->create();
        $driverUser = User::factory()->create(['name' => 'Ravi Kumar']);

        $vt = VehicleType::create(['name' => 'Sedan', 'is_active' => true]);
        $rt = RideType::create(['name' => 'Fixed Route', 'mode' => 'fixed', 'is_active' => true]);
        $cvt = CityVehicleType::create([
            'city_id' => $city->id,
            'vehicle_type_id' => $vt->id,
            'ride_type_id' => $rt->id,
            'display_name' => 'Sedan Comfort',
            'is_active' => true,
        ]);

        $driver = Driver::create([
            'user_id' => $driverUser->id,
            'city_id' => $city->id,
            'city_vehicle_type_id' => $cvt->id,
            'vehicle_type_id' => $vt->id,
            'vehicle_type' => 'Sedan',
            'vehicle_brand' => 'Maruti',
            'vehicle_model' => '2024',
            'vehicle_color' => 'White',
            'vehicle_reg_no' => 'DL01AB1234',
            'approval_status' => 'approved',
            'is_online' => true,
        ]);

        VehicleFamilyImage::create([
            'display_name' => 'Sedan Comfort',
            'key' => 'map_marker',
            'image_path' => 'vehicle_families/1/android/sedan_marker.png',
        ]);

        $route = Route::create([
            'city_id' => $city->id,
            'name' => 'Airport Express',
            'mode' => 'fixed',
            'scope' => 'local',
            'origin_name' => 'City Center',
            'dest_name' => 'Airport Terminal 3',
            'origin_lat' => 12.9716,
            'origin_lng' => 77.5946,
            'dest_lat' => 13.1986,
            'dest_lng' => 77.7066,
        ]);

        $layout = VehicleSeatLayout::create([
            'city_id' => $city->id,
            'vehicle_type_id' => $vt->id,
            'name' => 'Standard 4',
            'rows' => 2,
            'cols' => 2,
            'is_active' => true,
        ]);

        $departure = RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $driverUser->id,
            'city_vehicle_type_id' => $cvt->id,
            'vehicle_seat_layout_id' => $layout->id,
            'service_date' => now()->toDateString(),
            'depart_at' => now()->addHour(),
            'status' => 'SCHEDULED',
            'capacity' => 4,
            'seats_taken' => 1,
        ]);

        $reservation = SeatReservation::create([
            'route_id' => $route->id,
            'route_departure_id' => $departure->id,
            'customer_id' => $user->id,
            'seats' => 1,
            'status' => 'CONFIRMED',
        ]);

        $bookingService = app(FixedBookingService::class);
        $shaped = $bookingService->shapeBooking($reservation);

        $this->assertArrayHasKey('map_marker_url', $shaped);
        $this->assertArrayHasKey('image_url', $shaped);
        $this->assertArrayHasKey('vehicle', $shaped);
        $this->assertNotNull($shaped['map_marker_url']);
        $this->assertEquals('Sedan Comfort', $shaped['vehicle_name']);
        $this->assertEquals('DL01AB1234', $shaped['vehicle']['reg_no']);
    }

    public function test_admin_image_upload_safely_replaces_file(): void
    {
        Storage::fake('public');
        $city = $this->createCity();
        $vt = VehicleType::create(['name' => 'Tata Sumo', 'is_active' => true]);
        $rt = RideType::create(['name' => 'City Ride', 'mode' => 'private', 'is_active' => true]);
        $cvt = CityVehicleType::create([
            'city_id' => $city->id,
            'vehicle_type_id' => $vt->id,
            'ride_type_id' => $rt->id,
            'display_name' => 'Tata Sumo',
            'is_active' => true,
        ]);

        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin',
            'name' => 'Super Admin',
            'is_system' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();

        // Upload first image
        $file1 = UploadedFile::fake()->image('icon1.png', 32, 32);
        $response1 = $this->actingAs($admin)
            ->postJson("/api/admin/app-assets", [
                'display_name' => $cvt->display_name,
                'key' => 'map_marker',
                'image' => $file1,
            ]);

        $response1->assertStatus(201);
        $record = VehicleFamilyImage::query()->first();
        $this->assertNotNull($record);
        $firstPath = $record->image_path;
        Storage::disk('public')->assertExists($firstPath);

        // Replace with second image
        $file2 = UploadedFile::fake()->image('icon2.png', 32, 32);
        $response2 = $this->actingAs($admin)
            ->postJson("/api/admin/app-assets", [
                'display_name' => $cvt->display_name,
                'key' => 'map_marker',
                'image' => $file2,
            ]);

        $response2->assertStatus(200);
        $record->refresh();
        $this->assertNotEquals($firstPath, $record->image_path);
        Storage::disk('public')->assertExists($record->image_path);
        Storage::disk('public')->assertMissing($firstPath);
    }

    public function test_shared_assets_are_returned_for_ios_when_preloaded(): void
    {
        $city = $this->createCity();
        $vt = VehicleType::create(['name' => 'Sedan', 'is_active' => true]);
        $rt = RideType::create(['name' => 'City Ride', 'mode' => 'private', 'is_active' => true]);
        CityVehicleType::create([
            'city_id' => $city->id,
            'vehicle_type_id' => $vt->id,
            'ride_type_id' => $rt->id,
            'display_name' => 'Sedan Comfort',
            'is_active' => true,
        ]);

        // Store the shared family images
        VehicleFamilyImage::create([
            'display_name' => 'Sedan Comfort',
            'key' => 'booking_card',
            'image_path' => 'vehicle_families/1/android/sedan_card.png',
        ]);
        VehicleFamilyImage::create([
            'display_name' => 'Sedan Comfort',
            'key' => 'map_marker',
            'image_path' => 'vehicle_families/1/android/sedan_marker.png',
        ]);

        $imageService = app(VehicleFamilyImageService::class);

        // Existing platform-specific callers receive the same shared images
        $preloaded = $imageService->preloadForPlatform('ios', $city->id);
        $familyPreloaded = $preloaded->get('sedan comfort');

        $resolved = $imageService->resolveForVehicle(
            $city->id,
            'Sedan Comfort',
            'ios',
            preloadedImages: $familyPreloaded
        );

        $this->assertNotNull($resolved['image_url'], 'iOS request should resolve the shared booking card');
        $this->assertNotNull($resolved['map_marker_url'], 'iOS request should resolve the shared map marker');
        $this->assertStringContainsString('sedan_card.png', $resolved['image_url']);
        $this->assertStringContainsString('sedan_marker.png', $resolved['map_marker_url']);
    }

    public function test_shared_assets_are_returned_for_android_when_preloaded(): void
    {
        $city = $this->createCity();
        foreach (['booking_card', 'map_marker'] as $key) {
            VehicleFamilyImage::create([
                'display_name' => 'Sedan Comfort',
                'key' => $key,
                'image_path' => "vehicle_families/{$city->id}/ios/{$key}.png",
            ]);
        }

        $service = app(VehicleFamilyImageService::class);
        $preloaded = $service->preloadForPlatform('android', $city->id);
        $resolved = $service->resolveForVehicle($city->id, 'Sedan Comfort', 'android', preloadedImages: $preloaded->get('sedan comfort'));

        $this->assertStringContainsString('/ios/booking_card.png', $resolved['image_url']);
        $this->assertStringContainsString('/ios/map_marker.png', $resolved['map_marker_url']);
    }

    public function test_preloaded_assets_are_shared_between_cities_with_the_same_family_name(): void
    {
        $firstCity = $this->createCity();
        $secondCity = City::create(['name' => 'Mumbai', 'country_code' => 'IN']);
        foreach (['booking_card', 'map_marker'] as $key) {
            VehicleFamilyImage::create([
                'display_name' => 'Sedan Comfort',
                'key' => $key,
                'image_path' => "vehicle_families/{$firstCity->id}/android/{$key}.png",
            ]);
        }

        $service = app(VehicleFamilyImageService::class);
        $family = $service->preloadForPlatform('ios')->get('sedan comfort');
        foreach ([$firstCity, $secondCity] as $city) {
            $resolved = $service->resolveForVehicle($city->id, 'Sedan Comfort', 'ios', preloadedImages: $family);
            $this->assertStringContainsString("/vehicle_families/{$firstCity->id}/android/booking_card.png", $resolved['image_url']);
            $this->assertStringContainsString("/vehicle_families/{$firstCity->id}/android/map_marker.png", $resolved['map_marker_url']);
        }
    }

    public function test_admin_dispatch_snapshot_returns_family_image_and_vehicle_type(): void
    {
        $city = $this->createCity();
        $user = User::factory()->create();
        $vt = VehicleType::create(['name' => 'Sedan', 'is_active' => true]);
        $rt = RideType::create(['name' => 'City Ride', 'mode' => 'private', 'is_active' => true]);
        $cvt = CityVehicleType::create([
            'city_id' => $city->id,
            'vehicle_type_id' => $vt->id,
            'ride_type_id' => $rt->id,
            'display_name' => 'Sedan Comfort',
            'is_active' => true,
        ]);

        $driver = Driver::create([
            'user_id' => $user->id,
            'city_id' => $city->id,
            'city_vehicle_type_id' => $cvt->id,
            'vehicle_type_id' => $vt->id,
            'vehicle_type' => 'Sedan',
            'vehicle_brand' => 'Maruti',
            'vehicle_model' => '2024',
            'vehicle_color' => 'White',
            'vehicle_reg_no' => 'DL01AB9999',
            'approval_status' => 'approved',
            'is_online' => true,
        ]);

        VehicleFamilyImage::create([
            'display_name' => 'Sedan Comfort',
            'key' => 'map_marker',
            'image_path' => 'vehicle_families/1/android/sedan_marker.png',
        ]);

        DB::table('driver_locations')->insert([
            'driver_id' => $user->id,
            'lat' => 12.5,
            'lng' => 77.5,
            'recorded_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin',
            'name' => 'Super Admin',
            'is_system' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();

        $response = $this->actingAs($admin)
            ->getJson("/api/admin/dispatch/snapshot?city_id={$city->id}");

        $response->assertStatus(200);
        $free = $response->json('drivers.free');
        $this->assertNotEmpty($free);
        $driverRow = collect($free)->firstWhere('id', $driver->id);
        $this->assertNotNull($driverRow);
        // Confirms $familyName is used for vehicle_type rather than undefined $vtName
        $this->assertEquals('Sedan Comfort', $driverRow['vehicle_type']);
        $this->assertNotNull($driverRow['map_marker_url']);
        $this->assertStringContainsString('sedan_marker.png', $driverRow['map_marker_url']);
    }

    public function test_image_upload_and_update_fail_safely_when_storage_fails(): void
    {
        $city = $this->createCity();
        $vt = VehicleType::create(['name' => 'Sedan', 'is_active' => true]);
        $rt = RideType::create(['name' => 'City Ride', 'mode' => 'private', 'is_active' => true]);
        $cvt = CityVehicleType::create([
            'city_id' => $city->id,
            'vehicle_type_id' => $vt->id,
            'ride_type_id' => $rt->id,
            'display_name' => 'Sedan Comfort',
            'is_active' => true,
        ]);

        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin',
            'name' => 'Super Admin',
            'is_system' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();

        // 1. Test failed storage during store()
        $mockDisk = \Mockery::mock(\Illuminate\Contracts\Filesystem\Filesystem::class);
        $mockDisk->shouldReceive('putFileAs')->andReturn('failed/path.png');
        $mockDisk->shouldReceive('exists')->with('failed/path.png')->andReturn(false);
        Storage::set('public', $mockDisk);

        $file = UploadedFile::fake()->image('icon.png', 32, 32);
        $storeResponse = $this->actingAs($admin)
            ->postJson("/api/admin/app-assets", [
                'display_name' => $cvt->display_name,
                'key' => 'map_marker',
                'image' => $file,
            ]);

        $storeResponse->assertStatus(500);
        $this->assertEquals(0, VehicleFamilyImage::query()->count());

        // 2. Test failed storage during update()
        Storage::fake('public');
        $existingFile = UploadedFile::fake()->image('valid.png', 32, 32);
        $existingPath = $existingFile->store("vehicle_families/{$city->id}/android", 'public');

        $imageRecord = VehicleFamilyImage::create([
            'display_name' => 'Sedan Comfort',
            'key' => 'map_marker',
            'image_path' => $existingPath,
        ]);

        // Now simulate failure during update
        $mockDiskUpdate = \Mockery::mock(\Illuminate\Contracts\Filesystem\Filesystem::class);
        $mockDiskUpdate->shouldReceive('putFileAs')->andReturn('vehicle_families/new.png');
        $mockDiskUpdate->shouldReceive('exists')->with('vehicle_families/new.png')->andReturn(false);
        Storage::set('public', $mockDiskUpdate);

        $newFile = UploadedFile::fake()->image('new.png', 32, 32);
        $updateResponse = $this->actingAs($admin)
            ->postJson("/api/admin/app-assets", [
                'display_name' => $cvt->display_name,
                'key' => 'map_marker',
                'image' => $newFile,
            ]);

        $updateResponse->assertStatus(500);
        $imageRecord->refresh();
        // Database record preserved with original path
        $this->assertEquals($existingPath, $imageRecord->image_path);
    }

    public function test_local_invoice_pdf_renders_with_embedded_vehicle_image(): void
    {
        Storage::fake('public');
        Storage::fake('local');

        $city = $this->createCity();
        $customer = User::factory()->create([
            'name' => 'Amit Sharma',
            'email' => 'amit@example.com',
            'phone' => '+919876543210',
        ]);
        $customer->addRole('customer');
        $driverUser = User::factory()->create(['name' => 'Driver Suresh']);

        $vt = VehicleType::create(['name' => 'Sedan', 'is_active' => true]);
        $rt = RideType::create(['name' => 'City Ride', 'mode' => 'private', 'is_active' => true]);
        $cvt = CityVehicleType::create([
            'city_id' => $city->id,
            'vehicle_type_id' => $vt->id,
            'ride_type_id' => $rt->id,
            'display_name' => 'Sedan Comfort',
            'is_active' => true,
        ]);

        $driver = Driver::create([
            'user_id' => $driverUser->id,
            'city_id' => $city->id,
            'city_vehicle_type_id' => $cvt->id,
            'vehicle_type_id' => $vt->id,
            'vehicle_type' => 'Sedan',
            'vehicle_brand' => 'Maruti',
            'vehicle_model' => '2024',
            'vehicle_color' => 'White',
            'vehicle_reg_no' => 'DL01AB5555',
            'approval_status' => 'approved',
            'is_online' => true,
        ]);

        // Place a real PNG in public storage
        $sampleImage = UploadedFile::fake()->image('vehicle.png', 32, 32);
        $samplePng = file_get_contents($sampleImage->getRealPath());
        $storedRelPath = "vehicle_families/{$city->id}/android/sample_card.png";
        Storage::disk('public')->put($storedRelPath, $samplePng);

        VehicleFamilyImage::create([
            'display_name' => 'Sedan Comfort',
            'key' => 'booking_card',
            'image_path' => $storedRelPath,
        ]);

        $trip = Trip::create([
            'city_id' => $city->id,
            'customer_id' => $customer->id,
            'driver_id' => $driverUser->id,
            'ride_type_id' => $rt->id,
            'city_vehicle_type_id' => $cvt->id,
            'vehicle_name' => 'Sedan Comfort',
            'pickup_address' => 'MG Road',
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_address' => 'Indiranagar',
            'drop_lat' => 12.9784,
            'drop_lng' => 77.6408,
            'status' => 'COMPLETED',
            'estimated_fare' => 250,
            'final_fare' => 250,
        ]);

        Payment::create([
            'trip_id' => $trip->id,
            'method' => 'cash',
            'status' => 'SUCCESS',
            'amount' => 250,
            'currency' => 'INR',
        ]);

        $this->mock(RazorpayService::class, function ($mock) {
            $mock->shouldNotReceive('createInvoiceForTrip');
        });
        $generator = app(InvoiceGeneratorService::class);
        $invoice = $generator->generateForTrip($trip);

        $this->assertNotNull($invoice);
        $this->assertNotNull($invoice->invoice_no);
        $this->assertEquals(250.0, (float) $invoice->total_amount);
        $this->assertStringStartsWith('invoices/', $invoice->pdf_path);
        Storage::disk('local')->assertExists($invoice->pdf_path);

        $pdfBytes = Storage::disk('local')->get($invoice->pdf_path);
        $this->assertStringStartsWith('%PDF-', $pdfBytes);
        $this->assertMatchesRegularExpression('/\/Subtype\s*\/Image\b/', $pdfBytes, 'The PDF must embed the vehicle image, not just render successfully.');
        $this->assertEquals('Local', $invoice->meta['generated_by']);

        // Verify in-app download serves the generated local PDF
        $downloadResponse = $this->actingAs($customer)
            ->get("/api/trips/{$trip->id}/invoice/download");
        $downloadResponse->assertStatus(200);
        $this->assertStringContainsString('application/pdf', $downloadResponse->headers->get('Content-Type'));
    }

    public function test_invoice_download_redirects_to_razorpay_url_when_hosted(): void
    {
        $user = User::factory()->create();
        $user->addRole('customer');
        $rt = RideType::create(['name' => 'City Ride', 'mode' => 'private', 'is_active' => true]);
        $trip = Trip::create([
            'customer_id' => $user->id,
            'ride_type_id' => $rt->id,
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_lat' => 12.9784,
            'drop_lng' => 77.6408,
            'status' => 'COMPLETED',
        ]);

        Invoice::create([
            'trip_id' => $trip->id,
            'invoice_no' => 'INV-RZP-12345',
            'total_amount' => 300,
            'currency' => 'INR',
            'pdf_path' => 'https://rzp.io/i/test_invoice_url',
            'meta' => ['generated_by' => 'Razorpay'],
        ]);

        $response = $this->actingAs($user)
            ->get("/api/trips/{$trip->id}/invoice/download");

        $response->assertRedirect('https://rzp.io/i/test_invoice_url');
    }
}

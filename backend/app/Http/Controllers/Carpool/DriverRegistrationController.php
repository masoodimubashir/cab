<?php

namespace App\Http\Controllers\Carpool;

use App\Http\Controllers\Controller;
use App\Http\Requests\Carpool\RegisterCarpoolDriverRequest;
use App\Http\Resources\Carpool\CarpoolVehicleResource;
use App\Services\Carpool\CarpoolDriverRegistration;
use Illuminate\Http\JsonResponse;

/** POST /api/carpool/driver/register: a private car owner signs up (M1). */
class DriverRegistrationController extends Controller
{
    public function store(RegisterCarpoolDriverRequest $request, CarpoolDriverRegistration $registration): JsonResponse
    {
        $driver = $registration->register($request->user(), $request->validated(), [
            'photo' => $request->file('photo'),
            'front_photo' => $request->file('front_photo'),
            'interior_photo' => $request->file('interior_photo'),
        ]);
        $user = $driver->user;

        return response()->json([
            'driver' => [
                'id' => $driver->id,
                'driver_type' => $driver->driver_type,
                'approval_status' => $driver->approval_status,
                'city_id' => $driver->city_id,
                'cities' => $driver->cities->map(fn ($c) => ['id' => $c->id, 'name' => $c->name])->values(),
            ],
            'carpool_vehicle' => new CarpoolVehicleResource($driver->carpoolVehicle),
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'phone' => $user->phone,
                'email' => $user->email,
                'roles' => $user->roleNames(),
                'avatar_url' => $user->avatar_path ? url('/storage/' . ltrim($user->avatar_path, '/')) : null,
            ],
        ], 201);
    }
}

<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolVehicle;
use App\Models\Driver;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * Creates or updates a carpool driver (Carpool.md section 3, Option A): a row
 * in `drivers` marked carpool, with the car in `carpool_vehicles`. Service and
 * commercial vehicle fields stay empty, which keeps the driver out of dispatch.
 */
class CarpoolDriverRegistration
{
    /**
     * @param array<string, mixed> $data validated RegisterCarpoolDriverRequest data
     * @param array<string, UploadedFile|null> $files photo, front_photo, interior_photo
     */
    public function register(User $user, array $data, array $files): Driver
    {
        CarpoolAccess::assertAllowed($user); // a paused number cannot come back through a new sign-up (B-02)

        return DB::transaction(function () use ($user, $data, $files) {
            $user = User::query()->lockForUpdate()->findOrFail($user->id);
            $existing = Driver::query()->where('user_id', $user->id)->lockForUpdate()->first();

            if ($existing && ! $existing->isCarpool()) {
                throw ValidationException::withMessages([
                    'driver_type' => 'You are already registered as a commercial driver. Commercial drivers can\'t carpool.',
                ]);
            }
            if ($existing && $existing->approval_status === 'approved') {
                throw ValidationException::withMessages([
                    'driver_type' => 'Your sign-up is already approved. Contact support to change your car details.',
                ]);
            }

            $this->assertPlateFree($data['plate'], $existing);

            $this->saveProfile($user, $data, $files['photo'] ?? null);

            $driver = $existing ?? new Driver(['user_id' => $user->id]);
            $driver->fill([
                'city_id' => (int) $data['city_id'],
                'vehicle_reg_no' => $data['plate'],
                'vehicle_brand' => $data['make'],
                'vehicle_color' => $data['colour'],
                // A fresh sign-up, or a rejected one sent again, waits for review.
                'approval_status' => 'pending',
                'rejected_at' => null,
            ]);
            $driver->driver_type = Driver::TYPE_CARPOOL;
            $driver->save();
            $driver->cities()->sync([(int) $data['city_id']]);

            $vehicle = $driver->carpoolVehicle ?? new CarpoolVehicle();
            $vehicle->driver_id = $driver->id;
            $vehicle->fill([
                'make' => $data['make'],
                'model' => $data['model'],
                'colour' => $data['colour'],
                'plate' => $data['plate'],
                'seats' => (int) $data['seats'],
            ]);
            foreach (['front_photo' => 'front_photo_path', 'interior_photo' => 'interior_photo_path'] as $input => $column) {
                if (($file = $files[$input] ?? null) instanceof UploadedFile) {
                    $old = $vehicle->{$column};
                    $vehicle->{$column} = $file->store('carpool_vehicles', 'public');
                    if ($old) {
                        DB::afterCommit(fn () => Storage::disk('public')->delete($old));
                    }
                }
            }
            $vehicle->save();

            if (! $user->hasRole('driver')) {
                $user->addRole('driver');
            }

            return $driver->fresh(['carpoolVehicle', 'cities:id,name', 'user']);
        });
    }

    /** One plate, one driver, across both driver types (section 2). Commercial plates may hold spaces. */
    public function assertPlateFree(string $plate, ?Driver $self): void
    {
        $taken = Driver::query()
            ->when($self, fn ($q) => $q->where('id', '!=', $self->id))
            ->whereRaw("UPPER(REPLACE(REPLACE(REPLACE(vehicle_reg_no, ' ', ''), '-', ''), '.', '')) = ?", [$plate])
            ->exists()
            || CarpoolVehicle::query()
                ->when($self, fn ($q) => $q->where('driver_id', '!=', $self->id))
                ->where('plate', $plate)
                ->exists();

        if ($taken) {
            throw ValidationException::withMessages(['plate' => 'This number plate is already registered.']);
        }
    }

    private function saveProfile(User $user, array $data, ?UploadedFile $photo): void
    {
        foreach (['name', 'email', 'dob', 'address', 'app_version', 'os_version', 'device_type'] as $field) {
            if (isset($data[$field]) && $data[$field] !== '') {
                $user->{$field} = $data[$field];
            }
        }
        if ($photo) {
            $old = $user->avatar_path;
            $user->avatar_path = $photo->store('avatars', 'public');
            if ($old && ! str_starts_with($old, 'http')) {
                DB::afterCommit(fn () => Storage::disk('public')->delete($old));
            }
        }
        $user->save();
    }
}

<?php

namespace App\Http\Requests\Carpool;

use App\Models\Carpool\CarpoolVehicle;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/carpool/driver/register: the short carpool sign-up
 * (Carpool.md section 2 "Driver sign-up", section 10 wizard).
 */
class RegisterCarpoolDriverRequest extends FormRequest
{
    /** Standard Indian plates (JK01AB4521) and the BH series (22BH1234AA), after normalising. */
    public const PLATE_PATTERN = '/^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$/';

    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('plate'))) {
            $this->merge(['plate' => CarpoolVehicle::normalisePlate($this->input('plate'))]);
        }
    }

    public function rules(): array
    {
        $user = $this->user();
        $hasAvatar = (bool) \App\Models\User::query()->whereKey($user?->id)->value('avatar_path');
        $hasFrontPhoto = (bool) \App\Models\Driver::query()->where('user_id', $user?->id)
            ->whereHas('carpoolVehicle', fn ($q) => $q->whereNotNull('front_photo_path'))->exists();

        return [
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'email' => ['nullable', 'email', 'max:190', \Illuminate\Validation\Rule::unique('users', 'email')->ignore($user?->id)],
            'dob' => ['nullable', 'date', 'before:-18 years'],
            'address' => ['nullable', 'string', 'max:255'],
            // Profile photo is required (section 2). Not re-sent once on file.
            'photo' => [$hasAvatar ? 'nullable' : 'required', 'image', 'max:' . (int) config('carpool.photo_max_kb', 4096)],
            'city_id' => ['required', 'integer', 'exists:cities,id'],
            'make' => ['required', 'string', 'max:60'],
            'model' => ['required', 'string', 'max:60'],
            'colour' => ['required', 'string', 'max:40'],
            'plate' => ['required', 'string', 'max:20', 'regex:' . self::PLATE_PATTERN],
            'seats' => ['required', 'integer', 'min:' . config('carpool.seats_min'), 'max:' . config('carpool.seats_max')],
            // Front of the car with the plate visible is required; interior is optional.
            'front_photo' => [$hasFrontPhoto ? 'nullable' : 'required', 'image', 'max:' . (int) config('carpool.car_photo_max_kb', 6144)],
            'interior_photo' => ['nullable', 'image', 'max:' . (int) config('carpool.car_photo_max_kb', 6144)],
            'app_version' => ['nullable', 'string', 'max:32'],
            'os_version' => ['nullable', 'string', 'max:32'],
            'device_type' => ['nullable', 'string', 'max:64'],
        ];
    }

    public function messages(): array
    {
        return [
            'photo.required' => 'Add a profile photo.',
            'front_photo.required' => 'Add a photo of the front of your car with the number plate visible.',
            'plate.regex' => 'Enter the number plate as it is written, for example JK01 AB 4521.',
            'seats.min' => 'Offer at least one seat.',
            'seats.max' => 'You can offer at most :max seats.',
            'dob.before' => 'Carpool drivers must be at least 18.',
        ];
    }
}

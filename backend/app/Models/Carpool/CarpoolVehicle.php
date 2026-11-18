<?php

namespace App\Models\Carpool;

use App\Models\Driver;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

/**
 * @property int $driver_id
 * @property string $make
 * @property string $model
 * @property string $colour
 * @property string $plate
 * @property int $seats
 * @property string|null $front_photo_path
 * @property string|null $interior_photo_path
 */
class CarpoolVehicle extends Model
{
    protected $fillable = ['make', 'model', 'colour', 'plate', 'seats', 'front_photo_path', 'interior_photo_path'];

    protected $casts = ['seats' => 'integer'];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    public function photoUrl(?string $path): ?string
    {
        return $path ? Storage::disk('public')->url($path) : null;
    }

    /** Indian plates are stored without spaces or dashes, upper case: "JK01AB4521". */
    public static function normalisePlate(string $plate): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $plate));
    }
}

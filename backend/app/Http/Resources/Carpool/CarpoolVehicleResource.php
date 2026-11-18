<?php

namespace App\Http\Resources\Carpool;

use App\Models\Carpool\CarpoolVehicle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin CarpoolVehicle */
class CarpoolVehicleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'make' => $this->make,
            'model' => $this->model,
            'colour' => $this->colour,
            'plate' => $this->plate,
            'seats' => $this->seats,
            'front_photo_url' => $this->photoUrl($this->front_photo_path),
            'interior_photo_url' => $this->photoUrl($this->interior_photo_path),
        ];
    }
}

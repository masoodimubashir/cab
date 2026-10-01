<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

#[Fillable(['display_name', 'key', 'image_path'])]
class VehicleFamilyImage extends Model
{
    protected $appends = ['image_url'];

    public function setDisplayNameAttribute(string $name): void
    {
        $this->attributes['display_name'] = mb_strtolower(trim($name));
    }

    public function getImageUrlAttribute(): ?string
    {
        return $this->image_path ? Storage::disk('public')->url($this->image_path) : null;
    }
}

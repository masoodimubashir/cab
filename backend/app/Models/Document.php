<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'name',
    'no_of_images',
    'category',
    'required',
    'document_type',
    'gallery_restricted',
    'instructions',
    'status',
])]
class Document extends Model
{
    use HasFactory;

    public const CATEGORIES = ['driver_document', 'car_rental_document'];
    public const DOCUMENT_TYPES = ['normal'];
    public const REQUIRED_MODES = ['mandatory_register', 'mandatory_drive', 'optional'];

    protected $casts = [
        'no_of_images' => 'integer',
        'gallery_restricted' => 'boolean',
    ];

    public function labels(): HasMany
    {
        return $this->hasMany(DocumentLabel::class)->orderBy('sort_order')->orderBy('id');
    }

    public function scopeForDrivers(Builder $query): Builder
    {
        // Status also stores mandatory_register/mandatory_drive in the admin UI.
        // Unassigned (null) and legacy active entries remain available.
        return $query->where('category', 'driver_document')
            ->where(fn (Builder $q) => $q->whereNull('status')->orWhere('status', '!=', 'inactive'));
    }
}

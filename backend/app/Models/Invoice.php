<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'trip_id',
    'invoice_no',
    'pdf_path',
    'meta',
    'total_amount',
    'currency',
    'issued_at',
])]
class Invoice extends Model
{
    use HasFactory;

    protected $casts = [
        'meta' => 'array',
        'total_amount' => 'float',
        'issued_at' => 'datetime',
    ];

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'trip_id');
    }
}


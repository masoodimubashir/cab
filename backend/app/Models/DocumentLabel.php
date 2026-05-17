<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'document_id',
    'label',
    'label_type',
    'mandatory',
    'sort_order',
])]
class DocumentLabel extends Model
{
    use HasFactory;

    public const LABEL_TYPES = ['text', 'number', 'date', 'url'];

    protected $casts = [
        'mandatory' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }
}

<?php

namespace App\Models\Carpool;

use App\Models\Document;
use App\Models\Driver;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A carpool driver's new copy of a dated document, waiting for an admin (S11, choice A1). */
class CarpoolDocumentRenewal extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';

    protected $fillable = ['driver_id', 'document_id', 'file_path', 'expiry_date', 'status', 'rejection_reason', 'reviewed_by', 'reviewed_at'];

    protected $casts = ['expiry_date' => 'date', 'reviewed_at' => 'datetime'];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }
}

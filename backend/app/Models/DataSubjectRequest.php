<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A GDPR-style Data Subject Access Request filed from the operator panel.
 * Append-only; actioned by an admin who sets the status + notes.
 */
class DataSubjectRequest extends Model
{
    public const RIGHTS = ['erasure', 'portability', 'rectification', 'access', 'restrict', 'object'];
    public const STATUSES = ['pending', 'in_progress', 'completed', 'rejected'];

    protected $fillable = [
        'right',
        'reason',
        'status',
        'requested_by_user_id',
        'handled_by_user_id',
        'handled_at',
        'notes',
    ];

    protected $casts = [
        'handled_at' => 'datetime',
    ];

    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by_user_id');
    }

    public function handledBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'handled_by_user_id');
    }
}

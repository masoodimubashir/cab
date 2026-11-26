<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;

/**
 * One line of the carpool admin log: who did what to which carpool, request, report or person.
 * Append only: nothing updates or deletes these rows (Admin-Audit.md B-03).
 */
class CarpoolAdminAction extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = ['id'];

    protected $casts = [
        'before' => 'array',
        'after' => 'array',
        'created_at' => 'datetime',
    ];

    /** Plain-words labels for each action, used by the admin screens. */
    public const LABELS = [
        'cancel_listing' => 'Cancelled the carpool',
        'end_ride' => 'Ended the ride',
        'remove_rider' => 'Removed a rider',
        'correct_outcome' => 'Corrected a rider outcome',
        'ban' => 'Paused carpool access',
        'restore' => 'Restored carpool access',
        'remove_message' => 'Removed the message',
        'close_report' => 'Closed the report',
        'settings' => 'Changed settings',
        'words_add' => 'Added banned words',
        'word_toggle' => 'Turned a banned word on or off',
        'word_delete' => 'Removed a banned word',
        'car_edit' => 'Edited the car',
        'document_expiry' => 'Changed a document expiry date',
        'document_upload' => 'Uploaded a document on behalf of the driver',
        'document_allow' => 'Allowed a document until a date',
        'document_renewal_approve' => 'Approved a renewed document',
        'document_renewal_reject' => 'Rejected a renewed document',
        'plan_create' => 'Created a plan',
        'plan_update' => 'Edited a plan',
        'plan_active' => 'Turned a plan on or off',
        'plan_delete' => 'Deleted a plan',
        'anonymise' => 'Account deleted, personal data removed',
        'ban_inherited' => 'Pause carried over from an earlier account',
        'reason_add' => 'Added a report reason',
        'reason_edit' => 'Changed a report reason',
    ];

    public function toEntry(): array
    {
        return [
            'id' => $this->id,
            'at' => $this->created_at?->toIso8601String(),
            'admin' => $this->admin_name ?: 'Admin',
            'action' => $this->action,
            'label' => self::LABELS[$this->action] ?? $this->action,
            'target_type' => $this->target_type,
            'target_id' => $this->target_id,
            'listing_id' => $this->listing_id,
            'note' => $this->note,
            'before' => $this->before,
            'after' => $this->after,
        ];
    }
}

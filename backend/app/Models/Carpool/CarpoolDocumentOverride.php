<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;

/** An admin's "allow until" for one driver's document: it counts as valid up to this India day (S11, choice C). */
class CarpoolDocumentOverride extends Model
{
    protected $fillable = ['driver_id', 'document_id', 'allow_until', 'note', 'admin_id'];

    protected $casts = ['allow_until' => 'date'];
}

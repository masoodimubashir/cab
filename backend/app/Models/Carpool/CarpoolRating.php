<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;

/** A rating of a person after a carpool (P11). Built for both directions; only rider -> driver is switched on. */
class CarpoolRating extends Model
{
    protected $fillable = ['score', 'comment'];

    protected $casts = ['score' => 'integer'];
}

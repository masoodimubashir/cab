<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;


class CarpoolBannedWord extends Model
{
    /**
     * Most words the list can hold. Every chat message is checked against every active word, so the list
     * is capped to keep sending a message quick. One place only: the admin API and screen read it from here.
     */
    public const MAX_WORDS = 500;

    /** Shortest and longest word that can be added (the column holds 60 characters). */
    public const MIN_LENGTH = 2;

    public const MAX_LENGTH = 60;

    protected $guarded = [];

    protected $casts = ['active' => 'boolean'];
}

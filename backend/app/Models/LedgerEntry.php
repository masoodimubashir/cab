<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * An immutable money-movement row. Append-only: never updated, never deleted.
 * Amounts are in paise. See the ledger_entries migration for the invariant.
 */
#[Fillable([
    'trip_id',
    'payment_id',
    'type',
    'party',
    'direction',
    'amount_paise',
    'razorpay_ref',
    'meta',
])]
class LedgerEntry extends Model
{
    public const UPDATED_AT = null;

    public const TYPE_CAPTURE = 'capture';
    public const TYPE_TRANSFER = 'transfer';
    public const TYPE_RETAINED = 'retained';
    public const TYPE_HELD = 'held';
    public const TYPE_RELEASE = 'release';
    public const TYPE_REFUND = 'refund';
    public const TYPE_REVERSAL = 'reversal';

    public const PARTY_CUSTOMER = 'customer';
    public const PARTY_DRIVER = 'driver';
    public const PARTY_OPERATOR = 'operator';

    protected $casts = [
        'amount_paise' => 'integer',
        'meta' => 'array',
    ];
}

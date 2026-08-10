<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The operator-borne gateway fee (Private & Shuttle).
 *
 * Unlike `gateway_fee_amount` — which is added ON TOP of the fare and is part of
 * `amount` (the customer paid it) — this fee is NOT in `amount`: the customer was
 * charged only the fare, and this records the cut the operator absorbs. The split
 * books it against the operator, so the driver is still paid on the full fare and
 * the operator's take drops by exactly this much.
 *
 * Kept separate from `gateway_fee_amount` so the customer-fare accounting (what's
 * still owed, refunds) never subtracts a fee the customer never paid. Nullable:
 * null means "no operator-borne fee".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            if (!Schema::hasColumn('payments', 'operator_gateway_fee_amount')) {
                $table->decimal('operator_gateway_fee_amount', 10, 2)->nullable()->after('payment_method_group');
            }
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            if (Schema::hasColumn('payments', 'operator_gateway_fee_amount')) {
                $table->dropColumn('operator_gateway_fee_amount');
            }
        });
    }
};

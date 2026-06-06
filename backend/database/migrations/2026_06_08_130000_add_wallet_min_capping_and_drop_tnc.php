<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Wallet balance caps on operator_settings:
 *  - Add wallet_cash_min_capping (SIGNED, so the operator can allow debt — e.g.
 *    -500 means a wallet may go down to -₹500). Default 0 = can't go below zero.
 *  - Make wallet_cash_max_capping's 0 mean "no upper limit", and clear the old,
 *    never-enforced default of 20 so enabling enforcement doesn't surprise-cap
 *    existing wallets at ₹20.
 *  - Drop wallet_cash_tnc (the wallet terms & conditions field was removed).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            if (!Schema::hasColumn('operator_settings', 'wallet_cash_min_capping')) {
                $table->integer('wallet_cash_min_capping')->default(0)->after('wallet_cash_max_capping');
            }
            // 0 now means "no maximum" going forward.
            $table->unsignedInteger('wallet_cash_max_capping')->default(0)->change();
        });

        // Reset the legacy, never-enforced default of 20 to 0 (= unlimited).
        DB::table('operator_settings')
            ->where('wallet_cash_max_capping', 20)
            ->update(['wallet_cash_max_capping' => 0]);

        if (Schema::hasColumn('operator_settings', 'wallet_cash_tnc')) {
            Schema::table('operator_settings', function (Blueprint $table) {
                $table->dropColumn('wallet_cash_tnc');
            });
        }
    }

    public function down(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            if (Schema::hasColumn('operator_settings', 'wallet_cash_min_capping')) {
                $table->dropColumn('wallet_cash_min_capping');
            }
            if (!Schema::hasColumn('operator_settings', 'wallet_cash_tnc')) {
                $table->text('wallet_cash_tnc')->nullable();
            }
            $table->unsignedInteger('wallet_cash_max_capping')->default(20)->change();
        });
    }
};

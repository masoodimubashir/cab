<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Cash hybrid deposit (Operator Settings → Payments → Cash). A cash ride now
 * collects an upfront deposit online at booking, with the rest handed to the
 * driver in cash at trip end:
 *  - cash_deposit_amount — the ₹ taken online up front (fare × cash_deposit_percent).
 *  - cash_balance_due     — the ₹ still owed in cash to the driver at trip end.
 *
 * Both live on the payment row so the deposit reconciles with the trip and the
 * driver/customer apps can show the split. Null on non-cash payments.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            if (!Schema::hasColumn('payments', 'cash_deposit_amount')) {
                $table->decimal('cash_deposit_amount', 10, 2)->nullable()->after('discount_amount');
            }
            if (!Schema::hasColumn('payments', 'cash_balance_due')) {
                $table->decimal('cash_balance_due', 10, 2)->nullable()->after('cash_deposit_amount');
            }
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            foreach (['cash_deposit_amount', 'cash_balance_due'] as $col) {
                if (Schema::hasColumn('payments', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Module 6 — the net settlement audit trail (Model B).
 *
 * A row is written each time the operator settles a driver (records a payout): a
 * point-in-time snapshot of what the driver was owed / owed at that moment and
 * how much was paid. This is the history the driver's Settlement screens
 * (Module 7) and the operator's reconciliation read from — the wallet holds the
 * live running balance, this holds the record of each settlement event.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('driver_settlements')) {
            return;
        }

        Schema::create('driver_settlements', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();          // the driver's user id
            $table->decimal('owed_by_company', 12, 2)->default(0);   // position before this payout
            $table->decimal('owed_by_driver', 12, 2)->default(0);
            $table->decimal('net', 12, 2)->default(0);
            $table->decimal('amount_paid', 12, 2)->default(0);       // the payout recorded
            $table->string('method', 20)->nullable();                // gpay / bank / cash / other
            $table->string('reference', 120)->nullable();
            $table->unsignedBigInteger('wallet_transaction_id')->nullable();
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_settlements');
    }
};

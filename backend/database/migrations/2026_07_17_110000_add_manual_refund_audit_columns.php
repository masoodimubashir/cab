<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B5 — manual customer refunds. Captured Razorpay money is returned by the
 * operator OUTSIDE the app (GPay / bank / Razorpay dashboard) and recorded
 * here: how it was sent, the reference, who marked it and when. Both fixed
 * (seat_reservations) and shuttle (shuttle_passenger_bookings) share the
 * same audit columns so one Refunds register can union them.
 */
return new class extends Migration
{
    private const TABLES = ['seat_reservations', 'shuttle_passenger_bookings'];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->string('refund_method', 30)->nullable()->after('refund_reference');
                $t->string('refund_note', 1000)->nullable()->after('refund_method');
                $t->unsignedBigInteger('refunded_by')->nullable()->after('refund_note');
                $t->timestamp('refunded_at')->nullable()->after('refunded_by');
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropColumn(['refund_method', 'refund_note', 'refunded_by', 'refunded_at']);
            });
        }
    }
};

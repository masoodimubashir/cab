<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            $table->string('payment_reference', 191)->nullable()->after('payment_status')->index();
            $table->string('refund_reference', 191)->nullable()->after('refund_status')->index();
            $table->decimal('refund_amount', 10, 2)->nullable()->after('refund_reference');
        });
    }

    public function down(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            $table->dropIndex(['payment_reference']);
            $table->dropIndex(['refund_reference']);
            $table->dropColumn(['payment_reference', 'refund_reference', 'refund_amount']);
        });
    }
};

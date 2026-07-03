<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->enum('refund_status', ['NONE', 'REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED'])
                ->default('NONE')
                ->after('payment_status');
            $table->string('refund_reference', 191)->nullable()->after('refund_status')->index();
            $table->decimal('refund_amount', 10, 2)->nullable()->after('refund_reference');
            $table->string('cancelled_reason', 1000)->nullable()->after('cancelled_at');
            $table->index(['refund_status', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->dropIndex(['refund_reference']);
            $table->dropIndex(['refund_status', 'status']);
            $table->dropColumn(['refund_status', 'refund_reference', 'refund_amount', 'cancelled_reason']);
        });
    }
};

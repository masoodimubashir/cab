<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            $table->enum('payment_status', ['PENDING', 'PAID', 'FAILED', 'REFUNDED'])
                ->nullable()
                ->after('payment_method');
            $table->boolean('has_extra_luggage')->default(false)->after('payment_status');
            $table->decimal('luggage_surcharge_amount', 10, 2)->default(0)->after('has_extra_luggage');
            $table->enum('refund_status', ['NONE', 'REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED'])
                ->default('NONE')
                ->after('luggage_surcharge_amount');

            $table->index(['payment_status', 'status']);
            $table->index(['refund_status', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            $table->dropIndex(['payment_status', 'status']);
            $table->dropIndex(['refund_status', 'status']);
            $table->dropColumn([
                'payment_status',
                'has_extra_luggage',
                'luggage_surcharge_amount',
                'refund_status',
            ]);
        });
    }
};

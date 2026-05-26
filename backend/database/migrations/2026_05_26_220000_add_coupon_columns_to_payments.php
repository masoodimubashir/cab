<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            if (! Schema::hasColumn('payments', 'coupon_assignment_id')) {
                $table->foreignId('coupon_assignment_id')
                    ->nullable()
                    ->after('amount')
                    ->constrained('coupon_assignments')
                    ->nullOnDelete();
            }
            if (! Schema::hasColumn('payments', 'discount_amount')) {
                $table->decimal('discount_amount', 10, 2)
                    ->nullable()
                    ->after('coupon_assignment_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            if (Schema::hasColumn('payments', 'discount_amount')) {
                $table->dropColumn('discount_amount');
            }
            if (Schema::hasColumn('payments', 'coupon_assignment_id')) {
                $table->dropConstrainedForeignId('coupon_assignment_id');
            }
        });
    }
};

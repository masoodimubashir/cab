<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            $table->boolean('has_extra_luggage')->default(false)->after('amount');
            $table->decimal('luggage_surcharge_amount', 10, 2)->default(0)->after('has_extra_luggage');
        });
    }

    public function down(): void
    {
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            $table->dropColumn(['has_extra_luggage', 'luggage_surcharge_amount']);
        });
    }
};

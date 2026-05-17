<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->decimal('cancellation_fee_amount', 10, 2)->nullable()->after('cancelled_at');
            $table->string('no_show_by', 16)->nullable()->after('cancellation_fee_amount');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropColumn(['cancellation_fee_amount', 'no_show_by']);
        });
    }
};

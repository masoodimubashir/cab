<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->dropColumn('commission_deduction');
        });
    }

    public function down(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->enum('commission_deduction', [
                'no_commission',
                'commission_with_debt',
                'commission_without_debt',
            ])->default('no_commission');
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('fixed_seat_holds')) {
            Schema::table('fixed_seat_holds', function (Blueprint $table) {
                $table->string('status', 32)->default('HELD')->change();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('fixed_seat_holds')) {
            Schema::table('fixed_seat_holds', function (Blueprint $table) {
                $table->enum('status', ['HELD', 'CONFIRMED', 'EXPIRED', 'RELEASED', 'FAILED'])->default('HELD')->change();
            });
        }
    }
};

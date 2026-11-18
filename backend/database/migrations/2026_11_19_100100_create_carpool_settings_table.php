<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // One row: the four admin-editable carpool settings (Carpool.md section 10).
        Schema::create('carpool_settings', function (Blueprint $table) {
            $table->id();
            $table->boolean('enabled')->default(false);
            $table->unsignedInteger('search_distance_m')->default(2000);
            $table->unsignedTinyInteger('auto_complete_hours')->default(12);
            $table->unsignedTinyInteger('chat_retention_days')->default(1);
            $table->timestamps();
        });

        DB::table('carpool_settings')->insert([
            'enabled' => false,
            'search_distance_m' => 2000,
            'auto_complete_hours' => 12,
            'chat_retention_days' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('carpool_settings');
    }
};

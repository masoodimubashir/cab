<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('driver_city')) {
            Schema::create('driver_city', function (Blueprint $table) {
                $table->id();
                $table->foreignId('driver_id')->constrained('drivers')->cascadeOnDelete();
                $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
                $table->timestamps();

                $table->unique(['driver_id', 'city_id']);
            });
        }

        // Backfill existing driver city_id links into driver_city
        $drivers = DB::table('drivers')->whereNotNull('city_id')->get(['id', 'city_id', 'created_at', 'updated_at']);
        $now = now();
        $inserts = [];
        foreach ($drivers as $d) {
            $inserts[] = [
                'driver_id' => $d->id,
                'city_id' => $d->city_id,
                'created_at' => $d->created_at ?? $now,
                'updated_at' => $d->updated_at ?? $now,
            ];
        }
        if (! empty($inserts)) {
            DB::table('driver_city')->insertOrIgnore($inserts);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_city');
    }
};

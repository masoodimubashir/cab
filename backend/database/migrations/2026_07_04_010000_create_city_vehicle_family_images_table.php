<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('city_vehicle_family_images', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->string('display_name', 120);
            $table->enum('platform', ['android', 'ios']);
            $table->string('key', 60);
            $table->string('image_path');
            $table->timestamps();

            $table->unique(['city_id', 'display_name', 'platform', 'key'], 'cvfi_unique_slot');
            $table->index(['city_id', 'display_name', 'platform']);
        });

        $seen = [];

        DB::table('city_vehicle_type_images as i')
            ->join('city_vehicle_types as v', 'v.id', '=', 'i.city_vehicle_type_id')
            ->select([
                'v.city_id',
                'v.display_name',
                'i.platform',
                'i.key',
                'i.image_path',
                'i.created_at',
                'i.updated_at',
            ])
            ->orderBy("i.id")
            ->get()
            ->each(function ($row) use (&$seen) {
                $slot = implode('|', [
                    (int) $row->city_id,
                    trim((string) $row->display_name),
                    (string) $row->platform,
                    (string) $row->key,
                ]);

                if (isset($seen[$slot])) {
                    return;
                }
                $seen[$slot] = true;

                DB::table('city_vehicle_family_images')->insert([
                    'city_id' => $row->city_id,
                    'display_name' => trim((string) $row->display_name),
                    'platform' => $row->platform,
                    'key' => $row->key,
                    'image_path' => $row->image_path,
                    'created_at' => $row->created_at,
                    'updated_at' => $row->updated_at,
                ]);
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('city_vehicle_family_images');
    }
};

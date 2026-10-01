<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('vehicle_family_images', function (Blueprint $table) {
            $table->id();
            // Canonical lower-case family name: one slot across all cities/platforms.
            $table->string('display_name', 120);
            $table->string('key', 60);
            $table->string('image_path');
            $table->timestamps();
            $table->unique(['display_name', 'key']);
        });

        $this->importExistingImages();
    }

    public function importExistingImages(): void
    {
        // Preserve uploaded files and legacy rows for rollback. Latest update wins;
        // Android wins an exact timestamp tie, then the highest ID.
        $seen = [];
        DB::table('city_vehicle_family_images')
            ->whereIn('key', ['booking_card', 'map_marker'])
            ->orderByDesc('updated_at')->orderBy('platform')->orderByDesc('id')
            ->get()->each(function ($row) use (&$seen) {
                $family = mb_strtolower(trim($row->display_name));
                $slot = $family.'|'.$row->key;
                if ($family === '' || isset($seen[$slot])) return;
                $seen[$slot] = true;
                DB::table('vehicle_family_images')->insert([
                    'display_name' => $family,
                    'key' => $row->key,
                    'image_path' => $row->image_path,
                    'created_at' => $row->created_at,
                    'updated_at' => $row->updated_at,
                ]);
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicle_family_images');
    }
};

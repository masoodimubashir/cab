<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('vehicle_types', function (Blueprint $table) {
            if (Schema::hasColumn('vehicle_types', 'description')) {
                $table->dropColumn('description');
            }
            if (Schema::hasColumn('vehicle_types', 'image_path')) {
                $table->dropColumn('image_path');
            }
        });
    }

    public function down(): void
    {
        Schema::table('vehicle_types', function (Blueprint $table) {
            if (! Schema::hasColumn('vehicle_types', 'description')) {
                $table->string('description')->nullable()->after('name');
            }
            if (! Schema::hasColumn('vehicle_types', 'image_path')) {
                $table->string('image_path')->nullable()->after('description');
            }
        });
    }
};

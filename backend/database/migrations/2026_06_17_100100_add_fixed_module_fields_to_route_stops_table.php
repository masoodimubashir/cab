<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('route_stops', function (Blueprint $table) {
            $table->boolean('is_active')->default(true)->after('is_drop');
            $table->boolean('is_temporarily_unavailable')->default(false)->after('is_active');
            $table->string('unavailable_reason', 255)->nullable()->after('is_temporarily_unavailable');
        });
    }

    public function down(): void
    {
        Schema::table('route_stops', function (Blueprint $table) {
            $table->dropColumn([
                'is_active',
                'is_temporarily_unavailable',
                'unavailable_reason',
            ]);
        });
    }
};

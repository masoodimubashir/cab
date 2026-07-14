<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('routes', function (Blueprint $table) {
            $table->index(['origin_city_id', 'dest_city_id', 'scope', 'mode', 'is_active'], 'routes_fixed_customer_origin_dest_idx');
            $table->index(['dest_city_id', 'scope', 'mode', 'is_active'], 'routes_fixed_customer_dest_idx');
        });
    }

    public function down(): void
    {
        Schema::table('routes', function (Blueprint $table) {
            $table->dropIndex('routes_fixed_customer_origin_dest_idx');
            $table->dropIndex('routes_fixed_customer_dest_idx');
        });
    }
};

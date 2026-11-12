<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Keep every pending interest, including ones past the former deadline.
        Schema::table('fixed_route_alerts', function (Blueprint $table) {
            $table->dropColumn('expires_at');
        });
    }

    public function down(): void
    {
        Schema::table('fixed_route_alerts', function (Blueprint $table) {
            $table->timestamp('expires_at')->nullable()->index();
        });
    }
};

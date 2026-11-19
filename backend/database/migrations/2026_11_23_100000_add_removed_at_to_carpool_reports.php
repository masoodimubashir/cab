<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carpool_reports', function (Blueprint $table) {
            $table->timestamp('removed_at')->nullable(); // admin removed the reported message
        });
    }

    public function down(): void
    {
        Schema::table('carpool_reports', function (Blueprint $table) {
            $table->dropColumn('removed_at');
        });
    }
};

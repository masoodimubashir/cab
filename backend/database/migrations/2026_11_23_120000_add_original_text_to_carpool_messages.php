<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // What the sender typed, kept only when a banned word was hidden, so an admin can check a report.
        Schema::table('carpool_messages', function (Blueprint $table) {
            $table->text('original_body')->nullable();
        });
        Schema::table('carpool_reports', function (Blueprint $table) {
            $table->text('original_text')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('carpool_messages', function (Blueprint $table) {
            $table->dropColumn('original_body');
        });
        Schema::table('carpool_reports', function (Blueprint $table) {
            $table->dropColumn('original_text');
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('phone_otps', function (Blueprint $table) {
            // NULL denotes a login code; account changes require an explicit target.
            $table->foreignId('change_user_id')->nullable()->constrained('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('phone_otps', function (Blueprint $table) {
            $table->dropConstrainedForeignId('change_user_id');
        });
    }
};

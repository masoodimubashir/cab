<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('phone', 20)->unique()->nullable();
            $table->string('google_sub')->unique()->nullable();
            $table->string('avatar_path')->nullable();
            $table->timestamp('last_login_at')->nullable();

            $table->enum('role', ['customer', 'driver', 'admin'])->default('customer');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['phone', 'google_sub', 'avatar_path', 'last_login_at', 'role']);
        });
    }
};


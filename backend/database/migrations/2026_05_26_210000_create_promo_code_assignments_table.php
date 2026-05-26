<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('promo_code_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('promo_code_id')->constrained('promo_codes')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('reason', 255);
            $table->text('push_message')->nullable();
            $table->dateTime('expires_at')->nullable();
            $table->dateTime('assigned_at')->useCurrent();
            $table->dateTime('used_at')->nullable();
            $table->foreignId('redeemed_trip_id')->nullable()->constrained('trips')->nullOnDelete();
            $table->foreignId('assigned_by_admin_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['promo_code_id', 'user_id']);
            $table->index(['user_id', 'used_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('promo_code_assignments');
    }
};

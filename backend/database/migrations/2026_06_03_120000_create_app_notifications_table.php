<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * In-app notification inbox — one row per (recipient, event). Powers the
 * Notifications screen in the customer + driver apps and the admin panel.
 *
 * Named `app_notifications` (not `notifications`) so it never collides with
 * Laravel's built-in Notifiable `notifications` morph table on the User model.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_notifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete(); // recipient
            $table->string('type', 64);          // e.g. scheduled_ride_booked
            $table->string('title');
            $table->text('body')->nullable();
            $table->json('data')->nullable();    // e.g. {"trip_id": 12, "scheduled_at": "..."}
            $table->string('icon', 48)->nullable(); // optional ionicon hint for the UI
            $table->timestamp('read_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'read_at']);
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('app_notifications');
    }
};

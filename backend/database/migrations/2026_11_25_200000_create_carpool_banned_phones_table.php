<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * W8 (decision D-26): when a person whose carpool access is paused deletes their account, we keep a
 * one-way hash of the phone number (never the number) so a later sign-up with the same number can be
 * recognised (W5 reads this). Additive; nothing existing changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('carpool_banned_phones', function (Blueprint $table) {
            $table->id();
            $table->char('phone_hash', 64)->unique();
            $table->string('reason', 255)->nullable();
            $table->timestamp('banned_at')->nullable();
            $table->unsignedBigInteger('source_user_id')->nullable(); // the deleted account, for the history screens
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('carpool_banned_phones');
    }
};

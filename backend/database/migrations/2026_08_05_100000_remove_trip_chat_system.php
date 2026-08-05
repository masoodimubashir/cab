<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Remove the trip chat system.
 *
 * In-trip messaging was fully built on the backend (trip_messages table, a
 * controller, a broadcast event and the chat_enabled city toggle) but was never
 * surfaced in either mobile app, so it carried cost without ever being used.
 * This drops the table and the toggle. down() recreates the schema (not the
 * data) so the migration is reversible.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::dropIfExists('trip_messages');

        if (Schema::hasColumn('city_settings', 'chat_enabled')) {
            Schema::table('city_settings', function (Blueprint $table) {
                $table->dropColumn('chat_enabled');
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasColumn('city_settings', 'chat_enabled')) {
            Schema::table('city_settings', function (Blueprint $table) {
                $table->boolean('chat_enabled')->default(true)->after('city_id');
            });
        }

        if (! Schema::hasTable('trip_messages')) {
            Schema::create('trip_messages', function (Blueprint $table) {
                $table->id();
                $table->foreignId('trip_id')->constrained('trips')->cascadeOnDelete();
                $table->foreignId('sender_user_id')->constrained('users')->cascadeOnDelete();

                $table->enum('message_type', ['TEXT'])->default('TEXT');
                $table->text('body');

                $table->enum('moderation_status', ['VISIBLE', 'FLAGGED', 'REMOVED'])->default('VISIBLE');
                $table->foreignId('moderated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->text('moderation_reason')->nullable();

                $table->timestamps();

                $table->index(['trip_id', 'created_at']);
            });
        }
    }
};

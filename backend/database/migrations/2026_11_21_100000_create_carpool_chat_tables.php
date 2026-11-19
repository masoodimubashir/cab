<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Chat, pickup proposals, reports and banned words (Carpool.md sections 8 and P9).
 * One group chat per carpool; one direct chat per join request (driver and that
 * rider only), so riders can never message each other.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('carpool_conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('listing_id')->constrained('carpool_listings')->cascadeOnDelete();
            $table->string('kind', 10); // group | direct
            $table->foreignId('request_id')->nullable()->constrained('carpool_requests')->cascadeOnDelete();
            $table->foreignId('rider_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->timestamp('last_message_at')->nullable();
            $table->timestamp('ended_at')->nullable(); // retention clock starts here
            $table->timestamps();

            $table->index(['listing_id', 'kind']);
            $table->index('ended_at');
        });

        Schema::create('carpool_conversation_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained('carpool_conversations')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role', 10); // driver | rider
            $table->unsignedBigInteger('last_read_message_id')->default(0);
            $table->timestamp('left_at')->nullable();
            $table->timestamps();

            $table->unique(['conversation_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('carpool_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained('carpool_conversations')->cascadeOnDelete();
            $table->foreignId('sender_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('type', 16)->default('text'); // text | pickup_request | system
            $table->text('body');
            $table->json('meta')->nullable();
            $table->string('moderation_status', 12)->default('ok'); // ok | masked | removed
            $table->string('moderation_reason', 60)->nullable();
            $table->timestamps();

            $table->index(['conversation_id', 'id']);
        });

        Schema::create('carpool_pickup_proposals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('request_id')->constrained('carpool_requests')->cascadeOnDelete();
            $table->foreignId('message_id')->nullable()->constrained('carpool_messages')->nullOnDelete();
            $table->decimal('lat', 10, 7);
            $table->decimal('lng', 10, 7);
            $table->string('name', 120);
            $table->string('address', 255)->nullable();
            $table->unsignedInteger('along_m');
            $table->string('status', 10)->default('pending'); // pending | accepted | declined | replaced
            $table->timestamps();
        });

        Schema::create('carpool_reports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('reporter_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('reported_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('message_id')->nullable()->constrained('carpool_messages')->nullOnDelete();
            $table->text('message_text')->nullable(); // copy kept after chat deletion (A33)
            $table->foreignId('listing_id')->nullable()->constrained('carpool_listings')->nullOnDelete();
            $table->string('reason', 40);
            $table->text('details')->nullable();
            $table->string('status', 10)->default('open'); // open | actioned | dismissed
            $table->text('note')->nullable();
            $table->timestamps();

            $table->index('status');
        });

        Schema::create('carpool_banned_words', function (Blueprint $table) {
            $table->id();
            $table->string('word', 60)->unique();
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('carpool_banned_at')->nullable();
            $table->string('carpool_ban_reason', 255)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['carpool_banned_at', 'carpool_ban_reason']);
        });
        Schema::dropIfExists('carpool_banned_words');
        Schema::dropIfExists('carpool_reports');
        Schema::dropIfExists('carpool_pickup_proposals');
        Schema::dropIfExists('carpool_messages');
        Schema::dropIfExists('carpool_conversation_members');
        Schema::dropIfExists('carpool_conversations');
    }
};

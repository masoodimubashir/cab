<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Append-only log of Data Subject Access Requests (DSAR / "data rights") filed
 * from the operator settings panel — erasure, portability, access, etc. These
 * are event records, NOT singleton operator config, so they get their own table.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('data_subject_requests', function (Blueprint $table) {
            $table->id();
            $table->string('right');                  // erasure|portability|rectification|access|restrict|object
            $table->text('reason')->nullable();
            $table->string('status')->default('pending'); // pending|in_progress|completed|rejected
            $table->foreignId('requested_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('handled_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('handled_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('data_subject_requests');
    }
};

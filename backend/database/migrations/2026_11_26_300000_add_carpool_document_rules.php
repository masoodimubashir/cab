<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * S11 (expired documents): a driver's renewal waiting for review, an admin's "allow until" per document,
 * and the warning lead time setting. Carpool tables only; the shared documents tables are not changed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('carpool_document_renewals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained('drivers')->cascadeOnDelete();
            $table->foreignId('document_id')->constrained('documents')->cascadeOnDelete();
            $table->string('file_path');
            $table->date('expiry_date');
            $table->string('status', 12)->default('pending'); // pending, approved, rejected
            $table->string('rejection_reason', 255)->nullable();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();
            $table->index(['driver_id', 'document_id', 'status']);
        });

        Schema::create('carpool_document_overrides', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained('drivers')->cascadeOnDelete();
            $table->foreignId('document_id')->constrained('documents')->cascadeOnDelete();
            $table->date('allow_until');
            $table->string('note', 500);
            $table->foreignId('admin_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['driver_id', 'document_id']);
        });

        Schema::table('carpool_settings', function (Blueprint $table) {
            $table->unsignedTinyInteger('document_warning_days')->default(7)->after('plan_push_hours');
        });
    }

    public function down(): void
    {
        Schema::table('carpool_settings', function (Blueprint $table) {
            $table->dropColumn('document_warning_days');
        });
        Schema::dropIfExists('carpool_document_overrides');
        Schema::dropIfExists('carpool_document_renewals');
    }
};

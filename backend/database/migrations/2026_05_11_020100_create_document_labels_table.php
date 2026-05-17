<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('document_labels', function (Blueprint $table) {
            $table->id();
            $table->foreignId('document_id')
                ->constrained('documents')
                ->cascadeOnDelete();
            $table->string('label', 120);
            // Allowed values: text, number, date, url. Kept as a column rather
            // than enum so the operator can add new types later (e.g. boolean,
            // email) without a migration.
            $table->string('label_type', 20)->default('text');
            $table->boolean('mandatory')->default(false);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(['document_id', 'sort_order']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_labels');
    }
};

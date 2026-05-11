<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('documents', function (Blueprint $table) {
            $table->id();
            $table->string('name', 160);
            $table->unsignedSmallInteger('no_of_images')->default(1);

            // Category — operator-facing classification. Kept as a string column
            // (not an enum) so new categories can be added without a migration.
            $table->string('category', 60)->default('driver_document');

            // Required mode — e.g. mandatory_register, mandatory_drive, optional.
            $table->string('required', 40)->default('optional');

            // Document type — e.g. normal, gallery_restricted, gallery_with_label.
            // Drives how the customer/driver app renders the upload screen.
            $table->string('document_type', 40)->default('normal');

            $table->boolean('gallery_restricted')->default(false);
            $table->text('instructions')->nullable();

            // Status set by the "Add" action — global for now; per-vehicle scoping
            // arrives in a later migration.
            $table->string('status', 40)->nullable();

            $table->timestamps();

            $table->index('category');
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('documents');
    }
};

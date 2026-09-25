<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('app_banners', function (Blueprint $table) {
            $table->id();
            $table->string('title', 160);
            $table->string('image_path');
            $table->string('url_link', 500)->nullable();
            $table->enum('target_app', ['customer', 'driver', 'both'])->default('both');
            $table->enum('position', ['full_screen', 'half'])->default('full_screen');
            $table->boolean('is_active')->default(true);
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(['is_active', 'target_app', 'starts_at', 'ends_at'], 'app_banners_lookup_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('app_banners');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('fixed_route_alerts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('route_id')->constrained('routes')->cascadeOnDelete();
            $table->timestamp('expires_at')->index();
            $table->timestamp('notified_at')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'route_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fixed_route_alerts');
    }
};

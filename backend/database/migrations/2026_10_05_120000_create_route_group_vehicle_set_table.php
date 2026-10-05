<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('route_group_vehicle_set', function (Blueprint $table) {
            $table->foreignId('route_group_id')->constrained()->cascadeOnDelete();
            $table->foreignId('vehicle_set_id')->constrained()->cascadeOnDelete();
            $table->primary(['route_group_id', 'vehicle_set_id']);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('route_group_vehicle_set');
    }
};

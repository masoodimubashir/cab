<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('fixed_seat_holds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('route_departure_id')->constrained('route_departures')->cascadeOnDelete();
            $table->foreignId('customer_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedSmallInteger('seats')->default(1);
            $table->decimal('amount', 10, 2)->default(0);
            $table->enum('status', ['HELD', 'CONFIRMED', 'EXPIRED', 'RELEASED', 'FAILED'])->default('HELD');
            $table->timestamp('expires_at');
            $table->string('payment_reference', 191)->nullable();
            $table->timestamps();

            $table->index(['route_departure_id', 'status']);
            $table->index(['customer_id', 'status']);
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fixed_seat_holds');
    }
};

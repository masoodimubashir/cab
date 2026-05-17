<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-user saved locations (Home, Work, Mom's place, etc.). Customers can
 * pick one of these at booking time to skip address typing. Each row carries
 * the resolved lat/lng so we can drop it straight on the map without a
 * round-trip to a geocoder.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('saved_locations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('label', 80);          // "Home", "Office", "Mom"
            $table->string('address', 500);       // full readable address
            $table->decimal('lat', 10, 7);
            $table->decimal('lng', 10, 7);
            $table->string('icon', 40)->nullable();  // ion-icon name; UI default if null
            $table->timestamps();

            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('saved_locations');
    }
};

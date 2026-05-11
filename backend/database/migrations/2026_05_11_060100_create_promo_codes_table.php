<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('promo_codes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained()->cascadeOnDelete();

            $table->string('code')->index();          // user-facing code
            $table->unsignedInteger('max_number')->nullable();   // global redemption cap
            $table->date('start_date');
            $table->date('end_date');
            $table->unsignedInteger('validity_in_days')->nullable(); // days after issue

            // 'cash' for now per the dropdown in the screenshot; keep as string
            // so 'coupon' / 'points' / 'cashback' can be added later.
            $table->string('bonus_type')->default('cash');

            $table->boolean('can_use_with_referral')->default(false);
            $table->decimal('amount', 10, 2)->default(0);

            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['city_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('promo_codes');
    }
};

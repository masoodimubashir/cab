<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('coupon_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('coupon_id')->constrained('coupons')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            // Operator-supplied context — kept on the assignment so the audit log
            // and customer-facing notification remain self-contained.
            $table->string('reason', 255);
            $table->text('push_message')->nullable();
            $table->dateTime('expires_at')->nullable();
            $table->dateTime('assigned_at')->useCurrent();
            // Filled in when the customer redeems it on a booking; null until then.
            $table->dateTime('used_at')->nullable();
            $table->foreignId('redeemed_trip_id')->nullable()->constrained('trips')->nullOnDelete();
            $table->foreignId('assigned_by_admin_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['coupon_id', 'user_id']);
            $table->index(['user_id', 'used_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('coupon_assignments');
    }
};

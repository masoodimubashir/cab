<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('wallet_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            $table->decimal('amount', 10, 2);

            // credit             = admin added money / refund / promo bonus
            // debit              = admin took money away / ride payment
            // cashback           = post-ride promo credit
            // driver_added_cash  = driver collected cash on behalf of the wallet
            $table->enum('type', ['credit', 'debit', 'cashback', 'driver_added_cash']);

            // Optional link to the trip the transaction came from (refund, payment, etc).
            $table->foreignId('engagement_id')->nullable()
                ->constrained('trips')->nullOnDelete();

            $table->text('reason')->nullable();

            // Admin who triggered the transaction. Nullable for system-originated
            // entries (ride payments processed automatically in the future).
            $table->foreignId('created_by_user_id')->nullable()
                ->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wallet_transactions');
    }
};

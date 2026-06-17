<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cities', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('country_code', 2)->default('IN');
            $table->timestamps();
        });

        Schema::create('ride_types', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique(); // Mini, Sedan, SUV, Outstation, Rental...
            $table->string('description')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('pricing_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->foreignId('ride_type_id')->constrained('ride_types')->cascadeOnDelete();

            $table->decimal('base_fare', 10, 2)->default(0);
            $table->decimal('surge_multiplier', 8, 3)->default(1);

            // Driver commission percent (e.g. 20 = driver gets 80%).
            $table->decimal('commission_percent', 5, 2)->default(20);

            $table->timestamps();

            $table->unique(['city_id', 'ride_type_id']);
        });

        Schema::create('drivers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained('users')->cascadeOnDelete();
            $table->enum('approval_status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('rejected_at')->nullable();

            $table->string('vehicle_type')->nullable();
            $table->string('vehicle_brand')->nullable();
            $table->string('vehicle_model')->nullable();
            $table->string('vehicle_color')->nullable();
            $table->string('vehicle_reg_no')->unique()->nullable();

            $table->decimal('rating_avg', 3, 2)->default(0);
            $table->unsignedInteger('rating_count')->default(0);

            $table->boolean('is_online')->default(false);
            $table->timestamp('last_online_at')->nullable();
            $table->timestamp('last_offline_at')->nullable();

            $table->timestamps();
        });

        Schema::create('driver_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained('drivers')->cascadeOnDelete();
            $table->enum('document_type', ['DL', 'RC', 'INSURANCE', 'ID'])->index();
            $table->string('file_path');
            $table->enum('status', ['uploaded', 'approved', 'rejected'])->default('uploaded');
            $table->text('rejection_reason')->nullable();
            $table->timestamps();

            $table->unique(['driver_id', 'document_type']);
        });

        Schema::create('trips', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('driver_id')->nullable()->constrained('users')->nullOnDelete();

            $table->foreignId('ride_type_id')->constrained('ride_types');
            $table->foreignId('pricing_rule_id')->nullable()->constrained('pricing_rules')->nullOnDelete();

            $table->enum('status', [
                'REQUESTED',
                'NEGOTIATION',
                'CONFIRMED',
                'ASSIGNED',
                'EN_ROUTE_PICKUP',
                'ARRIVED_PICKUP',
                'EN_ROUTE_DROP',
                'ARRIVED_DROP',
                'COMPLETED',
                'CANCELLED',
            ])->default('REQUESTED');

            $table->decimal('estimated_fare', 10, 2)->nullable();
            $table->decimal('final_fare', 10, 2)->nullable();
            $table->string('currency', 3)->default('INR');

            $table->text('pickup_address')->nullable();
            $table->decimal('pickup_lat', 10, 7);
            $table->decimal('pickup_lng', 10, 7);

            $table->text('drop_address')->nullable();
            $table->decimal('drop_lat', 10, 7);
            $table->decimal('drop_lng', 10, 7);

            $table->text('cancelled_reason')->nullable();
            $table->timestamp('cancelled_at')->nullable();

            $table->timestamp('negotiation_started_at')->nullable();
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('assigned_at')->nullable();
            $table->timestamp('en_route_pickup_at')->nullable();
            $table->timestamp('arrived_pickup_at')->nullable();
            $table->timestamp('en_route_drop_at')->nullable();
            $table->timestamp('arrived_drop_at')->nullable();
            $table->timestamp('completed_at')->nullable();

            $table->timestamps();

            $table->index(['customer_id', 'status']);
            $table->index(['driver_id', 'status']);
        });

        Schema::create('fare_negotiations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->unique()->constrained('trips')->cascadeOnDelete();
            $table->foreignId('customer_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('driver_id')->nullable()->constrained('users')->nullOnDelete();

            $table->enum('status', ['NEGOTIATING', 'LOCKED', 'CANCELLED'])->default('NEGOTIATING');
            $table->decimal('final_amount', 10, 2)->nullable();
            $table->timestamp('locked_at')->nullable();

            $table->timestamps();
        });

        Schema::create('fare_negotiation_offers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fare_negotiation_id')->constrained('fare_negotiations')->cascadeOnDelete();
            $table->foreignId('from_user_id')->constrained('users')->cascadeOnDelete();

            $table->enum('from_role', ['customer', 'driver']);
            $table->decimal('amount', 10, 2);
            $table->enum('status', ['PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'])->default('PENDING');

            $table->foreignId('accepted_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decision_at')->nullable();
            $table->text('note')->nullable();

            $table->timestamps();
            $table->index(['fare_negotiation_id', 'created_at']);
        });

        Schema::create('trip_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->constrained('trips')->cascadeOnDelete();
            $table->foreignId('driver_id')->constrained('users')->cascadeOnDelete();

            $table->enum('status', ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'])->default('PENDING');
            $table->timestamp('assigned_at')->nullable();
            $table->timestamp('decided_at')->nullable();

            $table->timestamps();
            $table->unique(['trip_id', 'driver_id']);
            $table->index(['trip_id', 'status']);
        });

        Schema::create('driver_locations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('trip_id')->nullable()->constrained('trips')->nullOnDelete();

            $table->decimal('lat', 10, 7);
            $table->decimal('lng', 10, 7);
            $table->decimal('accuracy_m', 8, 2)->nullable();
            $table->decimal('speed_kmh', 8, 2)->nullable();
            $table->unsignedSmallInteger('bearing_deg')->nullable();

            $table->timestamp('recorded_at')->useCurrent();
            $table->timestamps(); // keeps Eloquent expectations (optional)

            $table->index(['trip_id', 'recorded_at']);
            $table->index(['driver_id', 'recorded_at']);
        });

        Schema::create('trip_share_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->unique()->constrained('trips')->cascadeOnDelete();
            $table->foreignId('created_by_user_id')->constrained('users')->cascadeOnDelete();

            $table->string('token', 64)->unique();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('revoked_at')->nullable();

            $table->timestamps();
        });

        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->unique()->constrained('trips')->cascadeOnDelete();
            $table->enum('method', ['CASH', 'UPI']);
            $table->enum('provider', ['RAZORPAY', 'NONE'])->default('NONE');
            $table->enum('status', ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'])->default('PENDING');

            $table->decimal('amount', 10, 2);
            $table->string('currency', 3)->default('INR');

            $table->string('razorpay_order_id')->nullable()->index();
            $table->string('razorpay_payment_id')->nullable()->index();
            $table->json('provider_response')->nullable();

            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
        });

        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->unique()->constrained('trips')->cascadeOnDelete();

            $table->string('invoice_no')->unique();
            $table->string('pdf_path')->nullable();
            $table->json('meta')->nullable();

            $table->decimal('total_amount', 10, 2);
            $table->string('currency', 3)->default('INR');
            $table->timestamp('issued_at')->nullable();
            $table->timestamps();
        });

        Schema::create('ratings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->unique()->constrained('trips')->cascadeOnDelete();
            $table->foreignId('customer_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('driver_id')->constrained('users')->cascadeOnDelete();

            $table->unsignedTinyInteger('score'); // 1-5
            $table->text('comment')->nullable();
            $table->timestamps();
        });

        Schema::create('safety_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->nullable()->constrained('trips')->nullOnDelete();
            $table->enum('type', ['SOS'])->default('SOS');
            $table->foreignId('initiator_user_id')->constrained('users')->cascadeOnDelete();
            $table->enum('status', ['CREATED', 'SENT', 'RESOLVED'])->default('CREATED');

            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->json('payload')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->index(['initiator_user_id', 'created_at']);
        });

        Schema::create('trip_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->constrained('trips')->cascadeOnDelete();
            $table->foreignId('sender_user_id')->constrained('users')->cascadeOnDelete();

            $table->enum('message_type', ['TEXT'])->default('TEXT');
            $table->text('body');

            $table->enum('moderation_status', ['VISIBLE', 'FLAGGED', 'REMOVED'])->default('VISIBLE');
            $table->foreignId('moderated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('moderation_reason')->nullable();

            $table->timestamps();

            $table->index(['trip_id', 'created_at']);
        });

        // Useful for quick lookups, but we keep it as a derived relation elsewhere.
        // (No extra tables for admin analytics in this migration.)
    }

    public function down(): void
    {
        Schema::dropIfExists('trip_messages');
        Schema::dropIfExists('safety_events');
        Schema::dropIfExists('ratings');
        Schema::dropIfExists('invoices');
        Schema::dropIfExists('payments');
        Schema::dropIfExists('trip_share_links');
        Schema::dropIfExists('driver_locations');
        Schema::dropIfExists('trip_assignments');
        Schema::dropIfExists('fare_negotiation_offers');
        Schema::dropIfExists('fare_negotiations');
        Schema::dropIfExists('trips');
        Schema::dropIfExists('driver_documents');
        Schema::dropIfExists('drivers');
        Schema::dropIfExists('pricing_rules');
        Schema::dropIfExists('ride_types');
        Schema::dropIfExists('cities');
    }
};


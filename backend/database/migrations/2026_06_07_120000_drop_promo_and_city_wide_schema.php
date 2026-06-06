<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Removes the retired "City-wide promotions" + "Promo codes" feature schema.
 *
 * The application code (models, controllers, routes, the discount plumbing in
 * fare estimation) was already deleted; this drops the now-orphaned tables and
 * the trip/seat columns that referenced them. The trip FK is dropped before the
 * promotions table so the drop order is constraint-safe.
 *
 * down() recreates the schema structurally (final column set) so the migration
 * is reversible, but it does NOT restore any rows — the feature's data is gone.
 */
return new class extends Migration {
    public function up(): void
    {
        // 1) Detach trips from city_wide_promotions, then drop its promo columns.
        Schema::table('trips', function (Blueprint $table) {
            if (Schema::hasColumn('trips', 'applied_promotion_id')) {
                $table->dropConstrainedForeignId('applied_promotion_id');
            }
            if (Schema::hasColumn('trips', 'promo_discount_amount')) {
                $table->dropColumn('promo_discount_amount');
            }
        });

        // 2) Drop the unused seat-reservation promo column.
        Schema::table('seat_reservations', function (Blueprint $table) {
            if (Schema::hasColumn('seat_reservations', 'promo_discount_amount')) {
                $table->dropColumn('promo_discount_amount');
            }
        });

        // 3) Drop the feature tables (assignments → codes → promotions; FK order).
        Schema::dropIfExists('promo_code_assignments');
        Schema::dropIfExists('promo_codes');
        Schema::dropIfExists('city_wide_promotions');
    }

    public function down(): void
    {
        // Recreate city_wide_promotions first so the trips FK can re-attach.
        if (! Schema::hasTable('city_wide_promotions')) {
            Schema::create('city_wide_promotions', function (Blueprint $table) {
                $table->id();
                $table->foreignId('city_id')->constrained()->cascadeOnDelete();
                $table->string('title');
                $table->string('benefit_type')->default('discount');
                $table->string('promo_type')->default('location_insensitive');
                $table->string('location_type')->nullable();
                $table->string('location_name')->nullable();
                $table->decimal('latitude', 10, 7)->nullable();
                $table->decimal('longitude', 10, 7)->nullable();
                $table->unsignedInteger('radius_meters')->nullable();
                $table->string('discount_type')->default('percentage');
                $table->decimal('discount_value', 10, 2)->default(0);
                $table->decimal('discount_maximum', 10, 2)->nullable();
                $table->date('start_date')->nullable();
                $table->date('end_date')->nullable();
                $table->unsignedInteger('maximum_allowed')->nullable();
                $table->unsignedInteger('per_user_limit')->nullable();
                $table->unsignedInteger('per_day_limit')->nullable();
                $table->json('allowed_vehicle_type_ids')->nullable();
                $table->text('terms_and_conditions')->nullable();
                $table->boolean('is_active')->default(true);
                $table->timestamps();
                $table->index(['city_id', 'is_active']);
                $table->index(['start_date', 'end_date']);
            });
        }

        if (! Schema::hasTable('promo_codes')) {
            Schema::create('promo_codes', function (Blueprint $table) {
                $table->id();
                $table->foreignId('city_id')->constrained()->cascadeOnDelete();
                $table->string('code')->index();
                $table->unsignedInteger('max_number')->nullable();
                $table->date('start_date');
                $table->date('end_date');
                $table->unsignedInteger('validity_in_days')->nullable();
                $table->string('bonus_type')->default('cash');
                $table->boolean('can_use_with_referral')->default(false);
                $table->decimal('amount', 10, 2)->default(0);
                $table->boolean('is_active')->default(true);
                $table->timestamps();
                $table->unique(['city_id', 'code']);
            });
        }

        if (! Schema::hasTable('promo_code_assignments')) {
            Schema::create('promo_code_assignments', function (Blueprint $table) {
                $table->id();
                $table->foreignId('promo_code_id')->constrained('promo_codes')->cascadeOnDelete();
                $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
                $table->string('reason', 255);
                $table->text('push_message')->nullable();
                $table->dateTime('expires_at')->nullable();
                $table->dateTime('assigned_at')->useCurrent();
                $table->dateTime('used_at')->nullable();
                $table->foreignId('redeemed_trip_id')->nullable()->constrained('trips')->nullOnDelete();
                $table->foreignId('assigned_by_admin_id')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                $table->unique(['promo_code_id', 'user_id']);
                $table->index(['user_id', 'used_at']);
            });
        }

        Schema::table('trips', function (Blueprint $table) {
            if (! Schema::hasColumn('trips', 'applied_promotion_id')) {
                $table->foreignId('applied_promotion_id')
                    ->nullable()
                    ->after('outstation_package_id')
                    ->constrained('city_wide_promotions')
                    ->nullOnDelete();
            }
            if (! Schema::hasColumn('trips', 'promo_discount_amount')) {
                $table->decimal('promo_discount_amount', 10, 2)
                    ->nullable()
                    ->after('applied_promotion_id');
            }
        });

        Schema::table('seat_reservations', function (Blueprint $table) {
            if (! Schema::hasColumn('seat_reservations', 'promo_discount_amount')) {
                $table->decimal('promo_discount_amount', 10, 2)->nullable();
            }
        });
    }
};

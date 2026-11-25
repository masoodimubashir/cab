<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Carpool admin tools (Admin-Audit.md section 7): an append-only log of admin actions,
 * the car as it was when a carpool was published, two settings (plan warning days and
 * how long closed reports keep their text), and the carpool_settings permission.
 * All additive; nothing existing changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('carpool_admin_actions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('admin_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('admin_name', 120)->nullable(); // kept if the admin account is removed later
            $table->string('action', 40);
            $table->string('target_type', 20); // listing, request, report, user, driver, plan, settings, word
            $table->unsignedBigInteger('target_id')->nullable();
            $table->unsignedBigInteger('subject_user_id')->nullable(); // the person the action was about, if any
            $table->unsignedBigInteger('listing_id')->nullable();
            $table->text('note')->nullable();
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index(['target_type', 'target_id']);
            $table->index('subject_user_id');
            $table->index('listing_id');
        });

        Schema::table('carpool_listings', function (Blueprint $table) {
            $table->string('car_plate', 20)->nullable()->after('vehicle_id');
            $table->string('car_label', 140)->nullable()->after('car_plate');
        });

        Schema::table('carpool_settings', function (Blueprint $table) {
            $table->unsignedTinyInteger('plan_warning_days')->default(3)->after('missed_departure_days');
            $table->unsignedSmallInteger('report_retention_days')->default(180)->after('plan_warning_days');
        });

        if (Schema::hasTable('permissions') && ! DB::table('permissions')->where('slug', 'carpool_settings')->exists()) {
            DB::table('permissions')->insert([
                'slug' => 'carpool_settings',
                'name' => 'Carpool settings',
                'group' => 'Operations',
                'description' => 'Change carpool settings, switch carpool on or off, and edit banned words.',
                'sort_order' => 304,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('permissions')) {
            $id = DB::table('permissions')->where('slug', 'carpool_settings')->value('id');
            if ($id) {
                if (Schema::hasTable('manager_role_permissions')) {
                    DB::table('manager_role_permissions')->where('permission_id', $id)->delete();
                }
                DB::table('permissions')->where('id', $id)->delete();
            }
        }
        Schema::table('carpool_settings', function (Blueprint $table) {
            $table->dropColumn(['plan_warning_days', 'report_retention_days']);
        });
        Schema::table('carpool_listings', function (Blueprint $table) {
            $table->dropColumn(['car_plate', 'car_label']);
        });
        Schema::dropIfExists('carpool_admin_actions');
    }
};

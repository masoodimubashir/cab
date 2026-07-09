<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            if (!Schema::hasColumn('city_settings', 'commission_type')) {
                $table->enum('commission_type', ['percent', 'fixed'])->default('percent')->after('negotiation_floor_percent');
            }
            if (!Schema::hasColumn('city_settings', 'commission_percent')) {
                $table->decimal('commission_percent', 5, 2)->default(0)->after('commission_type');
            }
            if (!Schema::hasColumn('city_settings', 'fixed_commission')) {
                $table->decimal('fixed_commission', 10, 2)->default(0)->after('commission_percent');
            }
            if (!Schema::hasColumn('city_settings', 'toll_mode')) {
                $table->enum('toll_mode', ['no', 'yes'])->default('no')->after('fixed_commission');
            }
            if (!Schema::hasColumn('city_settings', 'show_low_wallet_alert')) {
                $table->boolean('show_low_wallet_alert')->default(true)->after('toll_mode');
            }
        });

        if (Schema::hasTable('city_vehicle_types')) {
            $cities = DB::table('city_vehicle_types')
                ->select('city_id')
                ->distinct()
                ->pluck('city_id');

            foreach ($cities as $cityId) {
                $row = DB::table('city_vehicle_types')
                    ->where('city_id', $cityId)
                    ->orderBy('display_order')
                    ->orderBy('id')
                    ->first();

                if (!$row) {
                    continue;
                }

                DB::table('city_settings')->updateOrInsert(
                    ['city_id' => $cityId],
                    [
                        'commission_type' => $row->commission_type ?? 'percent',
                        'commission_percent' => $row->commission_percent ?? 0,
                        'fixed_commission' => $row->fixed_commission ?? 0,
                        'toll_mode' => $row->toll_mode ?? 'no',
                        'show_low_wallet_alert' => (bool) ($row->show_low_wallet_alert ?? true),
                        'updated_at' => now(),
                        'created_at' => now(),
                    ]
                );
            }

            Schema::table('city_vehicle_types', function (Blueprint $table) {
                $drops = [];
                foreach (['commission_type', 'commission_percent', 'fixed_commission', 'toll_mode', 'show_low_wallet_alert'] as $column) {
                    if (Schema::hasColumn('city_vehicle_types', $column)) {
                        $drops[] = $column;
                    }
                }
                if ($drops) {
                    $table->dropColumn($drops);
                }
            });
        }
    }

    public function down(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            if (!Schema::hasColumn('city_vehicle_types', 'show_low_wallet_alert')) {
                $table->boolean('show_low_wallet_alert')->default(true)->after('multiple_destinations_enabled');
            }
            if (!Schema::hasColumn('city_vehicle_types', 'toll_mode')) {
                $table->enum('toll_mode', ['no', 'yes'])->default('no')->after('show_low_wallet_alert');
            }
            if (!Schema::hasColumn('city_vehicle_types', 'commission_percent')) {
                $table->decimal('commission_percent', 5, 2)->default(0)->after('toll_mode');
            }
            if (!Schema::hasColumn('city_vehicle_types', 'fixed_commission')) {
                $table->decimal('fixed_commission', 10, 2)->default(0)->after('commission_percent');
            }
            if (!Schema::hasColumn('city_vehicle_types', 'commission_type')) {
                $table->enum('commission_type', ['percent', 'fixed'])->default('percent')->after('toll_mode');
            }
        });

        if (Schema::hasTable('city_vehicle_types') && Schema::hasTable('city_settings')) {
            $settings = DB::table('city_settings')->get();
            foreach ($settings as $setting) {
                DB::table('city_vehicle_types')
                    ->where('city_id', $setting->city_id)
                    ->update([
                        'commission_type' => 'percent',
                        'commission_percent' => $setting->commission_percent ?? 0,
                        'fixed_commission' => $setting->fixed_commission ?? 0,
                        'toll_mode' => $setting->toll_mode ?? 'no',
                        'show_low_wallet_alert' => (bool) ($setting->show_low_wallet_alert ?? true),
                    ]);
            }
        }

        Schema::table('city_settings', function (Blueprint $table) {
            $drops = [];
            foreach (['commission_type', 'commission_percent', 'fixed_commission', 'toll_mode', 'show_low_wallet_alert'] as $column) {
                if (Schema::hasColumn('city_settings', $column)) {
                    $drops[] = $column;
                }
            }
            if ($drops) {
                $table->dropColumn($drops);
            }
        });
    }
};

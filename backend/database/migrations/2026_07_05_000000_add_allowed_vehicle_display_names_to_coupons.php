<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('coupons', function (Blueprint $table) {
            if (! Schema::hasColumn('coupons', 'allowed_vehicle_display_names')) {
                $table->json('allowed_vehicle_display_names')->nullable()->after('allowed_vehicle_type_ids');
            }
        });


        DB::table('coupons')->orderBy('id')->chunkById(100, function ($coupons) {
            foreach ($coupons as $coupon) {
                if (! empty($coupon->allowed_vehicle_display_names)) {
                    continue;
                }

                $ids = json_decode((string) $coupon->allowed_vehicle_type_ids, true);
                if (! is_array($ids) || empty($ids)) {
                    continue;
                }

                $names = [];
                foreach ($ids as $id) {
                    $match = DB::table('city_vehicle_types')
                        ->where('id', (int) $id)
                        ->where('city_id', $coupon->city_id)
                        ->value('display_name');
                    if ($match !== null) {
                        $names[] = trim((string) $match);
                    }
                }

                $names = array_values(array_unique(array_filter($names, fn ($name) => $name !== '')));
                if (empty($names)) {
                    continue;
                }

                DB::table('coupons')
                    ->where('id', $coupon->id)
                    ->update(['allowed_vehicle_display_names' => json_encode($names)]);
            }
        });
    }

    public function down(): void
    {
        Schema::table('coupons', function (Blueprint $table) {
            if (Schema::hasColumn('coupons', 'allowed_vehicle_display_names')) {
                $table->dropColumn('allowed_vehicle_display_names');
            }
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The percent/fixed commission choice for a fixed route used to fall back to the
 * city's CitySetting when the route's own fare_config didn't carry it. That
 * fallback is being removed (each route is now self-describing), and the
 * CitySetting commission columns are about to be dropped. So freeze each
 * existing route's effective commission onto its own fare_config first — any
 * route already carrying commission_type is left untouched.
 */
return new class extends Migration
{
    public function up(): void
    {
        $cityCommission = DB::table('city_settings')
            ->get(['city_id', 'commission_type', 'commission_percent', 'fixed_commission'])
            ->keyBy('city_id');

        DB::table('routes')->whereNotNull('fare_config')->orderBy('id')
            ->each(function ($route) use ($cityCommission) {
                $fareConfig = json_decode($route->fare_config, true);
                if (!is_array($fareConfig) || array_key_exists('commission_type', $fareConfig)) {
                    return; // no fare_config to speak of, or already self-describing
                }

                $city = $cityCommission->get($route->city_id);
                $type = ($city->commission_type ?? 'percent') === 'fixed' ? 'fixed' : 'percent';

                $fareConfig['commission_type'] = $type;
                $fareConfig['commission_percent'] = $type === 'percent'
                    ? round((float) ($city->commission_percent ?? 0), 2) : 0;
                $fareConfig['fixed_commission'] = $type === 'fixed'
                    ? round((float) ($city->fixed_commission ?? 0), 2) : 0;

                DB::table('routes')->where('id', $route->id)
                    ->update(['fare_config' => json_encode($fareConfig)]);
            });
    }

    public function down(): void
    {
        // One-way data backfill — the frozen commission stays on each route.
    }
};

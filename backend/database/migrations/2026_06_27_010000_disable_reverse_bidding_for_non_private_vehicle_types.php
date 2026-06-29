<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('city_vehicle_types')
            ->join('ride_types', 'ride_types.id', '=', 'city_vehicle_types.ride_type_id')
            ->where(function ($query) {
                $query->whereRaw('LOWER(ride_types.name) LIKE ?', ['%fixed%'])
                    ->orWhereRaw('LOWER(ride_types.name) LIKE ?', ['%shuttle%']);
            })
            ->update(['city_vehicle_types.reverse_bidding_enabled' => false]);
    }

    public function down(): void
    {
        // Intentionally no rollback: previous true/false values are not recoverable.
    }
};

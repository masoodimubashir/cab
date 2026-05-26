<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        // 1. Trips: widen the enum so 'razorpay' is accepted, collapse upi/qr
        //    into razorpay, then narrow the enum to the final set.
        DB::statement("ALTER TABLE trips MODIFY COLUMN payment_method ENUM('cash','upi','qr','razorpay') NULL");
        DB::statement("UPDATE trips SET payment_method = 'razorpay' WHERE payment_method IN ('upi','qr')");
        DB::statement("ALTER TABLE trips MODIFY COLUMN payment_method ENUM('cash','razorpay') NULL");

        // 2. Driver-accepted methods on users: map upi/qr → razorpay, dedupe.
        $userRows = DB::table('users')
            ->whereNotNull('accepted_payment_methods')
            ->get(['id', 'accepted_payment_methods']);
        foreach ($userRows as $u) {
            $methods = json_decode($u->accepted_payment_methods, true);
            if (!is_array($methods)) {
                continue;
            }
            $mapped = array_values(array_unique(array_map(
                fn ($m) => in_array($m, ['upi', 'qr'], true) ? 'razorpay' : $m,
                $methods,
            )));
            $mapped = array_values(array_intersect($mapped, ['cash', 'razorpay']));
            if (empty($mapped)) {
                $mapped = ['razorpay'];
            }
            DB::table('users')->where('id', $u->id)->update([
                'accepted_payment_methods' => json_encode($mapped),
            ]);
        }

        // 3. City-level allowed driver payment modes: prune to CASH/RAZORPAY,
        //    default everything to ['RAZORPAY'] so new and existing cities
        //    always have at least one mode enabled.
        $cityRows = DB::table('city_settings')->get(['id', 'allowed_driver_payment_modes']);
        foreach ($cityRows as $row) {
            $modes = json_decode($row->allowed_driver_payment_modes ?: 'null', true);
            if (!is_array($modes) || empty($modes)) {
                $modes = ['RAZORPAY'];
            } else {
                $modes = array_values(array_intersect($modes, ['CASH', 'RAZORPAY']));
                if (empty($modes)) {
                    $modes = ['RAZORPAY'];
                }
            }
            DB::table('city_settings')->where('id', $row->id)->update([
                'allowed_driver_payment_modes' => json_encode($modes),
            ]);
        }

        // 4. Payment records: legacy UPI/QR method values, normalise to RAZORPAY.
        DB::statement("UPDATE payments SET method = 'RAZORPAY' WHERE method IN ('UPI','QR')");
    }

    public function down(): void
    {
        // Widen the enum back; existing razorpay rows stay as-is.
        DB::statement("ALTER TABLE trips MODIFY COLUMN payment_method ENUM('cash','upi','qr','razorpay') NULL");
    }
};

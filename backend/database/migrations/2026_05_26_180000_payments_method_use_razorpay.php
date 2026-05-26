<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql' || $driver === 'mariadb') {
            // Widen first so legacy UPI/QR rows can be remapped, then narrow.
            DB::statement("ALTER TABLE payments MODIFY COLUMN method ENUM('CASH','UPI','QR','RAZORPAY') NOT NULL");
            DB::statement("UPDATE payments SET method = 'RAZORPAY' WHERE method IN ('UPI','QR')");
            DB::statement("ALTER TABLE payments MODIFY COLUMN method ENUM('CASH','RAZORPAY') NOT NULL");
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check');
            DB::statement("UPDATE payments SET method = 'RAZORPAY' WHERE method IN ('UPI','QR')");
            DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('CASH','RAZORPAY'))");
        }
    }

    public function down(): void
    {
        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql' || $driver === 'mariadb') {
            DB::statement("ALTER TABLE payments MODIFY COLUMN method ENUM('CASH','UPI','QR','RAZORPAY') NOT NULL");
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check');
            DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('CASH','UPI','QR','RAZORPAY'))");
        }
    }
};

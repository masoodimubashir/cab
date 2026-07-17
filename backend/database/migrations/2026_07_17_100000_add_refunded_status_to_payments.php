<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// B1: refund.processed webhooks must be recordable on solo-ride payments,
// so the status enum gains REFUNDED alongside the original four values.
return new class extends Migration {
    public function up(): void
    {
        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql' || $driver === 'mariadb') {
            DB::statement("ALTER TABLE payments MODIFY COLUMN status ENUM('PENDING','SUCCESS','FAILED','CANCELLED','REFUNDED') NOT NULL DEFAULT 'PENDING'");
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check');
            DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('PENDING','SUCCESS','FAILED','CANCELLED','REFUNDED'))");
        }
        // sqlite: enum is a plain TEXT check-less column via Laravel; nothing to do.
    }

    public function down(): void
    {
        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql' || $driver === 'mariadb') {
            DB::statement("UPDATE payments SET status = 'CANCELLED' WHERE status = 'REFUNDED'");
            DB::statement("ALTER TABLE payments MODIFY COLUMN status ENUM('PENDING','SUCCESS','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING'");
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check');
            DB::statement("UPDATE payments SET status = 'CANCELLED' WHERE status = 'REFUNDED'");
            DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('PENDING','SUCCESS','FAILED','CANCELLED'))");
        }
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->enum('payment_method', ['cash', 'upi', 'qr'])->nullable()->after('currency');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->json('accepted_payment_methods')->nullable()->after('avatar_path');
        });

        DB::table('users')->update([
            'accepted_payment_methods' => json_encode(['cash', 'upi', 'qr']),
        ]);

        // Extend payments.method to allow QR (was enum CASH|UPI).
        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql' || $driver === 'mariadb') {
            DB::statement("ALTER TABLE payments MODIFY COLUMN method ENUM('CASH','UPI','QR') NOT NULL");
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check');
            DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('CASH','UPI','QR'))");
        }
        // sqlite: enums are stored as TEXT with no constraint, no change needed.
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropColumn('payment_method');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('accepted_payment_methods');
        });

        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql' || $driver === 'mariadb') {
            DB::statement("ALTER TABLE payments MODIFY COLUMN method ENUM('CASH','UPI') NOT NULL");
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check');
            DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('CASH','UPI'))");
        }
    }
};

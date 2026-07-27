<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('fleets', function (Blueprint $table) {
            if (! Schema::hasColumn('fleets', 'phone_number')) {
                $table->string('phone_number', 32)->nullable()->after('name');
            }
            if (! Schema::hasColumn('fleets', 'bank')) {
                $table->string('bank', 160)->nullable()->after('phone_number');
            }
            if (! Schema::hasColumn('fleets', 'address')) {
                $table->text('address')->nullable()->after('bank');
            }
            if (! Schema::hasColumn('fleets', 'vat_enabled')) {
                $table->boolean('vat_enabled')->default(false)->after('address');
            }
            if (! Schema::hasColumn('fleets', 'vat_number')) {
                $table->string('vat_number', 80)->nullable()->after('vat_enabled');
            }
            // Free-form status string; defaults to 'active'. is_active is preserved as a quick
            // toggle but `status` lets ops mark fleets as 'suspended', 'pending', etc.
            if (! Schema::hasColumn('fleets', 'status')) {
                $table->string('status', 32)->default('active')->after('vat_number');
            }
        });
    }

    public function down(): void
    {
        Schema::table('fleets', function (Blueprint $table) {
            foreach (['status', 'vat_number', 'vat_enabled', 'address', 'bank', 'phone_number'] as $col) {
                if (Schema::hasColumn('fleets', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};

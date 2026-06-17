<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pricing_rules', function (Blueprint $table) {
            $drop = array_values(array_filter([
                Schema::hasColumn('pricing_rules', 'per_km') ? 'per_km' : null,
                Schema::hasColumn('pricing_rules', 'per_min') ? 'per_min' : null,
                Schema::hasColumn('pricing_rules', 'min_fare') ? 'min_fare' : null,
            ]));

            if ($drop) {
                $table->dropColumn($drop);
            }
        });
    }

    public function down(): void
    {
        Schema::table('pricing_rules', function (Blueprint $table) {
            if (! Schema::hasColumn('pricing_rules', 'per_km')) {
                $table->decimal('per_km', 10, 2)->default(0)->after('base_fare');
            }
            if (! Schema::hasColumn('pricing_rules', 'per_min')) {
                $table->decimal('per_min', 10, 2)->default(0)->after('per_km');
            }
            if (! Schema::hasColumn('pricing_rules', 'min_fare')) {
                $table->decimal('min_fare', 10, 2)->nullable()->after('commission_percent');
            }
        });
    }
};

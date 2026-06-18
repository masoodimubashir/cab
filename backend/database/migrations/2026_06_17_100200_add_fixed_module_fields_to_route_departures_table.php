<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('route_departures', function (Blueprint $table) {
            $table->enum('departure_kind', ['scheduled', 'driver_opened'])
                ->default('scheduled')
                ->after('service_date');
            $table->timestamp('announced_depart_at')->nullable()->after('depart_at');
            $table->timestamp('actual_depart_at')->nullable()->after('announced_depart_at');
            $table->timestamp('boarding_opened_at')->nullable()->after('actual_depart_at');
            $table->timestamp('boarding_closed_at')->nullable()->after('boarding_opened_at');
            $table->boolean('visible_to_customers')->default(false)->after('boarding_closed_at');
            $table->timestamp('wait_reminder_sent_at')->nullable()->after('visible_to_customers');

            $table->index(['route_id', 'visible_to_customers', 'service_date'], 'route_departures_visible_idx');
            $table->index(['status', 'visible_to_customers', 'depart_at'], 'route_departures_status_visible_idx');
        });
    }

    public function down(): void
    {
        Schema::table('route_departures', function (Blueprint $table) {
            $table->dropIndex('route_departures_visible_idx');
            $table->dropIndex('route_departures_status_visible_idx');
            $table->dropColumn([
                'departure_kind',
                'announced_depart_at',
                'actual_depart_at',
                'boarding_opened_at',
                'boarding_closed_at',
                'visible_to_customers',
                'wait_reminder_sent_at',
            ]);
        });
    }
};

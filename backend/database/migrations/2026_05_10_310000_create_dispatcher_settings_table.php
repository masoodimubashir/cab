<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('dispatcher_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->enum('kind', ['local', 'rental', 'outstation']);

            // Auto-dispatch hop loop
            $table->boolean('automatic_dispatcher_type')->default(true);
            $table->unsignedSmallInteger('dispatcher_hop_interval_sec')->default(5);
            $table->unsignedInteger('dispatcher_hop_radius_m')->default(500);
            $table->unsignedInteger('request_radius_m')->default(0);
            $table->unsignedSmallInteger('max_hops')->default(5);

            // Scheduled-ride behaviour
            $table->boolean('schedule_available')->default(true);
            $table->boolean('schedule_dispatcher_type')->default(true);
            $table->boolean('dispatch_only_assigned_scheduled')->default(false);
            $table->enum('schedule_dispatch_instantly', ['DELAYED', 'INSTANT', 'INSTANT_AND_DELAYED'])
                ->default('DELAYED');
            $table->unsignedSmallInteger('scheduler_alarm_min')->default(15);

            // Booking-window guardrails
            $table->unsignedSmallInteger('schedule_current_time_diff_min')->default(15);
            $table->unsignedSmallInteger('schedule_days_limit')->default(1);
            $table->unsignedSmallInteger('schedule_days_limit_return')->nullable(); // outstation only
            $table->unsignedSmallInteger('schedule_rides_limit')->default(1);
            $table->unsignedSmallInteger('schedule_cancel_window_min')->default(15);

            $table->timestamps();
            $table->unique(['city_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dispatcher_settings');
    }
};

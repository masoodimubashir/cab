<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Driver acceptance window — how many seconds a pinged driver has to accept a
 * broadcast request before that ping is considered stale (a late tap is then
 * rejected). 0 disables the window (legacy behaviour: accept any time).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatcher_settings', function (Blueprint $table) {
            $table->unsignedInteger('driver_accept_window_sec')->default(30)->after('max_hops');
        });
    }

    public function down(): void
    {
        Schema::table('dispatcher_settings', function (Blueprint $table) {
            $table->dropColumn('driver_accept_window_sec');
        });
    }
};

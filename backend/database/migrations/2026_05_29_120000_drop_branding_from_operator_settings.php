<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // `subdomain` carries a unique index — drop it before the column.
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->dropUnique(['subdomain']);
        });

        Schema::table('operator_settings', function (Blueprint $table) {
            $table->dropColumn([
                'subdomain',
                'operator_name',
                'support_email',
                'logo_path',
                'fav_icon_path',
                'main_color',
                'secondary_color',
            ]);
        });
    }

    public function down(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->string('subdomain')->nullable()->unique();
            $table->string('operator_name')->nullable();
            $table->string('support_email')->nullable();
            $table->string('logo_path')->nullable();
            $table->string('fav_icon_path')->nullable();
            $table->string('main_color', 16)->default('#1c1c1c');
            $table->string('secondary_color', 16)->default('#02b3e4');
        });
    }
};

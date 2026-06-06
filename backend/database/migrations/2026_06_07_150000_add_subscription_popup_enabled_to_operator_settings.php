<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * On/off flag for the driver subscription prompt. When true, the driver app
 * shows the configured popup (title / description / buttons) the moment a driver
 * opens the Subscriptions screen; when false it stays hidden. Off by default so
 * existing installs don't suddenly start prompting.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            if (! Schema::hasColumn('operator_settings', 'subscription_popup_enabled')) {
                $table->boolean('subscription_popup_enabled')
                    ->default(false)
                    ->after('subscription_popup_button2');
            }
        });
    }

    public function down(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            if (Schema::hasColumn('operator_settings', 'subscription_popup_enabled')) {
                $table->dropColumn('subscription_popup_enabled');
            }
        });
    }
};

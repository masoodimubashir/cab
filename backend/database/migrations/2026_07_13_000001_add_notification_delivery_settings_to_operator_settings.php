<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table("operator_settings", function (Blueprint $table) {
            if (!Schema::hasColumn("operator_settings", "notifications_sms_enabled")) {
                $table->boolean("notifications_sms_enabled")->default(false)->after("update_driver_payment_modes_enabled");
            }
            if (!Schema::hasColumn("operator_settings", "notifications_email_enabled")) {
                $table->boolean("notifications_email_enabled")->default(false)->after("notifications_sms_enabled");
            }
            if (!Schema::hasColumn("operator_settings", "fixed_customer_sms_enabled")) {
                $table->boolean("fixed_customer_sms_enabled")->default(false)->after("notifications_email_enabled");
            }
            if (!Schema::hasColumn("operator_settings", "fixed_customer_email_enabled")) {
                $table->boolean("fixed_customer_email_enabled")->default(false)->after("fixed_customer_sms_enabled");
            }
            if (!Schema::hasColumn("operator_settings", "fixed_driver_sms_enabled")) {
                $table->boolean("fixed_driver_sms_enabled")->default(false)->after("fixed_customer_email_enabled");
            }
            if (!Schema::hasColumn("operator_settings", "fixed_driver_email_enabled")) {
                $table->boolean("fixed_driver_email_enabled")->default(false)->after("fixed_driver_sms_enabled");
            }
            if (!Schema::hasColumn("operator_settings", "fixed_admin_sms_enabled")) {
                $table->boolean("fixed_admin_sms_enabled")->default(false)->after("fixed_driver_email_enabled");
            }
            if (!Schema::hasColumn("operator_settings", "fixed_admin_email_enabled")) {
                $table->boolean("fixed_admin_email_enabled")->default(false)->after("fixed_admin_sms_enabled");
            }
        });
    }

    public function down(): void
    {
        Schema::table("operator_settings", function (Blueprint $table) {
            foreach ([
                "fixed_admin_email_enabled",
                "fixed_admin_sms_enabled",
                "fixed_driver_email_enabled",
                "fixed_driver_sms_enabled",
                "fixed_customer_email_enabled",
                "fixed_customer_sms_enabled",
                "notifications_email_enabled",
                "notifications_sms_enabled",
            ] as $column) {
                if (Schema::hasColumn("operator_settings", $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};

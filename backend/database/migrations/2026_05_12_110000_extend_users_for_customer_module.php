<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Customer profile fields surfaced in the admin "Customer Details" page.
            $table->date('dob')->nullable()->after('avatar_path');
            $table->string('city', 120)->nullable()->after('dob');

            // Device / app metadata captured on login. Strings (free-form) so we
            // never have to migrate when a new OS version ships.
            $table->string('app_version', 32)->nullable()->after('city');
            $table->string('os_version', 32)->nullable()->after('app_version');
            $table->string('device_type', 64)->nullable()->after('os_version');

            // Referral graph: code each customer can share + back-pointer to the
            // customer who referred them (null for organic signups).
            $table->string('referral_code', 16)->nullable()->unique()->after('device_type');
            $table->foreignId('referred_by_user_id')->nullable()->after('referral_code')
                ->constrained('users')->nullOnDelete();

            // Notification opt-outs. Default false (everyone in) — admin toggles
            // them via the "Unsubscribe User" dialog.
            $table->boolean('email_unsubscribed')->default(false)->after('referred_by_user_id');
            $table->boolean('sms_unsubscribed')->default(false)->after('email_unsubscribed');
            $table->boolean('push_unsubscribed')->default(false)->after('sms_unsubscribed');

            // Heuristic flag: another account with the same phone or email already
            // exists. Surfaced on the admin profile card.
            $table->boolean('duplicate_registration')->default(false)->after('push_unsubscribed');

            // Audit columns for the existing is_suspended flag — we reuse the
            // flag for "Block User" so customer support can see why and when.
            $table->string('suspended_reason')->nullable()->after('is_suspended');
            $table->timestamp('suspended_at')->nullable()->after('suspended_reason');

            // Soft delete so "Delete User" is reversible by support.
            $table->softDeletes()->after('suspended_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropSoftDeletes();
            $table->dropColumn(['suspended_reason', 'suspended_at']);
            $table->dropColumn('duplicate_registration');
            $table->dropColumn(['email_unsubscribed', 'sms_unsubscribed', 'push_unsubscribed']);
            $table->dropConstrainedForeignId('referred_by_user_id');
            $table->dropColumn('referral_code');
            $table->dropColumn(['app_version', 'os_version', 'device_type']);
            $table->dropColumn(['dob', 'city']);
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->timestamp('deactivated_at')->nullable()->after('rejected_at');
            $table->string('deactivated_reason')->nullable()->after('deactivated_at');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn(['deactivated_at', 'deactivated_reason']);
        });
    }
};

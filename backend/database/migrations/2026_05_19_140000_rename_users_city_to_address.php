<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Customer + driver mobile apps moved from a city dropdown (varchar 80) to
     * a Google Places autocomplete that returns a full formatted address. The
     * column it writes to is renamed `city` → `address` and the width is
     * bumped to 255 to hold a typical Place result.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->renameColumn('city', 'address');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('address', 255)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('address', 80)->nullable()->change();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->renameColumn('address', 'city');
        });
    }
};

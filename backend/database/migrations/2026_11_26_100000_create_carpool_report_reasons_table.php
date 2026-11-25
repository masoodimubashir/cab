<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * S9 (decision D-08): the reasons a rider or driver can give when reporting are an admin-editable list.
 * Reasons are turned off, never deleted, because old reports keep pointing at their key. Starts with
 * the five that were fixed in the apps before: spam, harassment, unsafe, photo, other.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('carpool_report_reasons', function (Blueprint $table) {
            $table->id();
            $table->string('key', 40)->unique();
            $table->string('label', 80);
            $table->string('applies_to', 10)->default('both'); // person, message or both
            $table->boolean('active')->default(true);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
        });

        $now = now();
        $rows = [
            ['spam', 'Spam or selling', 'message'],
            ['harassment', 'Harassment or abuse', 'both'],
            ['unsafe', 'Unsafe or aggressive behaviour', 'both'],
            ['photo', "Doesn't match the profile photo", 'person'],
            ['other', 'Something else', 'both'],
        ];
        foreach ($rows as $i => [$key, $label, $applies]) {
            DB::table('carpool_report_reasons')->insert([
                'key' => $key, 'label' => $label, 'applies_to' => $applies, 'active' => true, 'sort' => $i + 1, 'created_at' => $now, 'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('carpool_report_reasons');
    }
};

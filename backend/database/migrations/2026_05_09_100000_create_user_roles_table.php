<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_roles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->enum('role', ['customer', 'driver', 'admin']);
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['user_id', 'role']);
            $table->index('role');
        });

        if (Schema::hasColumn('users', 'role')) {
            DB::table('users')
                ->whereNotNull('role')
                ->orderBy('id')
                ->select(['id', 'role'])
                ->chunk(500, function ($rows) {
                    $now = now();
                    $insert = [];
                    foreach ($rows as $row) {
                        $insert[] = [
                            'user_id' => $row->id,
                            'role' => $row->role,
                            'created_at' => $now,
                        ];
                    }
                    if ($insert) {
                        DB::table('user_roles')->insertOrIgnore($insert);
                    }
                });

            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('role');
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasColumn('users', 'role')) {
            Schema::table('users', function (Blueprint $table) {
                $table->enum('role', ['customer', 'driver', 'admin'])->default('customer');
            });

            DB::table('user_roles')
                ->orderBy('id')
                ->chunk(500, function ($rows) {
                    foreach ($rows as $row) {
                        DB::table('users')
                            ->where('id', $row->user_id)
                            ->update(['role' => $row->role]);
                    }
                });
        }

        Schema::dropIfExists('user_roles');
    }
};

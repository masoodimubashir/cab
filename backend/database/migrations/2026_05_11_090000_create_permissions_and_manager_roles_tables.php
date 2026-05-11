<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // The catalogue of permission slugs. Seeded once and rarely edited;
        // the UI uses the `group` field to draw a neat checkbox grid in the
        // Role editor (e.g. all "Drivers.*" permissions appear under "Drivers").
        Schema::create('permissions', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 80)->unique();
            $table->string('name', 160);
            $table->string('group', 80)->nullable();
            $table->string('description', 500)->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });

        // Manager roles — bundles of permissions. `is_system` rows (e.g. Super
        // Admin) can't be edited or deleted via the UI. `requires_fleet` tells
        // the Manager modal to show the Franchise dropdown for franchise roles.
        Schema::create('manager_roles', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 80)->unique();
            $table->string('name', 160);
            $table->string('description', 500)->nullable();
            $table->boolean('is_system')->default(false);
            $table->boolean('is_suspendable')->default(true);
            $table->boolean('requires_fleet')->default(false);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });

        // Many-to-many between roles and permissions.
        Schema::create('manager_role_permissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('manager_role_id')->constrained('manager_roles')->cascadeOnDelete();
            $table->foreignId('permission_id')->constrained('permissions')->cascadeOnDelete();
            $table->unique(['manager_role_id', 'permission_id'], 'manager_role_perm_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('manager_role_permissions');
        Schema::dropIfExists('manager_roles');
        Schema::dropIfExists('permissions');
    }
};

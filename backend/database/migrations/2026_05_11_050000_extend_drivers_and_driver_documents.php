<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Defensive migration — the database may already have some/all of these
 * columns from earlier iterations during development. Each column is added
 * only when missing so re-running this migration on a partially-evolved
 * schema is safe.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            if (!Schema::hasColumn('drivers', 'ride_type_id')) {
                $table->foreignId('ride_type_id')
                    ->nullable()
                    ->after('user_id')
                    ->constrained('ride_types')
                    ->nullOnDelete();
            }
            if (!Schema::hasColumn('drivers', 'vehicle_type_id')) {
                $table->foreignId('vehicle_type_id')
                    ->nullable()
                    ->after('ride_type_id')
                    ->constrained('vehicle_types')
                    ->nullOnDelete();
            }
        });

        Schema::table('driver_documents', function (Blueprint $table) {
            if (!Schema::hasColumn('driver_documents', 'document_id')) {
                $table->foreignId('document_id')
                    ->nullable()
                    ->after('driver_id')
                    ->constrained('documents')
                    ->nullOnDelete();
            }
            if (!Schema::hasColumn('driver_documents', 'vehicle_type_id')) {
                $table->foreignId('vehicle_type_id')
                    ->nullable()
                    ->after('document_id')
                    ->constrained('vehicle_types')
                    ->nullOnDelete();
            }
            if (!Schema::hasColumn('driver_documents', 'label_values')) {
                $table->json('label_values')->nullable()->after('file_path');
            }
        });

        // Make document_type nullable (best-effort — driver flow now uses document_id).
        Schema::table('driver_documents', function (Blueprint $table) {
            $table->enum('document_type', ['DL', 'RC', 'INSURANCE', 'ID'])->nullable()->change();
        });

        // Drop the legacy (driver_id, document_type) unique if it still exists,
        // and add the new (driver_id, document_id, vehicle_type_id) unique if it
        // doesn't already. Both checks are tolerant of a partially-migrated DB.
        $indexes = collect(DB::select('SHOW INDEX FROM driver_documents'))
            ->pluck('Key_name')
            ->unique()
            ->all();

        if (in_array('driver_documents_driver_id_document_type_unique', $indexes, true)) {
            // MySQL refuses to drop this index while the driver_id FK relies
            // on it as the leftmost covering index. Add a dedicated index on
            // driver_id first so the FK has somewhere else to lean on, then
            // drop the legacy unique.
            if (!in_array('driver_documents_driver_id_index', $indexes, true)) {
                Schema::table('driver_documents', function (Blueprint $table) {
                    $table->index('driver_id');
                });
            }
            Schema::table('driver_documents', function (Blueprint $table) {
                $table->dropUnique(['driver_id', 'document_type']);
            });
        }

        if (!in_array('driver_documents_driver_doc_vehicle_unique', $indexes, true)) {
            Schema::table('driver_documents', function (Blueprint $table) {
                $table->unique(
                    ['driver_id', 'document_id', 'vehicle_type_id'],
                    'driver_documents_driver_doc_vehicle_unique',
                );
            });
        }
    }

    public function down(): void
    {
        Schema::table('driver_documents', function (Blueprint $table) {
            $table->dropUnique('driver_documents_driver_doc_vehicle_unique');
        });
        // Don't drop the columns or the legacy unique on the way down — too
        // destructive given the schema may have evolved beyond what this
        // migration originally added.
    }
};

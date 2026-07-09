<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('driver_documents', function (Blueprint $table) {
            if (!Schema::hasColumn('driver_documents', 'image_index')) {
                $table->unsignedInteger('image_index')->default(1)->after('vehicle_type_id');
            }
        });

        $indexes = collect(DB::select('SHOW INDEX FROM driver_documents'))
            ->pluck('Key_name')
            ->unique()
            ->all();

        if (in_array('driver_documents_driver_doc_vehicle_unique', $indexes, true)) {
            Schema::table('driver_documents', function (Blueprint $table) {
                $table->dropUnique('driver_documents_driver_doc_vehicle_unique');
            });
        }

        if (!in_array('driver_documents_driver_doc_image_unique', $indexes, true)) {
            Schema::table('driver_documents', function (Blueprint $table) {
                $table->unique(
                    ['driver_id', 'document_id', 'vehicle_type_id', 'image_index'],
                    'driver_documents_driver_doc_image_unique',
                );
            });
        }
    }

    public function down(): void
    {
        $indexes = collect(DB::select('SHOW INDEX FROM driver_documents'))
            ->pluck('Key_name')
            ->unique()
            ->all();

        if (in_array('driver_documents_driver_doc_image_unique', $indexes, true)) {
            Schema::table('driver_documents', function (Blueprint $table) {
                $table->dropUnique('driver_documents_driver_doc_image_unique');
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
};

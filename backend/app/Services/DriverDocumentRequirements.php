<?php

namespace App\Services;

use App\Models\Document;
use App\Models\Driver;
use App\Models\DriverDocument;

class DriverDocumentRequirements
{
    public function forDriver(Driver $driver): array
    {
        $uploads = DriverDocument::query()->where('driver_id', $driver->id)
            ->where(fn ($q) => $q->whereNull('vehicle_type_id')->orWhere('vehicle_type_id', $driver->vehicle_type_id))
            ->orderByDesc('id')->get();

        $requirements = Document::query()->forDrivers()
            ->whereIn('required', ['mandatory_register', 'mandatory_drive'])
            ->orderBy('id')->get()->map(function (Document $doc) use ($uploads) {
                $rows = $uploads->where('document_id', $doc->id);
                $count = max(1, (int) $doc->no_of_images);
                $slots = [];
                $legacy = $rows->whereNull('image_index')->values();
                for ($i = 1; $i <= $count; $i++) {
                    $row = $rows->firstWhere('image_index', $i) ?? $legacy->shift();
                    $slots[] = [
                        'index' => $i,
                        'status' => $row?->status ?? 'missing',
                        'rejection_reason' => $row?->rejection_reason,
                    ];
                }
                $statuses = array_column($slots, 'status');
                $status = in_array('rejected', $statuses, true) ? 'rejected'
                    : (in_array('missing', $statuses, true) ? 'missing'
                    : (in_array('uploaded', $statuses, true) ? 'pending' : 'approved'));
                return [
                    'document_id' => $doc->id,
                    'name' => $doc->name,
                    'required' => $doc->required,
                    'required_images' => $count,
                    'approved_images' => count(array_filter($statuses, fn ($s) => $s === 'approved')),
                    'status' => $status,
                    'slots' => $slots,
                ];
            })->all();

        // Preserve existing legacy blockers until the operator reviews them.
        foreach ($uploads->whereNull('document_id')->whereNotNull('document_type')->where('status', '!=', 'approved') as $row) {
            $requirements[] = [
                'document_id' => null, 'name' => $row->document_type,
                'required' => 'mandatory_register', 'required_images' => 1, 'approved_images' => 0,
                'status' => $row->status === 'rejected' ? 'rejected' : 'pending',
                'slots' => [['index' => 1, 'status' => $row->status, 'rejection_reason' => $row->rejection_reason]],
            ];
        }
        return $requirements;
    }
}

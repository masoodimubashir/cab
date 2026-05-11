<?php

namespace App\Http\Controllers;

use App\Models\Document;
use App\Models\DocumentLabel;
use App\Models\RideType;
use App\Models\VehicleType;
use Illuminate\Http\Request;

/**
 * Read-only catalog endpoints used by the driver mobile app during
 * registration. Auth-required (so anonymous probes don't enumerate the
 * catalog), but no admin role — any signed-in user can call these.
 */
class CatalogController extends Controller
{
    public function rideTypes(Request $request)
    {
        $rows = RideType::query()
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name', 'description', 'sort_order']);

        return response()->json(['data' => $rows]);
    }

    public function vehicleTypes(Request $request)
    {
        $rows = VehicleType::query()
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (VehicleType $v) => [
                'id' => $v->id,
                'name' => $v->name,
                'description' => $v->description,
                'image_url' => $v->image_url,
            ]);

        return response()->json(['data' => $rows]);
    }

    public function documents(Request $request)
    {
        // Default to the driver-document slice — the driver app shouldn't see
        // car-rental-only catalog rows. Caller can override with ?category=…
        $category = $request->query('category', 'driver_document');

        $rows = Document::query()
            ->with('labels')
            ->when($category, fn ($q) => $q->where('category', $category))
            ->orderBy('id')
            ->get()
            ->map(fn (Document $d) => [
                'id' => $d->id,
                'name' => $d->name,
                'no_of_images' => (int) $d->no_of_images,
                'category' => $d->category,
                'required' => $d->required,
                'document_type' => $d->document_type,
                'gallery_restricted' => (bool) $d->gallery_restricted,
                'instructions' => $d->instructions,
                'status' => $d->status,
                'labels' => $d->labels->map(fn (DocumentLabel $l) => [
                    'id' => $l->id,
                    'label' => $l->label,
                    'label_type' => $l->label_type,
                    'mandatory' => (bool) $l->mandatory,
                    'sort_order' => (int) $l->sort_order,
                ])->all(),
            ]);

        return response()->json(['data' => $rows]);
    }
}

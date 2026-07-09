<?php

namespace App\Http\Controllers\Admin;

use App\Models\Document;
use App\Models\DocumentLabel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Manages the global document catalog — the operator-defined list of documents
 * a driver may have to upload (license, RC, insurance, etc.). Each entry can
 * carry typed labels (e.g. "Expiry Date", date, mandatory). The actual
 * per-driver uploads still live in driver_documents and are unchanged for now.
 */
class AdminDocumentsController
{
    public function index(Request $request)
    {
        $q = Document::query()->with('labels');

        if ($category = $request->query('category')) {
            $q->where('category', $category);
        }
        if ($status = $request->query('status')) {
            $q->where('status', $status);
        }
        if ($search = trim((string) $request->query('search'))) {
            $q->where('name', 'like', "%{$search}%");
        }

        $perPage = (int) min(100, max(10, (int) $request->query('per_page', 50)));
        $page = $q->orderBy('id')->paginate($perPage);

        return response()->json([
            'data' => $page->getCollection()->map(fn (Document $d) => $this->shape($d)),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        ]);
    }

    public function show(Document $document)
    {
        $document->load('labels');
        return response()->json(['document' => $this->shape($document)]);
    }

    public function store(Request $request)
    {
        $data = $this->validatePayload($request, partial: false);
        $data['category'] = 'driver_document';
        $data['document_type'] = 'normal';
        $labels = $data['labels'] ?? [];
        unset($data['labels']);

        $document = DB::transaction(function () use ($data, $labels) {
            $doc = Document::query()->create($data);
            $this->syncLabels($doc, $labels);
            return $doc;
        });

        return response()->json([
            'document' => $this->shape($document->fresh('labels')),
            'message' => 'Document created.',
        ], 201);
    }

    public function update(Request $request, Document $document)
    {
        $data = $this->validatePayload($request, partial: true);
        $data['category'] = 'driver_document';
        $data['document_type'] = 'normal';
        $labels = $data['labels'] ?? null;
        unset($data['labels']);

        DB::transaction(function () use ($document, $data, $labels) {
            $document->fill($data);
            $document->save();
            if ($labels !== null) {
                $this->syncLabels($document, $labels);
            }
        });

        return response()->json([
            'document' => $this->shape($document->fresh('labels')),
            'message' => 'Document updated.',
        ]);
    }

    /**
     * Set the document's status field — fired by the "Add" modal in the list.
     * Per the spec the status is global for now; per-vehicle/per-city assignment
     * is planned for a later phase and will move to its own table.
     */
    public function assign(Request $request, Document $document)
    {
        $data = $request->validate([
            'status' => ['required', 'string', 'max:40'],
        ]);

        $document->status = $data['status'];
        $document->save();

        return response()->json([
            'document' => $this->shape($document->fresh('labels')),
            'message' => 'Document status updated.',
        ]);
    }

    public function destroy(Document $document)
    {
        $document->delete();
        return response()->json(['message' => 'Document deleted.']);
    }

    private function validatePayload(Request $request, bool $partial): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';

        $rules = [
            'name' => [$sometimes, 'string', 'max:160'],
            'no_of_images' => ['nullable', 'integer', 'min:1', 'max:20'],
            'category' => ['nullable', 'string', 'max:60'],
            'required' => ['nullable', 'string', 'max:40'],
            'document_type' => ['nullable', 'string', 'max:40'],
            'gallery_restricted' => ['nullable', 'boolean'],
            'instructions' => ['nullable', 'string', 'max:2000'],
            'status' => ['nullable', 'string', 'max:40'],

            'labels' => ['nullable', 'array'],
            'labels.*.label' => ['required_with:labels', 'string', 'max:120'],
            'labels.*.label_type' => ['required_with:labels', Rule::in(DocumentLabel::LABEL_TYPES)],
            'labels.*.mandatory' => ['nullable', 'boolean'],
            'labels.*.sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
        ];

        return $request->validate($rules);
    }

    /**
     * Replace the document's labels with the given set in one shot. Doing a
     * delete-then-recreate is fine here: labels are tiny rows and re-ordering
     * them via the UI is the common case, which makes diffing fragile.
     */
    private function syncLabels(Document $document, array $labels): void
    {
        $document->labels()->delete();
        $order = 0;
        foreach ($labels as $row) {
            $document->labels()->create([
                'label' => $row['label'],
                'label_type' => $row['label_type'],
                'mandatory' => (bool) ($row['mandatory'] ?? false),
                'sort_order' => isset($row['sort_order']) ? (int) $row['sort_order'] : $order,
            ]);
            $order++;
        }
    }

    private function shape(Document $d): array
    {
        return [
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
            'created_at' => optional($d->created_at)->toIso8601String(),
            'updated_at' => optional($d->updated_at)->toIso8601String(),
        ];
    }
}

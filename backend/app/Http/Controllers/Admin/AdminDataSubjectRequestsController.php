<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\DataSubjectRequest;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Records and actions Data Subject Access Requests (DSAR / data rights) raised
 * from the operator settings panel. Previously the panel only showed a toast and
 * dropped the request on the floor — these endpoints actually persist it.
 */
class AdminDataSubjectRequestsController extends Controller
{
    /** Newest-first list for the admin queue. */
    public function index(Request $request)
    {
        $rows = DataSubjectRequest::query()
            ->with(['requestedBy:id,name', 'handledBy:id,name'])
            ->latest()
            ->paginate(50);

        return response()->json($rows);
    }

    /** File a new request. */
    public function store(Request $request)
    {
        $data = $request->validate([
            'right' => ['required', Rule::in(DataSubjectRequest::RIGHTS)],
            'reason' => ['nullable', 'string', 'max:2000'],
        ]);

        $dsr = DataSubjectRequest::query()->create([
            'right' => $data['right'],
            'reason' => $data['reason'] ?? null,
            'status' => 'pending',
            'requested_by_user_id' => $request->user()?->id,
        ]);

        return response()->json(['request' => $dsr], 201);
    }

    /** Action a request — move it through the queue. */
    public function update(Request $request, DataSubjectRequest $dataSubjectRequest)
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(DataSubjectRequest::STATUSES)],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $dataSubjectRequest->status = $data['status'];
        if (array_key_exists('notes', $data)) {
            $dataSubjectRequest->notes = $data['notes'];
        }
        if (in_array($data['status'], ['completed', 'rejected'], true)) {
            $dataSubjectRequest->handled_by_user_id = $request->user()?->id;
            $dataSubjectRequest->handled_at = now();
        }
        $dataSubjectRequest->save();

        return response()->json(['request' => $dataSubjectRequest]);
    }
}

<?php

namespace App\Http\Controllers;

use App\Models\Invoice;
use App\Models\Trip;
use App\Services\InvoiceGeneratorService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class InvoicesController extends Controller
{
    public function show(Request $request, Trip $trip)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $invoice = Invoice::query()->where('trip_id', $trip->id)->first();
        return response()->json(['invoice' => $invoice]);
    }

    public function generate(Request $request, Trip $trip, InvoiceGeneratorService $invoiceGeneratorService)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        try {
            $invoice = $invoiceGeneratorService->generateForTrip($trip);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['invoice' => $invoice]);
    }

    public function download(Request $request, Trip $trip)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $invoice = Invoice::query()->where('trip_id', $trip->id)->first();
        if (!$invoice || !$invoice->pdf_path) {
            return response()->json(['message' => 'Invoice not available.'], 404);
        }

        // If it's a live Razorpay hosted invoice link, redirect straight to it
        if (filter_var($invoice->pdf_path, FILTER_VALIDATE_URL) || str_starts_with($invoice->pdf_path, 'http')) {
            return redirect()->away($invoice->pdf_path);
        }

        if (!Storage::disk('local')->exists($invoice->pdf_path)) {
            return response()->json(['message' => 'Invoice PDF missing from storage.'], 404);
        }

        $filename = basename($invoice->pdf_path);
        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('local');
        return $disk->download($invoice->pdf_path, $filename);
    }
}


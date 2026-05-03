<?php

namespace App\Services;

use App\Models\Invoice;
use App\Models\Trip;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Support\Facades\Storage;

class InvoiceGeneratorService
{
    public function generateForTrip(Trip $trip): Invoice
    {
        $payment = $trip->payment()->first();
        if (!$payment || $payment->status !== 'SUCCESS') {
            throw new \RuntimeException('Cannot generate invoice without a successful payment.');
        }

        $existing = Invoice::query()->where('trip_id', $trip->id)->first();
        if ($existing) {
            return $existing;
        }

        $invoiceNo = 'INV-' . $trip->id . '-' . now()->format('YmdHis');

        $htmlViewData = [
            'trip' => $trip->load(['customer', 'driver', 'rideType']),
            'payment' => $payment,
            'invoiceNo' => $invoiceNo,
        ];

        // Render PDF (server-side).
        $pdf = Pdf::loadView('invoices.invoice', $htmlViewData)->setPaper('a4')->output();

        $path = 'invoices/' . $invoiceNo . '.pdf';
        // Store on a non-public disk; access is controlled via the authenticated
        // InvoicesController download endpoint.
        Storage::disk('local')->put($path, $pdf);

        return Invoice::query()->create([
            'trip_id' => $trip->id,
            'invoice_no' => $invoiceNo,
            'pdf_path' => $path,
            'meta' => [
                'generated_by' => 'DreamCabs',
            ],
            'total_amount' => (float) $payment->amount,
            'currency' => $payment->currency,
            'issued_at' => now(),
        ]);
    }
}


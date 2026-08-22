<?php

namespace App\Services;

use App\Models\Invoice;
use App\Models\Trip;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Support\Facades\Log;
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

        $trip->loadMissing(['customer', 'driver', 'rideType']);
        $customer = $trip->customer;

        $invoiceNo = 'INV-' . $trip->id . '-' . now()->format('YmdHis');
        $pdfPath = null;
        $meta = ['generated_by' => 'Local'];

        // 1. If customer has an email, delegate invoice generation & email dispatch to Razorpay
        if ($customer && !empty($customer->email) && !str_ends_with((string) $customer->email, '@otp.local')) {
            try {
                $rzpService = app(RazorpayService::class);
                $rzpInvoice = $rzpService->createInvoiceForTrip($trip, $payment);

                if ($rzpInvoice && !empty($rzpInvoice['short_url'])) {
                    $invoiceNo = $rzpInvoice['invoice_number'] ?? $invoiceNo;
                    $pdfPath = $rzpInvoice['short_url'];
                    $meta = [
                        'generated_by' => 'Razorpay',
                        'razorpay_invoice_id' => $rzpInvoice['id'] ?? null,
                        'emailed_to' => $customer->email,
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning('Razorpay auto-invoice creation failed, falling back to local: ' . $e->getMessage(), [
                    'trip_id' => $trip->id,
                ]);
            }
        }

        // 2. Fallback: generate local PDF if Razorpay invoice wasn't created (e.g. offline/cash/no customer email)
        if (!$pdfPath) {
            try {
                $htmlViewData = [
                    'trip' => $trip,
                    'payment' => $payment,
                    'invoiceNo' => $invoiceNo,
                ];

                $pdf = Pdf::loadView('invoices.invoice', $htmlViewData)->setPaper('a4')->output();
                $path = 'invoices/' . $invoiceNo . '.pdf';
                Storage::disk('local')->put($path, $pdf);
                $pdfPath = $path;
            } catch (\Throwable $e) {
                Log::error('Local PDF invoice generation failed: ' . $e->getMessage(), [
                    'trip_id' => $trip->id,
                ]);
            }
        }

        return Invoice::query()->create([
            'trip_id' => $trip->id,
            'invoice_no' => $invoiceNo,
            'pdf_path' => $pdfPath,
            'meta' => $meta,
            'total_amount' => (float) $payment->amount,
            'currency' => $payment->currency ?: 'INR',
            'issued_at' => now(),
        ]);
    }
}



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

        $trip->loadMissing(['customer', 'driver', 'rideType', 'cityVehicleType']);
        $customer = $trip->customer;

        $imageService = app(VehicleFamilyImageService::class);
        $vtName = $trip->vehicle_name ?: ($trip->cityVehicleType?->display_name ?: $trip->rideType?->name);
        $vehicleImagePayload = $imageService->resolveForVehicle($trip->city_id, $vtName, 'android');
        $vehicleImageUrl = $vehicleImagePayload['image_url'] ?? null;

        $invoiceNo = 'INV-' . $trip->id . '-' . now()->format('YmdHis');
        $pdfPath = null;
        $meta = ['generated_by' => 'Local'];

        // Cash rides always receive a local invoice, including customers with a registered email.
        if (strtoupper((string) $payment->method) !== 'CASH'
            && $customer && !empty($customer->email) && !str_ends_with((string) $customer->email, '@otp.local')) {
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
                // For local PDF generation with DomPDF, convert the local disk asset to a base64 Data URI
                // so it renders without requiring remote HTTP network calls (which DomPDF blocks by default).
                $pdfVehicleImage = null;
                if ($vehicleImageUrl) {
                    $publicPrefix = '/storage/';
                    $parsedPath = parse_url($vehicleImageUrl, PHP_URL_PATH);
                    if ($parsedPath && str_contains($parsedPath, $publicPrefix)) {
                        $relativeStoragePath = substr($parsedPath, strpos($parsedPath, $publicPrefix) + strlen($publicPrefix));
                        if (Storage::disk('public')->exists($relativeStoragePath)) {
                            $fullPath = Storage::disk('public')->path($relativeStoragePath);
                            $mime = mime_content_type($fullPath) ?: 'image/png';
                            $data = base64_encode(file_get_contents($fullPath));
                            $pdfVehicleImage = "data:{$mime};base64,{$data}";
                        }
                    }
                    if (!$pdfVehicleImage && filter_var($vehicleImageUrl, FILTER_VALIDATE_URL)) {
                        try {
                            $contents = @file_get_contents($vehicleImageUrl);
                            if ($contents) {
                                $finfo = new \finfo(FILEINFO_MIME_TYPE);
                                $mime = $finfo->buffer($contents) ?: 'image/png';
                                $pdfVehicleImage = "data:{$mime};base64," . base64_encode($contents);
                            }
                        } catch (\Throwable) {
                            // Leave as fallback
                        }
                    }
                }

                $htmlViewData = [
                    'trip' => $trip,
                    'payment' => $payment,
                    'invoiceNo' => $invoiceNo,
                    'vehicleImageUrl' => $pdfVehicleImage ?: $vehicleImageUrl,
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


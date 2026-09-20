<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Razorpay\Api\Api;

class RazorpayService
{
    private Api $api;
    private string $webhookSecret;
    private string $keyId;
    private string $keySecret;

    /** Base URL for Razorpay's v2 Route onboarding (linked accounts) API. */
    private const V2_BASE = 'https://api.razorpay.com/v2';

    public function __construct()
    {
        $keyId = config('services.razorpay.key_id');
        $keySecret = config('services.razorpay.key_secret');
        $this->webhookSecret = (string) config('services.razorpay.webhook_secret', '');

        if (!$keyId || !$keySecret) {
            throw new \RuntimeException('Missing Razorpay credentials in env.');
        }

        $this->keyId = (string) $keyId;
        $this->keySecret = (string) $keySecret;
        $this->api = new Api($keyId, $keySecret);
    }

    /**
     * Creates a Razorpay order for UPI payments.
     *
     * @return array{order_id:string,amount:int,currency:string}
     */
    public function createOrder(int $amountPaise, string $receipt): array
    {
        $currency = (string) config('services.razorpay.currency', 'INR');

        $order = $this->api->order->create([
            'amount' => $amountPaise,
            'currency' => $currency,
            'receipt' => $receipt,
            'payment_capture' => 1,
        ]);

        return [
            'order_id' => $order->id,
            'amount' => (int) $order->amount,
            'currency' => $order->currency,
        ];
    }

    /**
     * Verifies a payment signature returned by Razorpay Checkout on the client.
     * Returns true if the signature matches the order_id + payment_id pair.
     */
    public function verifyPaymentSignature(string $orderId, string $paymentId, string $signature): bool
    {
        try {
            $this->api->utility->verifyPaymentSignature([
                'razorpay_order_id' => $orderId,
                'razorpay_payment_id' => $paymentId,
                'razorpay_signature' => $signature,
            ]);
            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Creates a refund against a captured Razorpay payment.
     *
     * @return array{id:string,status:string,amount:int}
     */
    public function refundPayment(string $paymentId, int $amountPaise, array $notes = []): array
    {
        $payload = ['amount' => $amountPaise];
        if ($notes !== []) {
            $payload['notes'] = $notes;
        }

        $refund = $this->api->payment->fetch($paymentId)->refund($payload);

        return [
            'id' => (string) $refund->id,
            'status' => (string) ($refund->status ?? 'pending'),
            'amount' => (int) ($refund->amount ?? $amountPaise),
        ];
    }

    /**
     * Fetches an order from Razorpay. Used by the pending-payment sweeper to
     * ask "what actually happened to this order?" when no webhook arrived.
     *
     * @return array{id:string,status:string,amount:int,amount_paid:int}|null
     */
    public function fetchOrder(string $orderId): ?array
    {
        try {
            $order = $this->api->order->fetch($orderId);

            return [
                'id' => (string) $order->id,
                // created | attempted | paid
                'status' => (string) $order->status,
                'amount' => (int) $order->amount,
                'amount_paid' => (int) ($order->amount_paid ?? 0),
            ];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Lists the payment attempts made against an order (a customer can fail a
     * few times and then succeed on the same order).
     *
     * @return array<int, array{id:string,status:string,amount:int}>
     */
    public function fetchOrderPayments(string $orderId): array
    {
        try {
            $payments = $this->api->order->fetch($orderId)->payments();
            $out = [];
            foreach ($payments->items as $payment) {
                $out[] = [
                    'id' => (string) $payment->id,
                    // created | authorized | captured | refunded | failed
                    'status' => (string) $payment->status,
                    'amount' => (int) $payment->amount,
                ];
            }

            return $out;
        } catch (\Throwable) {
            return [];
        }
    }

    /**
     * Fetches a refund's current state (pending | processed | failed).
     *
     * @return array{id:string,payment_id:string,status:string,amount:int}|null
     */
    public function fetchRefund(string $refundId): ?array
    {
        try {
            $refund = $this->api->refund->fetch($refundId);

            return [
                'id' => (string) $refund->id,
                'payment_id' => (string) ($refund->payment_id ?? ''),
                'status' => (string) ($refund->status ?? 'pending'),
                'amount' => (int) ($refund->amount ?? 0),
            ];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Fetches a payment entity from Razorpay.
     *
     * @return array{id:string,status:string,amount:int,amount_refunded:int,refund_status:?string}|null
     */
    public function fetchPayment(string $paymentId): ?array
    {
        $paymentId = trim($paymentId);
        if ($paymentId === '') {
            return null;
        }

        try {
            $payment = $this->api->payment->fetch($paymentId);

            return [
                'id' => (string) $payment->id,
                'status' => (string) $payment->status,
                'amount' => (int) $payment->amount,
                'amount_refunded' => (int) ($payment->amount_refunded ?? 0),
                'refund_status' => isset($payment->refund_status) ? (string) $payment->refund_status : null,
            ];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Fetches all refunds created against a payment from Razorpay.
     *
     * @return array<int, array{id:string,payment_id:string,amount:int,status:string,created_at:int}>
     */
    public function fetchPaymentRefunds(string $paymentId): array
    {
        $paymentId = trim($paymentId);
        if ($paymentId === '') {
            return [];
        }

        try {
            $refunds = $this->api->payment->fetch($paymentId)->refunds();
            $out = [];
            $items = $refunds->items ?? ($refunds instanceof \Traversable ? iterator_to_array($refunds) : []);
            foreach ($items as $refund) {
                $out[] = [
                    'id' => (string) $refund->id,
                    'payment_id' => (string) ($refund->payment_id ?? $paymentId),
                    'amount' => (int) ($refund->amount ?? 0),
                    'status' => (string) ($refund->status ?? 'pending'),
                    'created_at' => (int) ($refund->created_at ?? 0),
                ];
            }

            return $out;
        } catch (\Throwable) {
            return [];
        }
    }

    /**
     * Checks whether Razorpay already recorded a successful, partial, or pending refund for this payment.
     * Used to prevent duplicate refunds when a network connection fails during a refund call
     * or before allowing manual operator payouts.
     *
     * @return array{id:string,payment_id:string,amount:int,status:string,remaining_paise?:int}|null
     */
    public function verifyExistingRefund(string $paymentId, ?int $expectedPaise = null): ?array
    {
        $paymentId = trim($paymentId);
        if ($paymentId === '' || !str_starts_with($paymentId, 'pay_')) {
            return null;
        }

        $refunds = $this->fetchPaymentRefunds($paymentId);
        if ($refunds !== []) {
            $totalProcessedPaise = 0;
            $totalPendingPaise = 0;
            $primaryProcessedId = null;
            $primaryPendingId = null;

            foreach ($refunds as $refund) {
                $status = (string) ($refund['status'] ?? 'pending');
                $amount = (int) ($refund['amount'] ?? 0);
                if ($status === 'processed') {
                    $totalProcessedPaise += $amount;
                    if ($primaryProcessedId === null) {
                        $primaryProcessedId = (string) $refund['id'];
                    }
                } elseif ($status === 'pending') {
                    $totalPendingPaise += $amount;
                    if ($primaryPendingId === null) {
                        $primaryPendingId = (string) $refund['id'];
                    }
                }
            }

            if ($expectedPaise !== null && $expectedPaise > 0) {
                if ($totalProcessedPaise >= $expectedPaise) {
                    return [
                        'id' => $primaryProcessedId ?? (string) $refunds[0]['id'],
                        'payment_id' => $paymentId,
                        'amount' => $totalProcessedPaise,
                        'status' => 'processed',
                    ];
                }

                // If any refund amount is in-flight pending confirmation, flag as pending
                // to prevent duplicate offline payouts while the gateway processes the request.
                if ($totalPendingPaise > 0) {
                    return [
                        'id' => $primaryPendingId ?? (string) $refunds[0]['id'],
                        'payment_id' => $paymentId,
                        'amount' => $totalPendingPaise,
                        'status' => 'pending',
                        'processed_paise' => $totalProcessedPaise,
                        'pending_paise' => $totalPendingPaise,
                    ];
                }

                if ($totalProcessedPaise > 0) {
                    return [
                        'id' => $primaryProcessedId ?? (string) $refunds[0]['id'],
                        'payment_id' => $paymentId,
                        'amount' => $totalProcessedPaise,
                        'status' => 'partial',
                        'processed_paise' => $totalProcessedPaise,
                        'remaining_paise' => max(0, $expectedPaise - $totalProcessedPaise),
                    ];
                }
            } else {
                if ($totalPendingPaise > 0) {
                    return [
                        'id' => $primaryPendingId ?? (string) $refunds[0]['id'],
                        'payment_id' => $paymentId,
                        'amount' => $totalPendingPaise,
                        'status' => 'pending',
                        'processed_paise' => $totalProcessedPaise,
                        'pending_paise' => $totalPendingPaise,
                    ];
                }
                if ($totalProcessedPaise > 0) {
                    return [
                        'id' => $primaryProcessedId ?? (string) $refunds[0]['id'],
                        'payment_id' => $paymentId,
                        'amount' => $totalProcessedPaise,
                        'status' => 'processed',
                    ];
                }
            }
        }

        $payment = $this->fetchPayment($paymentId);
        if ($payment !== null) {
            $amountRefunded = (int) ($payment['amount_refunded'] ?? 0);
            if ($amountRefunded > 0) {
                if ($expectedPaise !== null && $expectedPaise > 0) {
                    if ($amountRefunded >= $expectedPaise) {
                        return [
                            'id' => 'rfnd_verified_' . $paymentId,
                            'payment_id' => $paymentId,
                            'amount' => $amountRefunded,
                            'status' => 'processed',
                        ];
                    }

                    return [
                        'id' => 'rfnd_verified_' . $paymentId,
                        'payment_id' => $paymentId,
                        'amount' => $amountRefunded,
                        'status' => 'partial',
                        'processed_paise' => $amountRefunded,
                        'remaining_paise' => max(0, $expectedPaise - $amountRefunded),
                    ];
                }

                return [
                    'id' => 'rfnd_verified_' . $paymentId,
                    'payment_id' => $paymentId,
                    'amount' => $amountRefunded,
                    'status' => 'processed',
                ];
            }

            // Payment verified cleanly with 0 refunds on Razorpay
            return null;
        }

        // When fetchPaymentRefunds is empty and fetchPayment returns null,
        // the gateway could not be reached / verification failed.
        return [
            'id' => '',
            'payment_id' => $paymentId,
            'amount' => 0,
            'status' => 'unverified',
        ];
    }

    /**
     * Verifies webhook signature. Returns boolean.
     */
    public function verifyWebhookSignature(string $body, string $signature): bool
    {
        if (!$this->webhookSecret) {
            return false;
        }

        // The SDK provides verifyWebhookSignature in many versions.
        // If not present, we fail closed.
        try {
            $utility = $this->api->utility;
            if (method_exists($utility, 'verifyWebhookSignature')) {
                return $utility->verifyWebhookSignature($body, $signature, $this->webhookSecret);
            }
        } catch (\Throwable) {
            // fall through
        }

        return false;
    }

    /* ================================================================== */
    /* Razorpay Route — linked accounts ("driver KYC") + transfers.       */
    /*                                                                    */
    /* These use the v2 onboarding REST API directly (the PHP SDK's       */
    /* coverage of v2 accounts is version-dependent), so the shapes below */
    /* mirror Razorpay's documented v2 endpoints. Every call fails soft — */
    /* callers treat a null/❌ result as "not done yet", never as a crash. */
    /* ================================================================== */

    /**
     * Creates a Route linked account for a driver (business_type=individual).
     * Returns the created account, or null on failure.
     *
     * @param array{email:string,phone:string,legal_business_name:string,contact_name:string,pan?:string} $d
     * @return array{id:string,status:string}|null
     */
    public function createLinkedAccount(array $d): ?array
    {
        $payload = [
            'email' => $d['email'],
            'phone' => $d['phone'],
            'type' => 'route',
            'legal_business_name' => $d['legal_business_name'],
            'business_type' => 'individual',
            'contact_name' => $d['contact_name'],
            'profile' => [
                'category' => 'transport',
                'subcategory' => 'cabs',
            ],
        ];
        if (!empty($d['pan'])) {
            $payload['legal_info'] = ['pan' => $d['pan']];
        }

        $res = $this->v2('post', '/accounts', $payload);
        if (!$res || empty($res['id'])) {
            return null;
        }

        return ['id' => (string) $res['id'], 'status' => (string) ($res['status'] ?? 'created')];
    }

    /**
     * Requests the "route" product configuration on a linked account — the step
     * that actually enables split settlements to it.
     *
     * @return array{id:string,activation_status:string}|null
     */
    public function requestRouteProduct(string $accountId): ?array
    {
        $res = $this->v2('post', "/accounts/{$accountId}/products", [
            'product_name' => 'route',
            'tnc_accepted' => true,
        ]);
        if (!$res || empty($res['id'])) {
            return null;
        }

        return [
            'id' => (string) $res['id'],
            'activation_status' => (string) ($res['activation_status'] ?? 'requested'),
        ];
    }

    /**
     * Sets the settlement destination (bank account) on a linked account's route
     * product. UPI-only settlement is configured the same way when supported.
     *
     * @param array{beneficiary_name:string,account_number:string,ifsc_code:string} $settlements
     * @return array{id:string,activation_status:string}|null
     */
    public function updateRouteSettlements(string $accountId, string $productId, array $settlements): ?array
    {
        $res = $this->v2('patch', "/accounts/{$accountId}/products/{$productId}", [
            'settlements' => $settlements,
            'tnc_accepted' => true,
        ]);
        if (!$res) {
            return null;
        }

        return [
            'id' => (string) ($res['id'] ?? $productId),
            'activation_status' => (string) ($res['activation_status'] ?? 'under_review'),
        ];
    }

    /**
     * Fetches a linked account's current state. Used to reconcile verification
     * when no `account.activated` webhook arrived.
     *
     * @return array{id:string,status:string}|null
     */
    public function fetchLinkedAccount(string $accountId): ?array
    {
        $res = $this->v2('get', "/accounts/{$accountId}");
        if (!$res || empty($res['id'])) {
            return null;
        }

        return ['id' => (string) $res['id'], 'status' => (string) ($res['status'] ?? 'created')];
    }

    /**
     * Creates a Route transfer that moves the driver's share of a captured
     * payment to their linked account. The commission portion is simply not
     * transferred, so it stays with the operator. Fails soft (null) so a transfer
     * outage never rolls back a captured payment — the share is held instead.
     *
     * @return array{id:string,status:string,amount:int}|null
     */
    public function createTransfer(string $paymentId, string $linkedAccountId, int $amountPaise, array $notes = []): ?array
    {
        if ($paymentId === '' || $linkedAccountId === '' || $amountPaise <= 0) {
            return null;
        }

        try {
            $payload = [
                'transfers' => [[
                    'account' => $linkedAccountId,
                    'amount' => $amountPaise,
                    'currency' => (string) config('services.razorpay.currency', 'INR'),
                    'notes' => $notes,
                ]],
            ];

            $result = $this->api->payment->fetch($paymentId)->transfer($payload);

            // The SDK returns a collection of the transfers just created.
            $item = $result->items[0] ?? ($result[0] ?? null);
            if (!$item || empty($item->id)) {
                return null;
            }

            return [
                'id' => (string) $item->id,
                'status' => (string) ($item->status ?? 'created'),
                'amount' => (int) ($item->amount ?? $amountPaise),
            ];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Reverses a Route transfer (fully, or a partial amount) so a cancelled or
     * refunded ride doesn't leave the driver paid. Fails soft (null).
     *
     * @return array{id:string,status:string,amount:int}|null
     */
    public function reverseTransfer(string $transferId, ?int $amountPaise = null): ?array
    {
        if ($transferId === '') {
            return null;
        }

        try {
            $payload = ($amountPaise !== null && $amountPaise > 0) ? ['amount' => $amountPaise] : [];
            $reversal = $this->api->transfer->fetch($transferId)->reversals()->create($payload);

            return [
                'id' => (string) $reversal->id,
                'status' => (string) ($reversal->status ?? 'processed'),
                'amount' => (int) ($reversal->amount ?? ($amountPaise ?? 0)),
            ];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Fetches a transfer's current state (created | processed | failed | reversed).
     * Used by the sweeper to reconcile transfers stuck without a webhook.
     *
     * @return array{id:string,status:string,amount:int}|null
     */
    public function fetchTransfer(string $transferId): ?array
    {
        if ($transferId === '') {
            return null;
        }

        try {
            $transfer = $this->api->transfer->fetch($transferId);

            return [
                'id' => (string) $transfer->id,
                'status' => (string) ($transfer->status ?? 'created'),
                'amount' => (int) ($transfer->amount ?? 0),
            ];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Creates an itemized tax invoice in Razorpay and instructs Razorpay to
     * automatically email the branded bill & PDF download link to the payer.
     *
     * @param array{name?:string,email:string,contact?:string} $customer
     * @param array<int, array{name:string,description?:string,amount:int,currency?:string,quantity?:int}> $lineItems
     * @return array{id:string,invoice_number:string,short_url:string,status:string}|null
     */
    public function createAndSendInvoice(
        array $customer,
        array $lineItems,
        string $description,
        string $receipt,
        array $options = []
    ): ?array {
        $email = trim((string) ($customer['email'] ?? ''));
        if ($email === '' || str_ends_with($email, '@otp.local')) {
            \Illuminate\Support\Facades\Log::info('Skipping Razorpay invoice email: invalid or local OTP email address', [
                'email' => $email,
                'receipt' => $receipt,
            ]);
            return null;
        }

        try {
            $currency = (string) config('services.razorpay.currency', 'INR');

            $payload = [
                'type' => 'invoice',
                'description' => $description,
                'receipt' => substr($receipt, 0, 40),
                'customer' => [
                    'name' => $customer['name'] ?? 'Customer',
                    'email' => $email,
                    'contact' => $customer['contact'] ?? '',
                ],
                'line_items' => $lineItems,
                'email_notify' => 1,
                'sms_notify' => !empty($customer['contact']) ? 1 : 0,
                'currency' => $currency,
            ];

            if (!empty($options['notes'])) {
                $payload['notes'] = $options['notes'];
            }

            $invoice = $this->api->invoice->create($payload);

            if (isset($invoice->status) && $invoice->status === 'draft') {
                $invoice = $invoice->issue();
            }

            return [
                'id' => (string) $invoice->id,
                'invoice_number' => (string) ($invoice->invoice_number ?? $invoice->id),
                'short_url' => (string) ($invoice->short_url ?? ''),
                'status' => (string) ($invoice->status ?? 'issued'),
            ];
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Razorpay auto-invoice creation failed', [
                'receipt' => $receipt,
                'email' => $email,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * Dispatches an automated Razorpay bill for a completed/prepaid Solo Ride.
     */
    public function createInvoiceForTrip(\App\Models\Trip $trip, \App\Models\Payment $payment): ?array
    {
        $trip->loadMissing(['customer', 'rideType']);
        $customer = $trip->customer;
        if (!$customer || empty($customer->email)) {
            return null;
        }

        $amountPaise = (int) round(((float) $payment->amount) * 100);
        $rideTypeName = $trip->rideType->name ?? 'Standard Cab';
        $pickup = $trip->pickup_address ?: 'Pickup Location';
        $drop = $trip->drop_address ?: 'Drop Location';

        $lineItems = [
            [
                'name' => "Ride Fare ({$rideTypeName})",
                'description' => "Route: {$pickup} to {$drop}",
                'amount' => $amountPaise,
                'currency' => $payment->currency ?: 'INR',
                'quantity' => 1,
            ]
        ];

        return $this->createAndSendInvoice(
            customer: [
                'name' => $customer->name ?? 'Customer',
                'email' => $customer->email,
                'contact' => $customer->phone ?? '',
            ],
            lineItems: $lineItems,
            description: "DreamCabs Ride #{$trip->id} Invoice",
            receipt: "INV-TR-{$trip->id}-" . time(),
            options: [
                'notes' => [
                    'trip_id' => (string) $trip->id,
                    'payment_id' => (string) ($payment->razorpay_payment_id ?? $payment->id),
                ]
            ]
        );
    }

    /**
     * Dispatches an automated Razorpay bill for a Fixed Intercity Seat Reservation.
     */
    public function createInvoiceForFixedBooking(\App\Models\SeatReservation $reservation, float $amount, ?string $paymentId = null): ?array
    {
        $reservation->loadMissing(['customer', 'routeDeparture.route']);
        $customer = $reservation->customer;
        if (!$customer || empty($customer->email)) {
            return null;
        }

        $amountPaise = (int) round($amount * 100);
        $routeName = $reservation->route_name ?: ($reservation->routeDeparture->route->name ?? 'Fixed Intercity Route');
        $board = $reservation->board_address ?: 'Boarding Point';
        $drop = $reservation->drop_address ?: 'Drop Point';
        $seats = (int) $reservation->seats;

        $lineItems = [
            [
                'name' => "Intercity Seat Booking ({$seats} Seat" . ($seats > 1 ? 's' : '') . ")",
                'description' => "Route: {$routeName} ({$board} to {$drop})",
                'amount' => $amountPaise,
                'currency' => 'INR',
                'quantity' => 1,
            ]
        ];

        return $this->createAndSendInvoice(
            customer: [
                'name' => $customer->name ?? 'Passenger',
                'email' => $customer->email,
                'contact' => $customer->phone ?? '',
            ],
            lineItems: $lineItems,
            description: "DreamCabs Fixed Booking #{$reservation->id}",
            receipt: "INV-FX-{$reservation->id}-" . time(),
            options: [
                'notes' => [
                    'reservation_id' => (string) $reservation->id,
                    'payment_reference' => (string) ($paymentId ?: $reservation->payment_reference),
                ]
            ]
        );
    }

    /**
     * Dispatches an automated Razorpay bill for a Shuttle Passenger Booking.
     */
    public function createInvoiceForShuttleBooking(\App\Models\ShuttlePassengerBooking $booking, float $amount, ?string $paymentId = null): ?array
    {
        $booking->loadMissing(['customer']);
        $customer = $booking->customer;
        if (!$customer || empty($customer->email)) {
            return null;
        }

        $amountPaise = (int) round($amount * 100);
        $pickup = $booking->pickup_address ?: 'Pickup Stop';
        $drop = $booking->drop_address ?: 'Drop Stop';
        $seats = (int) ($booking->seats ?: 1);

        $lineItems = [
            [
                'name' => "Shuttle Ticket ({$seats} Seat" . ($seats > 1 ? 's' : '') . ")",
                'description' => "Route: {$pickup} to {$drop}",
                'amount' => $amountPaise,
                'currency' => 'INR',
                'quantity' => 1,
            ]
        ];

        return $this->createAndSendInvoice(
            customer: [
                'name' => $customer->name ?? 'Passenger',
                'email' => $customer->email,
                'contact' => $customer->phone ?? '',
            ],
            lineItems: $lineItems,
            description: "DreamCabs Shuttle Booking #{$booking->id}",
            receipt: "INV-SH-{$booking->id}-" . time(),
            options: [
                'notes' => [
                    'shuttle_booking_id' => (string) $booking->id,
                    'payment_id' => (string) ($paymentId ?: $booking->razorpay_payment_id),
                ]
            ]
        );
    }

    /**
     * Dispatches an automated Razorpay receipt for a Driver Wallet Top-Up.
     */
    public function createInvoiceForWalletTopup(\App\Models\User $driver, \App\Models\WalletTopup $topup): ?array
    {
        $email = trim((string) $driver->email);
        if ($email === '' || str_ends_with($email, '@otp.local')) {
            return null;
        }

        $amountPaise = (int) round(((float) $topup->amount) * 100);

        $lineItems = [
            [
                'name' => 'Driver Wallet Top-Up / Recharge',
                'description' => 'Account balance top-up for DreamCabs driver account',
                'amount' => $amountPaise,
                'currency' => 'INR',
                'quantity' => 1,
            ]
        ];

        return $this->createAndSendInvoice(
            customer: [
                'name' => $driver->name ?? 'Driver',
                'email' => $email,
                'contact' => $driver->phone ?? '',
            ],
            lineItems: $lineItems,
            description: "Driver Wallet Top-Up #{$topup->id}",
            receipt: "INV-TP-{$topup->id}-" . time(),
            options: [
                'notes' => [
                    'driver_id' => (string) $driver->id,
                    'topup_id' => (string) $topup->id,
                    'razorpay_payment_id' => (string) ($topup->razorpay_payment_id ?? ''),
                ]
            ]
        );
    }

    /**
     * Low-level caller for the v2 onboarding API (basic-auth, JSON). Returns the
     * decoded body on 2xx, or null on any error so callers can degrade cleanly.
     */
    private function v2(string $method, string $path, array $body = []): ?array
    {
        try {
            $req = \Illuminate\Support\Facades\Http::withBasicAuth($this->keyId, $this->keySecret)
                ->acceptJson()
                ->asJson();

            $res = match ($method) {
                'get' => $req->get(self::V2_BASE . $path),
                'post' => $req->post(self::V2_BASE . $path, $body),
                'patch' => $req->patch(self::V2_BASE . $path, $body),
                default => null,
            };

            if (!$res || $res->failed()) {
                return null;
            }

            return $res->json();
        } catch (\Throwable) {
            return null;
        }
    }
}



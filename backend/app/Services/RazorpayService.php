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
     * Low-level caller for the v2 onboarding API (basic-auth, JSON). Returns the
     * decoded body on 2xx, or null on any error so callers can degrade cleanly.
     */
    private function v2(string $method, string $path, array $body = []): ?array
    {
        try {
            $req = Http::withBasicAuth($this->keyId, $this->keySecret)
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


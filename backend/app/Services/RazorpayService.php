<?php

namespace App\Services;

use Razorpay\Api\Api;

class RazorpayService
{
    private Api $api;
    private string $webhookSecret;

    public function __construct()
    {
        $keyId = config('services.razorpay.key_id');
        $keySecret = config('services.razorpay.key_secret');
        $this->webhookSecret = (string) config('services.razorpay.webhook_secret', '');

        if (!$keyId || !$keySecret) {
            throw new \RuntimeException('Missing Razorpay credentials in env.');
        }

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
}


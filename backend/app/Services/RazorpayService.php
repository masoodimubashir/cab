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


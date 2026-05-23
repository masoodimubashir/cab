<?php

namespace App\Services;

use Razorpay\Api\Api;

class RazorpayService
{
    private Api $api;
    private string $webhookSecret;

    public function __construct()
    {
        $keyId = env('RAZORPAY_KEY_ID');
        $keySecret = env('RAZORPAY_KEY_SECRET');
        $this->webhookSecret = (string) env('RAZORPAY_WEBHOOK_SECRET', '');

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
        $currency = (string) env('RAZORPAY_CURRENCY', 'INR');

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


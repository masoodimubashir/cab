<?php

namespace App\Http\Controllers;

use App\Models\WalletTopup;
use App\Models\WalletTransaction;
use App\Services\RazorpayService;
use App\Services\WalletService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Driver wallet: view balance + recent activity, and top up via Razorpay.
 *
 * Top-up is a two-step Razorpay flow mirroring trip payments:
 *   1. topupRazorpay()       → create an order, return checkout params
 *   2. verifyTopupRazorpay() → verify the signature, credit the wallet
 * A WalletTopup row tracks each order so crediting is idempotent (a replayed
 * verify on an already-SUCCESS order just returns the balance).
 */
class DriverWalletController
{
    public function __construct(private WalletService $wallet)
    {
    }

    public function show(Request $request)
    {
        $user = $request->user();

        $transactions = WalletTransaction::query()
            ->where('user_id', $user->id)
            ->orderByDesc('id')
            ->limit(20)
            ->get()
            ->map(fn (WalletTransaction $t) => [
                'id' => $t->id,
                'type' => $t->type,
                'amount' => (float) $t->amount,
                'reason' => $t->reason,
                'created_at' => optional($t->created_at)->toIso8601String(),
            ]);

        return response()->json([
            'balance' => $this->wallet->balance($user),
            'currency' => 'INR',
            'transactions' => $transactions,
        ]);
    }

    public function topupRazorpay(Request $request, RazorpayService $razorpayService)
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:1', 'max:100000'],
        ]);

        $user = $request->user();
        $amount = round((float) $data['amount'], 2);

        // Enforce the operator's wallet max-cap BEFORE the rider pays — a top-up
        // may not push the balance over the cap. We gate here (not at verify):
        // once Razorpay has captured the money, refusing the credit would lose it.
        if ($msg = $this->wallet->capViolation($user, WalletTransaction::TYPE_CREDIT, $amount)) {
            return response()->json(['message' => $msg], 422);
        }

        $amountPaise = (int) round($amount * 100);
        $receipt = 'wallet_' . $user->id . '_' . now()->format('YmdHis');

        return DB::transaction(function () use ($user, $amount, $amountPaise, $receipt, $razorpayService) {
            $topup = WalletTopup::query()->create([
                'user_id' => $user->id,
                'amount' => $amount,
                'currency' => 'INR',
                'status' => WalletTopup::STATUS_PENDING,
            ]);

            $order = $razorpayService->createOrder($amountPaise, $receipt);
            $topup->razorpay_order_id = $order['order_id'];
            $topup->save();

            return response()->json([
                'topup_id' => $topup->id,
                'razorpay' => [
                    'key_id' => env('RAZORPAY_KEY_ID'),
                    'order_id' => $order['order_id'],
                    'amount_paise' => $order['amount'],
                    'currency' => $order['currency'],
                ],
            ]);
        });
    }

    public function verifyTopupRazorpay(Request $request, RazorpayService $razorpayService)
    {
        $data = $request->validate([
            'razorpay_payment_id' => ['required', 'string'],
            'razorpay_order_id' => ['required', 'string'],
            'razorpay_signature' => ['required', 'string'],
        ]);

        $user = $request->user();
        $topup = WalletTopup::query()
            ->where('user_id', $user->id)
            ->where('razorpay_order_id', $data['razorpay_order_id'])
            ->first();

        if (! $topup) {
            return response()->json(['message' => 'Top-up record not found.'], 404);
        }
        if ($topup->status === WalletTopup::STATUS_SUCCESS) {
            return response()->json(['balance' => $this->wallet->balance($user), 'currency' => 'INR']);
        }

        $valid = $razorpayService->verifyPaymentSignature(
            $data['razorpay_order_id'],
            $data['razorpay_payment_id'],
            $data['razorpay_signature'],
        );

        if (! $valid) {
            $topup->status = WalletTopup::STATUS_FAILED;
            $topup->save();
            Log::warning('Wallet top-up signature invalid', [
                'user_id' => $user->id,
                'razorpay_order_id' => $data['razorpay_order_id'],
            ]);
            return response()->json(['message' => 'Invalid payment signature.'], 400);
        }

        return DB::transaction(function () use ($topup, $data, $user) {
            $topup->razorpay_payment_id = $data['razorpay_payment_id'];
            $topup->status = WalletTopup::STATUS_SUCCESS;
            $topup->paid_at = now();
            $topup->save();

            // No cap re-check here: the payment is already captured by Razorpay,
            // so the wallet must be credited. The max-cap gate runs at order
            // creation (topupRazorpay), before the rider pays.
            $this->wallet->recordTransaction(
                $user,
                WalletTransaction::TYPE_CREDIT,
                (float) $topup->amount,
                'Wallet top-up (Razorpay)',
                null,
                null,
            );

            return response()->json([
                'balance' => $this->wallet->balance($user),
                'currency' => 'INR',
                'message' => 'Wallet topped up.',
            ]);
        });
    }
}

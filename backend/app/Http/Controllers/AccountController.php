<?php

namespace App\Http\Controllers;

use App\Models\OperatorSetting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class AccountController extends Controller
{
    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request)
    {
        $data = $request->validate([
            'role' => ['required', 'in:customer,driver'],
        ]);

        $user = $request->user();
        $role = $data['role'];

        DB::transaction(function () use ($user, $role) {
            $user->roles()->where('role', $role)->delete();

            $remaining = $user->roles()->whereIn('role', ['customer', 'driver'])->count();

            if ($remaining === 0) {
                if ($user->avatar_path && Storage::disk('public')->exists($user->avatar_path)) {
                    Storage::disk('public')->delete($user->avatar_path);
                }
                $user->tokens()->delete();
                $user->delete();
            } else {
                $user->currentAccessToken()->delete();
            }
        });

        return response()->json(['ok' => true]);
    }

    public function updateDriverPaymentMethods(Request $request)
    {
        // Drivers may only change their accepted methods when the operator
        // allows it (Operator Settings → Driver). Otherwise the operator owns
        // payment-mode policy.
        if (!OperatorSetting::instance()->update_driver_payment_modes_enabled) {
            return response()->json([
                'message' => 'Payment methods are managed by your operator.',
            ], 403);
        }

        $data = $request->validate([
            'methods' => ['required', 'array', 'min:1'],
            'methods.*' => ['in:cash,razorpay'],
        ]);

        $user = $request->user();
        $user->accepted_payment_methods = array_values(array_unique($data['methods']));
        $user->save();

        return response()->json([
            'accepted_payment_methods' => $user->accepted_payment_methods,
        ]);
    }
}

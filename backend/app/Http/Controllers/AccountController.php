<?php

namespace App\Http\Controllers;

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
        $data = $request->validate([
            'methods' => ['required', 'array', 'min:1'],
            'methods.*' => ['in:cash,upi,qr'],
        ]);

        $user = $request->user();
        $user->accepted_payment_methods = array_values(array_unique($data['methods']));
        $user->save();

        return response()->json([
            'accepted_payment_methods' => $user->accepted_payment_methods,
        ]);
    }
}

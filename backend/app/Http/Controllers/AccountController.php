<?php

namespace App\Http\Controllers;

use App\Models\OperatorSetting;
use App\Models\User;
use App\Models\DriverDocument;
use App\Models\Invoice;
use App\Models\Trip;
use App\Services\FirebaseAuthService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class AccountController extends Controller
{
    public function logout(Request $request)
    {
        $user = $request->user();
        if ($user->hasRole('driver') && $user->tokenCan('act-as:driver')) {
            $user->driver()->update(['is_online' => false, 'last_offline_at' => now()]);
        }
        $user->currentAccessToken()?->delete();

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request)
    {
        $data = $request->validate([
            'role' => ['required', 'in:customer,driver'],
            'scope' => ['sometimes', 'in:all'],
        ]);

        $user = $request->user();
        $role = $data['role'];

        abort_unless($user->hasRole($role) && $user->tokenCan("act-as:$role"), 403);

        DB::transaction(function () use ($user, $data) {
            $account = User::query()->lockForUpdate()->findOrFail($user->id);
            // Never silently remove a shared identity from an older client's role-only request.
            $roles = $account->roles()->pluck('role');
            abort_if($roles->diff(['customer', 'driver'])->isNotEmpty(), 409,
                'This account also has administrative access. Contact support to arrange deletion.');
            abort_if($roles->count() > 1 && ($data['scope'] ?? null) !== 'all', 409,
                'This account is shared by the customer and driver apps. Update the app to confirm deletion from both apps, or contact support.');

            $driverId = $account->driver()->value('id');
            $documents = $driverId
                ? DriverDocument::query()->where('driver_id', $driverId)->pluck('file_path')
                : collect();
            $invoices = Invoice::query()->whereIn('trip_id',
                Trip::query()->where('customer_id', $account->id)->select('id'))->pluck('pdf_path');

            // A failed external/file cleanup must not return a false success or lose
            // the paths needed for retry. Removing an already absent item is safe.
            if ($account->google_sub) {
                app(FirebaseAuthService::class)->deleteIdentity($account->google_sub);
            }
            foreach ($documents as $path) $this->deleteStoredFile('local', $path, 'driver-documents/');
            foreach ($invoices as $path) $this->deleteStoredFile('local', $path, 'invoices/');
            $this->deleteStoredFile('public', $account->avatar_path, 'avatars/');

            DB::table('phone_otps')->where('phone', $account->phone)->delete();
            DB::table('sessions')->where('user_id', $account->id)->delete();
            $account->tokens()->delete();
            // Foreign keys remove role/profile, saved-contact, location, booking
            // and other account-owned rows. Independent accounting ledgers remain.
            $account->delete();
        });

        return response()->json(['ok' => true]);
    }

    private function deleteStoredFile(string $disk, ?string $path, string $prefix): void
    {
        if (!$path || filter_var($path, FILTER_VALIDATE_URL)) return;
        // Restrict deletions to this application's upload directories.
        abort_unless(str_starts_with($path, $prefix) && !str_contains($path, '..')
            && !str_contains($path, '\\'), 409, 'A stored file needs support review before deletion.');
        $storage = Storage::disk($disk);
        if ($storage->exists($path) && !$storage->delete($path)) {
            abort(503, 'File cleanup could not finish. Please retry account deletion or contact support.');
        }
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

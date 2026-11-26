<?php

namespace App\Http\Controllers\Dev;

use App\Models\Carpool\CarpoolSetting;
use App\Services\Dev\DevHub;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;

/** The developer hub API (local only, see DevHub). */
class DevHubController
{
    public function __construct(private DevHub $hub)
    {
        // Second lock behind the route registration in bootstrap/app.php: outside a local
        // environment with DEV_HUB=true this controller answers 404 even if a route were added.
        DevHub::guard();
    }

    public function state(): JsonResponse
    {
        return response()->json([
            'enabled' => true,
            'now' => now()->toIso8601String(),
            'time_offset_minutes' => DevHub::timeOffset(),
            'carpool_enabled' => (bool) CarpoolSetting::current()->enabled,
            'kill_switch' => (bool) config('carpool.kill_switch'),
            'people' => DevHub::people(),
            'code' => DevHub::CODE,
        ]);
    }

    public function signIn(Request $request): JsonResponse
    {
        $key = (string) $request->validate(['key' => ['required', 'string']])['key'];
        $user = $this->hub->person($key);
        $role = DevHub::PEOPLE[$key][1];
        $user->last_login_at = now();
        $user->save();
        $token = $user->createToken('dreamcabs-api', ["act-as:{$role}"])->plainTextToken;

        return response()->json([
            'token' => $token,
            'role' => $role,
            'user' => [
                'id' => $user->id, 'name' => $user->name, 'email' => $user->email, 'phone' => $user->phone,
                'avatar_path' => $user->avatar_path,
                'avatar_url' => $user->avatar_path ? url('/storage/' . ltrim($user->avatar_path, '/')) : null,
                'dob' => $user->dob?->toDateString(), 'address' => $user->address,
                'roles' => $user->roleNames(),
                'accepted_payment_methods' => $user->accepted_payment_methods ?? ['cash', 'razorpay'],
            ],
        ]);
    }

    public function freshNumber(): JsonResponse
    {
        return response()->json(['phone' => $this->hub->freshNumber(), 'code' => DevHub::CODE]);
    }

    public function scenarios(): JsonResponse
    {
        return response()->json(['data' => $this->hub->scenarios()->catalogue()]);
    }

    public function scenario(Request $request): JsonResponse
    {
        $key = (string) $request->validate(['key' => ['required', 'string']])['key'];

        return response()->json(['message' => $this->hub->scenarios()->run($key, $request->user())]);
    }

    public function resetMe(Request $request): JsonResponse
    {
        $delete = (bool) $request->input('delete_account', false);
        $this->hub->wipeCarpoolOf($request->user(), $delete);

        return response()->json(['message' => $delete ? 'Account deleted. Sign up again from scratch.' : 'Your carpool data is cleared.']);
    }

    public function wipeCarpool(): JsonResponse
    {
        $this->hub->wipeAllCarpool();

        return response()->json(['message' => 'All carpools, requests, chats, ratings and reports are cleared.']);
    }

    public function time(Request $request): JsonResponse
    {
        $m = (int) $request->validate(['minutes' => ['required', 'integer', 'min:-10080', 'max:20160']])['minutes'];
        DevHub::setTimeOffset($request->boolean('add') ? DevHub::timeOffset() + $m : $m);
        $now = DevHub::timeOffset();

        return response()->json([
            'time_offset_minutes' => $now,
            'message' => $now === 0 ? 'Time is back to normal.' : 'Time is moved by ' . $now . ' minutes.',
        ]);
    }

    public function job(Request $request): JsonResponse
    {
        $name = (string) $request->validate(['name' => ['required', 'in:lifecycle,expire-requests,prune-chats']])['name'];
        $cmd = ['lifecycle' => 'carpool:lifecycle', 'expire-requests' => 'carpool:expire-requests', 'prune-chats' => 'carpool:prune-chats'][$name];
        Artisan::call($cmd);

        return response()->json(['message' => trim(Artisan::output()) ?: 'Done.']);
    }

    /** L1.6 Simulate drive: moves the car of the carpool on the road (see DevHub::drive). */
    public function drive(Request $request): JsonResponse
    {
        $v = $request->validate(['to' => ['required', 'in:step,pickup'], 'metres' => ['nullable', 'integer', 'min:50', 'max:3000']]);

        return response()->json(['message' => $this->hub->drive($request->user(), $v['to'], (int) ($v['metres'] ?? 300))]);
    }

    public function switch(Request $request): JsonResponse
    {
        $on = (bool) $request->validate(['carpool_enabled' => ['required', 'boolean']])['carpool_enabled'];
        CarpoolSetting::current()->update(['enabled' => $on]);

        return response()->json(['carpool_enabled' => $on, 'message' => $on ? 'Carpool is on.' : 'Carpool is off.']);
    }
}

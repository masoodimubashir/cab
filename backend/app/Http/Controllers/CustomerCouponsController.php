<?php

namespace App\Http\Controllers;

use App\Models\CouponAssignment;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Customer-facing list of the coupons a customer holds.
 *
 * Coupons are still redeemed on the post-trip payment screen (the customer
 * types the code there). This endpoint only lets the app SHOW customers which
 * coupons they have, so they aren't guessing codes. It never applies a
 * discount — that stays in PaymentsController::couponPreview / payCash.
 */
class CustomerCouponsController extends Controller
{
    /**
     * GET /me/coupons — every coupon assigned to the signed-in customer,
     * newest first, with a ready-to-render status + discount label so the
     * mobile UI stays dumb. Available coupons are listed before used/expired.
     */
    public function index(Request $request)
    {
        $now = Carbon::now();

        $assignments = CouponAssignment::query()
            ->where('user_id', $request->user()->id)
            ->with(['coupon:id,title,subtitle,description,city_id,discount_type,discount_value,discount_maximum,is_active', 'coupon.city:id,name'])
            ->orderByDesc('id')
            ->get()
            ->filter(fn (CouponAssignment $a) => $a->coupon !== null);

        $rows = $assignments->map(function (CouponAssignment $a) use ($now) {
            $coupon = $a->coupon;
            $status = $this->statusFor($a, $coupon, $now);

            return [
                'id' => $a->id,
                'title' => $coupon->title,
                'subtitle' => $coupon->subtitle,
                'description' => $coupon->description,
                'discount_label' => $this->discountLabel($coupon),
                'city' => $coupon->city?->name,
                'status' => $status,
                'is_available' => $status === 'available',
                'reason' => $a->reason,
                'expires_at' => optional($a->expires_at)->toIso8601String(),
                'used_at' => optional($a->used_at)->toIso8601String(),
            ];
        })->values();

        // Available coupons first, then most-recently issued within each group.
        $sorted = $rows->sortBy(fn ($r) => $r['is_available'] ? 0 : 1)->values();

        return response()->json(['data' => $sorted->all()]);
    }

    /**
     * available  — usable right now (not used, not expired, coupon still active)
     * used       — already redeemed on a trip
     * expired    — past its expiry date, or the operator deactivated the coupon
     */
    private function statusFor(CouponAssignment $a, $coupon, Carbon $now): string
    {
        if ($a->used_at !== null) {
            return 'used';
        }
        if ($a->expires_at !== null && $a->expires_at->lt($now)) {
            return 'expired';
        }
        if (!$coupon->is_active) {
            return 'expired';
        }

        return 'available';
    }

    /** Human label like "20% off (up to ₹80)" or "₹50 off". */
    private function discountLabel($coupon): string
    {
        $value = $this->trimDecimal((float) $coupon->discount_value);

        if ($coupon->discount_type === 'percentage') {
            $label = $value . '% off';
            if ($coupon->discount_maximum !== null) {
                $label .= ' (up to ₹' . $this->trimDecimal((float) $coupon->discount_maximum) . ')';
            }

            return $label;
        }

        return '₹' . $value . ' off';
    }

    /** 20.00 -> "20", 12.50 -> "12.5". */
    private function trimDecimal(float $value): string
    {
        return rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');
    }
}

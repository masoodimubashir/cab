<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\Coupon;
use App\Models\ReferralSetting;
use Illuminate\Http\Request;

class AdminReferralsController
{
    public function show(City $city)
    {
        $settings = $this->getOrCreate($city);
        return response()->json([
            'city_id' => $city->id,
            'settings' => $this->shape($settings),
            'coupons' => Coupon::query()
                ->where('city_id', $city->id)
                ->where('is_active', true)
                ->orderByDesc('id')
                ->get()
                ->map(fn (Coupon $c) => [
                    'id' => $c->id,
                    'title' => $c->title,
                    'subtitle' => $c->subtitle,
                    'promo_type' => $c->promo_type,
                    'discount_type' => $c->discount_type,
                    'discount_value' => (float) $c->discount_value,
                    'discount_maximum' => $c->discount_maximum !== null ? (float) $c->discount_maximum : null,
                ]),
        ]);
    }

    public function update(Request $request, City $city)
    {
        $data = $request->validate([
            'referee_benefit_type' => ['sometimes', 'string', 'in:none,coupon,carpool_coupon'],
            'referee_coupon_id' => ['nullable', 'integer', 'exists:coupons,id'],
            'referrer_benefit_type' => ['sometimes', 'string', 'in:none,coupon,carpool_coupon'],
            'referrer_coupon_id' => ['nullable', 'integer', 'exists:coupons,id'],

            'referral_message' => ['nullable', 'string'],
            'facebook_caption' => ['nullable', 'string'],
            'facebook_description' => ['nullable', 'string'],
            'referral_caption' => ['nullable', 'string'],
            'referral_email_subject' => ['nullable', 'string', 'max:255'],
            'referral_email_support' => ['nullable', 'string'],
            'referral_cashback_text' => ['nullable', 'string'],
            'invite_and_earn_message' => ['nullable', 'string'],
            'invite_and_earn_info' => ['nullable', 'string'],
            'referral_sharing_message' => ['nullable', 'string'],
            'branch_android_url' => ['nullable', 'string', 'max:500'],
            'branch_desktop_url' => ['nullable', 'string', 'max:500'],
            'branch_ios_url' => ['nullable', 'string', 'max:500'],
            'branch_fallback_url' => ['nullable', 'string', 'max:500'],
        ]);

        // Clear orphan coupon ref if the benefit type was set to none.
        if (($data['referee_benefit_type'] ?? null) === 'none') {
            $data['referee_coupon_id'] = null;
        }
        if (($data['referrer_benefit_type'] ?? null) === 'none') {
            $data['referrer_coupon_id'] = null;
        }

        $settings = $this->getOrCreate($city);
        $settings->fill($data)->save();

        return response()->json([
            'settings' => $this->shape($settings->fresh()),
            'message' => 'Referral settings updated.',
        ]);
    }

    private function getOrCreate(City $city): ReferralSetting
    {
        return ReferralSetting::query()
            ->firstOrCreate(['city_id' => $city->id]);
    }

    private function shape(ReferralSetting $s): array
    {
        return [
            'id' => $s->id,
            'city_id' => $s->city_id,
            'referee_benefit_type' => $s->referee_benefit_type,
            'referee_coupon_id' => $s->referee_coupon_id,
            'referrer_benefit_type' => $s->referrer_benefit_type,
            'referrer_coupon_id' => $s->referrer_coupon_id,
            'referral_message' => $s->referral_message,
            'facebook_caption' => $s->facebook_caption,
            'facebook_description' => $s->facebook_description,
            'referral_caption' => $s->referral_caption,
            'referral_email_subject' => $s->referral_email_subject,
            'referral_email_support' => $s->referral_email_support,
            'referral_cashback_text' => $s->referral_cashback_text,
            'invite_and_earn_message' => $s->invite_and_earn_message,
            'invite_and_earn_info' => $s->invite_and_earn_info,
            'referral_sharing_message' => $s->referral_sharing_message,
            'branch_android_url' => $s->branch_android_url,
            'branch_desktop_url' => $s->branch_desktop_url,
            'branch_ios_url' => $s->branch_ios_url,
            'branch_fallback_url' => $s->branch_fallback_url,
        ];
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'city_id',
    'referee_benefit_type', 'referee_coupon_id',
    'referrer_benefit_type', 'referrer_coupon_id',
    'referral_message', 'facebook_caption', 'facebook_description',
    'referral_caption', 'referral_email_subject', 'referral_email_support',
    'referral_cashback_text', 'invite_and_earn_message', 'invite_and_earn_info',
    'referral_sharing_message',
    'branch_android_url', 'branch_desktop_url', 'branch_ios_url', 'branch_fallback_url',
])]
class ReferralSetting extends Model
{
    use HasFactory;

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class);
    }

    public function refereeCoupon(): BelongsTo
    {
        return $this->belongsTo(Coupon::class, 'referee_coupon_id');
    }

    public function referrerCoupon(): BelongsTo
    {
        return $this->belongsTo(Coupon::class, 'referrer_coupon_id');
    }
}

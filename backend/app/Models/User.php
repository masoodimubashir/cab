<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use App\Models\Driver;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use App\Models\Trip;
use App\Models\Rating;
use App\Models\WalletTransaction;

#[Fillable([
    'name', 'email', 'password', 'phone', 'google_sub', 'avatar_path',
    'accepted_payment_methods', 'last_login_at',
    'manager_role_id', 'manager_city_id', 'manager_all_cities', 'manager_fleet_id', 'is_suspended',
    // Customer profile fields (admin Customer module)
    'dob', 'address', 'app_version', 'os_version', 'device_type',
    'email_unsubscribed', 'sms_unsubscribed', 'push_unsubscribed',
    'duplicate_registration',
    'suspended_reason', 'suspended_at',
    // Last-known location pinged from the mobile apps.
    'current_lat', 'current_lng', 'current_location_updated_at',
    // Driver payout account (Razorpay Route linked account / "driver KYC").
    'razorpay_linked_account_id', 'razorpay_route_product_id',
    'payout_account_status', 'payout_method', 'payout_pan', 'payout_beneficiary_name',
    'payout_account_number', 'payout_ifsc', 'payout_upi', 'payout_bank_last4',
    'payout_verified_at', 'payout_reject_reason',
])]
#[Hidden(['password', 'remember_token', 'payout_pan', 'payout_account_number'])]
class User extends Authenticatable
{
    use HasApiTokens, HasFactory;

    // Driver payout-account lifecycle. A driver is only paid automatically once
    // their account is VERIFIED; before that their share is held.
    public const PAYOUT_NONE = 'none';
    public const PAYOUT_PENDING = 'pending';
    public const PAYOUT_VERIFIED = 'verified';
    public const PAYOUT_REJECTED = 'rejected';

    protected $casts = [
        'dob' => 'date',
        'accepted_payment_methods' => 'array',
        'last_login_at' => 'datetime',
        'suspended_at' => 'datetime',
        'current_location_updated_at' => 'datetime',
        'manager_all_cities' => 'boolean',
        'is_suspended' => 'boolean',
        'email_unsubscribed' => 'boolean',
        'sms_unsubscribed' => 'boolean',
        'push_unsubscribed' => 'boolean',
        'duplicate_registration' => 'boolean',
        'current_lat' => 'float',
        'current_lng' => 'float',
        // Sensitive KYC values: ciphertext at rest, plaintext in-app.
        'payout_pan' => 'encrypted',
        'payout_account_number' => 'encrypted',
        'payout_verified_at' => 'datetime',
    ];

    /** True once the driver can receive automatic Route transfers. */
    public function hasVerifiedPayoutAccount(): bool
    {
        return $this->payout_account_status === self::PAYOUT_VERIFIED
            && ! empty($this->razorpay_linked_account_id);
    }

    public function walletTransactions(): HasMany
    {
        return $this->hasMany(WalletTransaction::class, 'user_id');
    }


    public function roles(): HasMany
    {
        return $this->hasMany(UserRole::class);
    }

    public function hasRole(string $role): bool
    {
        return $this->roles()->where('role', $role)->exists();
    }

    public function addRole(string $role): void
    {
        UserRole::query()->firstOrCreate([
            'user_id' => $this->id,
            'role' => $role,
        ]);
    }

    /**
     * @return array<int, string>
     */
    public function roleNames(): array
    {
        return $this->roles()->pluck('role')->all();
    }

    public function driver(): HasOne
    {
        return $this->hasOne(Driver::class, 'user_id');
    }

    public function acceptsPaymentMethod(string $method): bool
    {
        $methods = $this->accepted_payment_methods ?? ['cash', 'razorpay'];
        return in_array($method, $methods, true);
    }

    public function tripsAsCustomer(): HasMany
    {
        return $this->hasMany(Trip::class, 'customer_id');
    }

    public function tripsAsDriver(): HasMany
    {
        return $this->hasMany(Trip::class, 'driver_id');
    }

    public function ratingsReceived(): HasMany
    {
        return $this->hasMany(Rating::class, 'driver_id');
    }

    public function ratingsGiven(): HasMany
    {
        return $this->hasMany(Rating::class, 'customer_id');
    }

    // ── RBAC ────────────────────────────────────────────────────────────

    public function managerRole(): BelongsTo
    {
        return $this->belongsTo(ManagerRole::class, 'manager_role_id');
    }

    public function managerCity(): BelongsTo
    {
        return $this->belongsTo(City::class, 'manager_city_id');
    }

    public function managerFleet(): BelongsTo
    {
        return $this->belongsTo(Fleet::class, 'manager_fleet_id');
    }

    public function isSuperAdmin(): bool
    {
        return $this->managerRole?->isSuperAdmin() ?? false;
    }

    /**
     * Returns true if this user's role grants the given permission slug.
     * Super Admin bypasses the check entirely.
     */
    public function hasPermission(string $slug): bool
    {
        if ($this->isSuperAdmin()) {
            return true;
        }
        // Dashboard is a baseline every role can open, so a manager always has
        // a safe place to land no matter which modules their role grants.
        if ($slug === 'dashboard') {
            return true;
        }
        $role = $this->managerRole;
        if (! $role) {
            return false;
        }
        return $role->permissions()->where('slug', $slug)->exists();
    }
}

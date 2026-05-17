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
use Illuminate\Support\Str;
use Laravel\Sanctum\HasApiTokens;
use App\Models\Trip;
use App\Models\Rating;
use App\Models\WalletTransaction;

#[Fillable([
    'name', 'email', 'password', 'phone', 'google_sub', 'avatar_path',
    'accepted_payment_methods', 'last_login_at',
    'manager_role_id', 'manager_city_id', 'manager_fleet_id', 'is_suspended',
    // Customer profile fields (admin Customer module)
    'dob', 'city', 'app_version', 'os_version', 'device_type',
    'referral_code', 'referred_by_user_id',
    'email_unsubscribed', 'sms_unsubscribed', 'push_unsubscribed',
    'duplicate_registration',
    'suspended_reason', 'suspended_at',
])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable, HasApiTokens, SoftDeletes;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'last_login_at' => 'datetime',
            'accepted_payment_methods' => 'array',
            'is_suspended' => 'boolean',
            'dob' => 'date',
            'email_unsubscribed' => 'boolean',
            'sms_unsubscribed' => 'boolean',
            'push_unsubscribed' => 'boolean',
            'duplicate_registration' => 'boolean',
            'suspended_at' => 'datetime',
        ];
    }

    /**
     * Auto-generate a referral code for any new user that doesn't already have one.
     * Customer signups, admin imports, and seeders all get covered by this hook.
     */
    protected static function booted(): void
    {
        static::creating(function (User $user) {
            if (empty($user->referral_code)) {
                do {
                    $candidate = strtoupper(Str::random(8));
                } while (self::query()->where('referral_code', $candidate)->exists());
                $user->referral_code = $candidate;
            }
        });
    }

    public function walletTransactions(): HasMany
    {
        return $this->hasMany(WalletTransaction::class, 'user_id');
    }

    public function referrer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'referred_by_user_id');
    }

    public function referees(): HasMany
    {
        return $this->hasMany(User::class, 'referred_by_user_id');
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
        $methods = $this->accepted_payment_methods ?? ['cash', 'upi', 'qr'];
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
        $role = $this->managerRole;
        if (! $role) {
            return false;
        }
        return $role->permissions()->where('slug', $slug)->exists();
    }
}

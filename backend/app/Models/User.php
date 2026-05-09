<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use App\Models\Driver;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use App\Models\Trip;
use App\Models\Rating;

#[Fillable(['name', 'email', 'password', 'phone', 'google_sub', 'avatar_path', 'accepted_payment_methods', 'last_login_at'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable, HasApiTokens;

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
        ];
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
}

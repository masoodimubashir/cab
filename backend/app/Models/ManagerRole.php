<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'slug', 'name',
    'is_system', 'is_suspendable', 'requires_fleet',
    'sort_order',
])]
class ManagerRole extends Model
{
    public const SUPER_ADMIN_SLUG = 'super_admin';

    protected $casts = [
        'is_system' => 'boolean',
        'is_suspendable' => 'boolean',
        'requires_fleet' => 'boolean',
    ];

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(
            Permission::class,
            'manager_role_permissions',
            'manager_role_id',
            'permission_id'
        );
    }

    public function managers(): HasMany
    {
        return $this->hasMany(User::class, 'manager_role_id');
    }

    public function isSuperAdmin(): bool
    {
        return $this->slug === self::SUPER_ADMIN_SLUG;
    }
}

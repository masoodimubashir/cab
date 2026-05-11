<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

#[Fillable(['slug', 'name', 'group', 'description', 'sort_order'])]
class Permission extends Model
{
    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(
            ManagerRole::class,
            'manager_role_permissions',
            'permission_id',
            'manager_role_id'
        );
    }
}

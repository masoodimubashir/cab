<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * One reason a rider or driver can pick when reporting (S9, D-08). `applies_to` says where it is offered:
 * on a person, on a message, or both. Turned off instead of deleted so old reports keep their label.
 */
class CarpoolReportReason extends Model
{
    protected $guarded = ['id'];

    protected $casts = ['active' => 'boolean', 'sort' => 'integer'];

    public const APPLIES = ['person', 'message', 'both'];

    /** key => label for every reason, including turned-off ones (old reports still show their label). */
    public static function labels(): array
    {
        return static::query()->pluck('label', 'key')->all();
    }

    /** A readable label for any key, even one that no longer exists. */
    public static function labelFor(?string $key, ?array $labels = null): string
    {
        $labels ??= static::labels();

        return $labels[$key] ?? Str::headline(str_replace('_', ' ', (string) $key));
    }

    /** @return list<string> every key ever used, for filtering old reports */
    public static function allKeys(): array
    {
        return static::query()->pluck('key')->all();
    }

    /** Is this reason on, and offered for this kind of report ('person' or 'message')? */
    public static function allows(string $key, string $context): bool
    {
        return static::query()->where('key', $key)->where('active', true)
            ->whereIn('applies_to', [$context, 'both'])->exists();
    }

    /** What the apps get from /config: only reasons that are on. */
    public static function forApps(): array
    {
        return static::query()->where('active', true)->orderBy('sort')->orderBy('id')->get(['key', 'label', 'applies_to'])
            ->map(fn (self $r) => ['key' => $r->key, 'label' => $r->label, 'applies_to' => $r->applies_to])->all();
    }

    /** A new, unused key from a label: "Asked for money" becomes asked_for_money, then asked_for_money_2. */
    public static function newKey(string $label): string
    {
        $base = substr(Str::slug($label, '_'), 0, 34) ?: 'reason';
        $key = $base;
        $n = 2;
        while (static::query()->where('key', $key)->exists()) {
            $key = $base . '_' . $n++;
        }

        return $key;
    }

    /** After a change, each kind of report must keep at least one reason on. */
    public static function leavesBothKindsCovered(): bool
    {
        foreach (['person', 'message'] as $context) {
            if (! static::query()->where('active', true)->whereIn('applies_to', [$context, 'both'])->exists()) {
                return false;
            }
        }

        return true;
    }
}

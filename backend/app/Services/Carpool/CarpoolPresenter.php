<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Storage;

/**
 * Shapes carpool data for the apps (M4). The API sends codes and numbers; the
 * apps hold the wording from the mockup. Phone numbers are never sent to the
 * other side.
 */
class CarpoolPresenter
{
    /** @return array<string, mixed> */
    public function place(CarpoolListing $l, string $p): array
    {
        return [
            'lat' => $l->{"{$p}_lat"},
            'lng' => $l->{"{$p}_lng"},
            'name' => $l->{"{$p}_name"},
            'address' => $l->{"{$p}_address"},
        ];
    }

    /** A carpool's headline for driver lists (Home request card, Inbox containers). */
    public function listingSummary(CarpoolListing $l): array
    {
        return [
            'id' => $l->id,
            'status' => $l->status,
            'start' => ['name' => $l->start_name],
            'end' => ['name' => $l->end_name],
            'departs_at' => $l->departs_at->toIso8601String(),
            'day' => CarpoolClock::daysFromToday($l->departs_at),
            'seats_total' => $l->seats_total,
            'seats_taken' => $l->seats_taken,
            'seats_free' => $l->seatsFree(),
            'price_per_seat' => $l->price_per_seat,
            'is_free' => $l->is_free,
        ];
    }

    /** The driver as a rider sees them (results, carpool page, driver profile 4c). */
    public function driver(CarpoolListing $l): array
    {
        $driver = $l->driver;
        $user = $driver?->user;
        $name = $this->name($user, 'Driver');

        return [
            'name' => $name,
            'first_name' => $this->firstName($name),
            'initials' => $this->initials($name),
            // Rider-to-driver ratings arrive with M6 (P11); until then the apps hide the line.
            'rating' => null,
            'rating_count' => 0,
            'carpools_driven' => $driver ? CarpoolListing::query()->where('driver_id', $driver->id)
                ->where('status', CarpoolListing::STATUS_COMPLETED)->where('counts_as_ride', true)->count() : 0,
            'since' => $driver?->approved_at ? CarpoolClock::local($driver->approved_at)->format('Y-m') : null,
        ];
    }

    /** @return array<string, mixed>|null */
    public function car(?CarpoolVehicle $v): ?array
    {
        if (! $v) {
            return null;
        }

        return [
            'label' => trim("{$v->colour} {$v->make} {$v->model}"),
            'make' => $v->make,
            'model' => $v->model,
            'colour' => $v->colour,
            'plate' => self::plate($v->plate),
            'seats' => $v->seats,
            'photo_url' => $v->front_photo_path ? Storage::disk('public')->url($v->front_photo_path) : null,
        ];
    }

    /** A rider as the driver sees them: name and initials, never the phone. */
    public function rider(?User $user): array
    {
        $name = $this->name($user, 'Rider');

        return [
            'id' => $user?->id,
            'name' => $name,
            'first_name' => $this->firstName($name),
            'initials' => $this->initials($name),
            'photo_url' => $user?->avatar_path
                ? (str_starts_with($user->avatar_path, 'http') ? $user->avatar_path : Storage::disk('public')->url($user->avatar_path))
                : null,
        ];
    }

    /** When the car reaches a point `$alongM` metres along the route, at the planned speed. */
    public function etaAt(CarpoolListing $l, RouteGeometry $geo, float $alongM): CarbonInterface
    {
        return $l->departs_at->copy()->addSeconds((int) round($l->duration_s * $geo->fraction($alongM)));
    }

    /**
     * A request as its rider sees it on the carpool page and in My trips.
     *
     * @return array<string, mixed>
     */
    public function riderRequest(CarpoolRequest $r, CarpoolListing $l, ?RouteGeometry $geo = null): array
    {
        $geo ??= RouteGeometry::of($l->route_polyline ?? []);
        $state = $this->riderState($r, $l);
        $showCode = $r->status === CarpoolRequest::STATUS_ACCEPTED && in_array($l->status, CarpoolListing::LIVE, true);

        return [
            'id' => $r->id,
            'listing_id' => $l->id,
            'status' => $r->status,
            'closed_reason' => $r->closed_reason,
            'state' => $state,
            'past' => ! in_array($state, ['sent', 'accepted', 'started'], true),
            'seats' => $r->seats,
            'price_per_seat' => $r->price_per_seat,
            'is_free' => $r->is_free,
            'total' => $r->total(),
            'code' => $showCode ? $r->code : null,
            'chat_id' => $this->chatId($r),
            'pickup' => [
                'lat' => $r->pickup_lat, 'lng' => $r->pickup_lng, 'name' => $r->pickup_name,
                'address' => $r->pickup_address, 'along_m' => $r->pickup_m,
                'at' => $this->etaAt($l, $geo, $r->pickup_m)->toIso8601String(),
            ],
            'drop' => [
                'lat' => $r->drop_lat, 'lng' => $r->drop_lng, 'name' => $r->drop_name,
                'address' => $r->drop_address, 'along_m' => $r->drop_m,
                'at' => $this->etaAt($l, $geo, $r->drop_m)->toIso8601String(),
            ],
            'created_at' => $r->created_at?->toIso8601String(),
        ];
    }

    /**
     * One word for how a request stands from the rider's side (customer
     * mockup 8, 8b to 8l): sent, accepted, started, completed, cancelled,
     * declined, removed, filled, ended, withdrawn, left, no_show.
     */
    public function riderState(CarpoolRequest $r, CarpoolListing $l): string
    {
        return match ($r->status) {
            CarpoolRequest::STATUS_PENDING => in_array($l->status, CarpoolListing::LIVE, true) ? 'sent' : 'ended',
            CarpoolRequest::STATUS_ACCEPTED => match ($l->status) {
                CarpoolListing::STATUS_IN_PROGRESS => 'started',
                CarpoolListing::STATUS_COMPLETED => 'completed',
                CarpoolListing::STATUS_CANCELLED => 'cancelled',
                default => 'accepted',
            },
            CarpoolRequest::STATUS_CLOSED => $r->closed_reason === CarpoolRequest::CLOSED_FILLED ? 'filled' : 'ended',
            CarpoolRequest::STATUS_CANCELLED_BY_RIDER => 'left',
            CarpoolRequest::STATUS_DECLINED, CarpoolRequest::STATUS_WITHDRAWN, CarpoolRequest::STATUS_REMOVED,
            CarpoolRequest::STATUS_NO_SHOW, CarpoolRequest::STATUS_COMPLETED => $r->status,
            default => $r->status,
        };
    }

    /**
     * A request as the driver sees it: Home card, Inbox, riders list.
     *
     * @return array<string, mixed>
     */
    public function driverRequest(CarpoolRequest $r, CarpoolListing $l, ?RouteGeometry $geo = null): array
    {
        $geo ??= RouteGeometry::of($l->route_polyline ?? []);

        return [
            'id' => $r->id,
            'listing_id' => $l->id,
            'status' => $r->status,
            'rider' => $this->rider($r->rider),
            'seats' => $r->seats,
            'price_per_seat' => $r->price_per_seat,
            'is_free' => $r->is_free,
            'total' => $r->total(),
            'paid_marked' => $r->paid_marked,
            'chat_id' => $this->chatId($r),
            'pickup' => ['name' => $r->pickup_name, 'address' => $r->pickup_address, 'lat' => $r->pickup_lat, 'lng' => $r->pickup_lng,
                'at' => $this->etaAt($l, $geo, $r->pickup_m)->toIso8601String()],
            'drop' => ['name' => $r->drop_name, 'address' => $r->drop_address, 'lat' => $r->drop_lat, 'lng' => $r->drop_lng,
                'at' => $this->etaAt($l, $geo, $r->drop_m)->toIso8601String()],
            'created_at' => $r->created_at?->toIso8601String(),
        ];
    }

    /** The private chat of this request (driver and rider only), once it exists. */
    private function chatId(CarpoolRequest $r): ?int
    {
        $id = \App\Models\Carpool\CarpoolConversation::query()->where('request_id', $r->id)->value('id');

        return $id ? (int) $id : null;
    }

    /** "Today, 8:30 AM" style label in India time, for notification text. */
    public function when(CarbonInterface $moment): string
    {
        $local = CarpoolClock::local($moment);
        $days = CarpoolClock::daysFromToday($moment);
        $day = match (true) {
            $days === 0 => 'Today',
            $days === 1 => 'Tomorrow',
            default => $local->format('D j M'),
        };

        return $day . ', ' . $local->format('g:i A');
    }

    /** "JK01AB4521" -> "JK01 AB 4521". Leaves unusual plates as they are. */
    public static function plate(?string $plate): ?string
    {
        if (! $plate) {
            return $plate;
        }
        if (preg_match('/^([A-Z]{2}\d{1,2})([A-Z]{0,3})(\d{1,4})$/', $plate, $m)) {
            return implode(' ', array_filter([$m[1], $m[2], $m[3]], fn ($s) => $s !== ''));
        }

        return $plate;
    }

    public function name(?User $user, string $fallback): string
    {
        $name = trim((string) ($user?->name ?? ''));

        return $name !== '' ? $name : $fallback;
    }

    public function firstName(string $name): string
    {
        return explode(' ', trim($name))[0] ?: $name;
    }

    public function initials(string $name): string
    {
        $parts = preg_split('/\s+/', trim($name)) ?: [];
        $letters = array_map(fn ($p) => mb_strtoupper(mb_substr($p, 0, 1)), array_slice(array_filter($parts), 0, 2));

        return implode('', $letters) ?: '?';
    }
}

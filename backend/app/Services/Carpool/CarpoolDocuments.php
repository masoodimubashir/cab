<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolDocumentOverride;
use App\Models\Carpool\CarpoolDocumentRenewal;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Document;
use App\Models\Driver;
use App\Models\DriverDocument;
use App\Services\NotificationCenter;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * S11 (D-07, D-12; S11-Risk-Review.md choices A1, B1, C, D). A carpool document whose catalog entry has a date
 * label named like "Expiry date" or "Valid till" (the same rule as the admin's Expired tag) limits the driver to
 * that India day, or to the admin's "allow until" when it is later. Documents without such a label, without a
 * value, or for commercial drivers set no limit. Nothing here changes the shared documents code; renewals wait
 * in their own table and only replace the approved copy when an admin approves them.
 */
class CarpoolDocuments
{
    public const LABEL_PATTERN = '/expir|valid\s*(till|until|upto)/i';

    /** The date label that holds the expiry for this catalog entry, or null. */
    public static function expiryLabel(Document $doc): ?string
    {
        foreach ($doc->labels ?? [] as $l) {
            if ($l->label_type === 'date' && preg_match(self::LABEL_PATTERN, (string) $l->label)) {
                return (string) $l->label;
            }
        }

        return null;
    }

    /**
     * One row per carpool document type that carries an expiry label.
     * expires_on and allow_until are India days (Y-m-d); valid_until is the later of the two, null = no limit.
     */
    public function items(Driver $driver): Collection
    {
        $docs = Document::query()->forDriverType('carpool')->with('labels')->orderBy('id')->get()
            ->filter(fn (Document $d) => self::expiryLabel($d) !== null);
        if ($docs->isEmpty()) {
            return collect();
        }
        $ids = $docs->pluck('id');
        $uploads = DriverDocument::query()->where('driver_id', $driver->id)->whereIn('document_id', $ids)
            ->orderBy('image_index')->get()->groupBy('document_id');
        $overrides = CarpoolDocumentOverride::query()->where('driver_id', $driver->id)->whereIn('document_id', $ids)->get()->keyBy('document_id');
        $renewals = CarpoolDocumentRenewal::query()->where('driver_id', $driver->id)->whereIn('document_id', $ids)
            ->orderByDesc('id')->get()->groupBy('document_id');

        return $docs->map(function (Document $doc) use ($uploads, $overrides, $renewals) {
            $label = self::expiryLabel($doc);
            $rows = $uploads->get($doc->id, collect());
            $approved = $rows->firstWhere('status', 'approved');
            $expires = null;
            foreach ($rows as $r) {
                $v = $r->label_values[$label] ?? null;
                if ($v && ($d = $this->day($v))) {
                    $expires = $d;
                    break;
                }
            }
            $override = $overrides->get($doc->id);
            $allow = $override?->allow_until?->toDateString();
            $valid = $expires && $allow ? max($expires, $allow) : ($expires ?? null);
            $renewal = $renewals->get($doc->id)?->first();

            return [
                'document_id' => $doc->id,
                'name' => $doc->name,
                'label' => $label,
                'uploaded' => $rows->isNotEmpty(),
                'approved' => (bool) $approved,
                'has_date' => $expires !== null,
                'expires_on' => $expires,
                'allow_until' => $allow,
                'allow_note' => $override?->note,
                'valid_until' => $valid,
                'expired' => $valid !== null && $valid < CarpoolClock::today(),
                'renewal' => $renewal && $renewal->status !== CarpoolDocumentRenewal::STATUS_APPROVED ? [
                    'id' => $renewal->id,
                    'status' => $renewal->status,
                    'expiry_date' => $renewal->expiry_date->toDateString(),
                    'reason' => $renewal->rejection_reason,
                    'sent_at' => $renewal->created_at?->toIso8601String(),
                ] : null,
            ];
        })->values();
    }

    /** The earliest last valid India day over the driver's dated documents, with the item that sets it. */
    public function limit(Driver $driver): ?array
    {
        return $this->items($driver)->filter(fn ($i) => $i['valid_until'] !== null)->sortBy('valid_until')->first();
    }

    /** What the driver app's Home shows (banner and renew link). */
    public function summary(Driver $driver): array
    {
        $items = $this->items($driver);
        $limit = $items->filter(fn ($i) => $i['valid_until'] !== null)->sortBy('valid_until')->first();
        $warnBy = CarpoolClock::now()->addDays(CarpoolSetting::number('document_warning_days'))->toDateString();
        $warn = $limit !== null && ! $limit['expired'] && $limit['valid_until'] <= $warnBy
            && ($limit['renewal']['status'] ?? null) !== CarpoolDocumentRenewal::STATUS_PENDING;

        return [
            'valid_until' => $limit['valid_until'] ?? null,
            'expired' => (bool) ($limit['expired'] ?? false),
            'warn' => $warn,
            'document_id' => $limit['document_id'] ?? null,
            'name' => $limit['name'] ?? null,
            'items' => $items->map(fn ($i) => collect($i)->only(['document_id', 'name', 'expires_on', 'valid_until', 'expired', 'renewal'])->all())->values(),
        ];
    }

    /** Publish check (D-07, B1): a departure after the last valid day is refused. */
    public function assertCovers(Driver $driver, CarbonImmutable $departs): void
    {
        $limit = $this->limit($driver);
        if (! $limit) {
            return;
        }
        $day = CarbonImmutable::parse($limit['valid_until'], CarpoolClock::timezone())->format('j M');
        if ($limit['expired']) {
            $this->fail("Your {$limit['name']} has expired. Renew it in the app to publish carpools.");
        }
        if (CarpoolClock::dateOf($departs) > $limit['valid_until']) {
            $this->fail("Your {$limit['name']} is valid until {$day}. Pick a day up to {$day}, or renew it first.");
        }
    }

    // ---- The driver ----

    public function submitRenewal(Driver $driver, Document $doc, UploadedFile $file, string $expiry): CarpoolDocumentRenewal
    {
        if (! in_array($doc->applies_to, ['carpool', 'all'], true) || ! self::expiryLabel($doc->loadMissing('labels'))) {
            abort(404);
        }
        if ($this->day($expiry) === null || $this->day($expiry) <= CarpoolClock::today()) {
            $this->fail('Enter the new expiry date. It must be after today.', 'expiry_date');
        }
        $path = $file->store('driver-documents', 'local');

        return DB::transaction(function () use ($driver, $doc, $path, $expiry) {
            // A newer copy replaces one still waiting; its file is removed.
            foreach (CarpoolDocumentRenewal::query()->where('driver_id', $driver->id)->where('document_id', $doc->id)
                ->where('status', CarpoolDocumentRenewal::STATUS_PENDING)->lockForUpdate()->get() as $old) {
                $this->deleteFile($old->file_path);
                $old->delete();
            }

            return CarpoolDocumentRenewal::query()->create([
                'driver_id' => $driver->id, 'document_id' => $doc->id, 'file_path' => $path,
                'expiry_date' => $this->day($expiry), 'status' => CarpoolDocumentRenewal::STATUS_PENDING,
            ]);
        });
    }

    // ---- The admin ----

    /** The renewal replaces the approved copy (photo and date); the driver's approval is not touched. */
    public function approve(CarpoolDocumentRenewal $renewal): void
    {
        $driver = $renewal->driver;
        $doc = $renewal->document()->with('labels')->first();
        DB::transaction(function () use ($renewal, $doc, $driver) {
            $r = CarpoolDocumentRenewal::query()->lockForUpdate()->find($renewal->id);
            if (! $r || $r->status !== CarpoolDocumentRenewal::STATUS_PENDING) {
                $this->fail('This renewal was already handled.', 'renewal');
            }
            $label = self::expiryLabel($doc);
            $row = DriverDocument::query()->where('driver_id', $driver->id)->where('document_id', $doc->id)->orderBy('image_index')->first();
            $before = $row ? ($row->label_values[$label] ?? null) : null;
            if ($row) {
                $this->deleteFile($row->file_path);
                $row->file_path = $r->file_path;
                $row->label_values = array_merge($row->label_values ?? [], [$label => $r->expiry_date->toDateString()]);
                $row->status = 'approved';
                $row->rejection_reason = null;
                $row->save();
            } else {
                DriverDocument::query()->create([
                    'driver_id' => $driver->id, 'document_id' => $doc->id, 'image_index' => 1, 'file_path' => $r->file_path,
                    'label_values' => [$label => $r->expiry_date->toDateString()], 'status' => 'approved',
                ]);
            }
            $r->status = CarpoolDocumentRenewal::STATUS_APPROVED;
            $r->reviewed_by = Auth::id();
            $r->reviewed_at = now();
            $r->save();
            CarpoolAdminLog::record('document_renewal_approve', 'driver', $driver->id, [
                'subject_user_id' => $driver->user_id,
                'before' => ['document' => $doc->name, 'expiry_date' => $before],
                'after' => ['document' => $doc->name, 'expiry_date' => $r->expiry_date->toDateString()],
            ]);
        });
        $this->tell($driver, 'carpool_document_approved', "Your new {$doc->name} is approved",
            'It is valid until ' . $renewal->fresh()->expiry_date->format('j M Y') . '. You can publish carpools up to that day.');
    }

    public function reject(CarpoolDocumentRenewal $renewal, string $reason): void
    {
        $driver = $renewal->driver;
        $doc = $renewal->document;
        DB::transaction(function () use ($renewal, $reason, $driver, $doc) {
            $r = CarpoolDocumentRenewal::query()->lockForUpdate()->find($renewal->id);
            if (! $r || $r->status !== CarpoolDocumentRenewal::STATUS_PENDING) {
                $this->fail('This renewal was already handled.', 'renewal');
            }
            $this->deleteFile($r->file_path);
            $r->status = CarpoolDocumentRenewal::STATUS_REJECTED;
            $r->rejection_reason = $reason;
            $r->reviewed_by = Auth::id();
            $r->reviewed_at = now();
            $r->save();
            CarpoolAdminLog::record('document_renewal_reject', 'driver', $driver->id, [
                'subject_user_id' => $driver->user_id, 'note' => $reason, 'after' => ['document' => $doc->name],
            ]);
        });
        $this->tell($driver, 'carpool_document_rejected', "Your new {$doc->name} was not accepted",
            $reason . '. Please send it again from the app.');
    }

    /**
     * Correct the date on the driver's copy (the admin saw the paper), or, with a photo, upload a new copy on the
     * driver's behalf: it replaces the stored copy at once as approved, replaces any renewal the driver was waiting
     * on, and the driver's sign-up stays approved (unlike the shared "Upload on behalf" on the driver page).
     */
    public function setExpiry(Driver $driver, Document $doc, string $date, string $note, ?UploadedFile $file = null): void
    {
        $label = self::expiryLabel($doc->loadMissing('labels'));
        if (! $label || ! in_array($doc->applies_to, ['carpool', 'all'], true)) {
            abort(404);
        }
        $row = DriverDocument::query()->where('driver_id', $driver->id)->where('document_id', $doc->id)->orderBy('image_index')->first();
        if (! $row && ! $file) {
            $this->fail('This driver has no copy of this document to date. Upload one on their behalf, or ask them to renew it in the app.', 'document');
        }
        $before = $row ? ($row->label_values[$label] ?? null) : null;
        $path = $file?->store('driver-documents', 'local');

        DB::transaction(function () use ($driver, $doc, $label, $date, $path, &$row) {
            if (! $row) {
                $row = new DriverDocument(['driver_id' => $driver->id, 'document_id' => $doc->id, 'image_index' => 1]);
            }
            if ($path) {
                $this->deleteFile($row->file_path);
                $row->file_path = $path;
                $row->status = 'approved';
                $row->rejection_reason = null;
                foreach (CarpoolDocumentRenewal::query()->where('driver_id', $driver->id)->where('document_id', $doc->id)
                    ->where('status', CarpoolDocumentRenewal::STATUS_PENDING)->lockForUpdate()->get() as $old) {
                    $this->deleteFile($old->file_path);
                    $old->delete();
                }
            }
            $row->label_values = array_merge($row->label_values ?? [], [$label => $this->day($date)]);
            $row->save();
        });

        CarpoolAdminLog::record($path ? 'document_upload' : 'document_expiry', 'driver', $driver->id, [
            'subject_user_id' => $driver->user_id, 'note' => $note,
            'before' => ['document' => $doc->name, 'expiry_date' => $before], 'after' => ['document' => $doc->name, 'expiry_date' => $this->day($date)],
        ]);
        if ($path) {
            $this->tell($driver, 'carpool_document_approved', "Your new {$doc->name} is on file",
                'Dream Cabs added it for you. It is valid until ' . CarbonImmutable::parse($this->day($date), CarpoolClock::timezone())->format('j M Y') . '.');
        }
    }

    /** Let the driver keep going until a day, or clear that (null). */
    public function allowUntil(Driver $driver, Document $doc, ?string $date, string $note): void
    {
        $old = CarpoolDocumentOverride::query()->where('driver_id', $driver->id)->where('document_id', $doc->id)->first();
        if ($date === null) {
            $old?->delete();
        } else {
            CarpoolDocumentOverride::query()->updateOrCreate(
                ['driver_id' => $driver->id, 'document_id' => $doc->id],
                ['allow_until' => $this->day($date), 'note' => $note, 'admin_id' => Auth::id()],
            );
        }
        CarpoolAdminLog::record('document_allow', 'driver', $driver->id, [
            'subject_user_id' => $driver->user_id, 'note' => $note,
            'before' => ['document' => $doc->name, 'allow_until' => $old?->allow_until?->toDateString()],
            'after' => ['document' => $doc->name, 'allow_until' => $date === null ? null : $this->day($date)],
        ]);
    }

    // ---- Jobs (run by carpool:lifecycle) ----

    /**
     * B1: once a driver's last valid day is over, their published carpools departing after it are cancelled.
     * Carpools on the road and carpools up to that day are left alone. Returns driver id => last valid day.
     */
    public function overdueDrivers(): Collection
    {
        $out = collect();
        $driverIds = \App\Models\Carpool\CarpoolListing::query()->where('status', \App\Models\Carpool\CarpoolListing::STATUS_PUBLISHED)
            ->distinct()->pluck('driver_id');
        foreach (Driver::query()->whereIn('id', $driverIds)->get() as $driver) {
            $limit = $this->limit($driver);
            if ($limit && $limit['valid_until'] < CarpoolClock::today()) {
                $out[$driver->id] = $limit;
            }
        }

        return $out;
    }

    /** D: one push per document and date, document_warning_days before the last valid day; none while a renewal waits. */
    public function warnExpiring(): int
    {
        $sent = 0;
        $warnBy = CarpoolClock::now()->addDays(CarpoolSetting::number('document_warning_days'))->toDateString();
        $drivers = Driver::query()->where('driver_type', 'carpool')->where('approval_status', 'approved')->whereNull('deactivated_at')->get();
        foreach ($drivers as $driver) {
            foreach ($this->items($driver) as $i) {
                if ($i['valid_until'] === null || $i['expired'] || $i['valid_until'] > $warnBy
                    || ($i['renewal']['status'] ?? null) === CarpoolDocumentRenewal::STATUS_PENDING) {
                    continue;
                }
                if (! Cache::add("carpool:doc-warn:{$driver->id}:{$i['document_id']}:{$i['valid_until']}", 1, now()->addDays(60))) {
                    continue;
                }
                $day = CarbonImmutable::parse($i['valid_until'], CarpoolClock::timezone())->format('j M');
                $this->tell($driver, 'carpool_document_expiring', "Your {$i['name']} ends on {$day}",
                    "Renew it in the app so you can keep publishing carpools after {$day}.");
                $sent++;
            }
        }

        return $sent;
    }

    /** Account deletion (W8): renewal photos are personal data. */
    public function forget(Driver $driver): void
    {
        foreach (CarpoolDocumentRenewal::query()->where('driver_id', $driver->id)->get() as $r) {
            $this->deleteFile($r->file_path);
            $r->delete();
        }
        CarpoolDocumentOverride::query()->where('driver_id', $driver->id)->delete();
    }

    private function tell(Driver $driver, string $type, string $title, string $body): void
    {
        try {
            app(NotificationCenter::class)->notifyUserId($driver->user_id, $type, $title, $body, ['link' => '/carpool/documents']);
        } catch (\Throwable $e) {
            Log::warning('Carpool document notification failed', ['type' => $type, 'driver_id' => $driver->id, 'error' => $e->getMessage()]);
        }
    }

    private function day(string $value): ?string
    {
        try {
            return CarbonImmutable::parse($value, CarpoolClock::timezone())->toDateString();
        } catch (\Throwable) {
            return null;
        }
    }

    private function deleteFile(?string $path): void
    {
        if ($path && str_starts_with($path, 'driver-documents/') && Storage::disk('local')->exists($path)) {
            Storage::disk('local')->delete($path);
        }
    }

    private function fail(string $message, string $field = 'departs_at'): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}

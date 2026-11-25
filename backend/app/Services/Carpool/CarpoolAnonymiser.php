<?php

namespace App\Services\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\Driver;
use App\Models\DriverDocument;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Deleting a person who has carpool records (W8, B-01, decision D-26).
 *
 * A person with no carpool records is deleted exactly as before. A person with carpool records is
 * anonymised instead: the account row stays as "Deleted user" so carpools, bookings, ratings,
 * reports, chats and the plan purchase keep a person to point at; everything personal is removed;
 * and every other account-owned row goes, as a normal delete would have removed it (the same
 * foreign-key list, read from the database, so a new table is covered automatically).
 * Carpool tables and a carpool driver's plan purchases are the only things kept.
 */
class CarpoolAnonymiser
{
    public const NAME = 'Deleted user';

    /** Tables whose rows stay for a person with carpool records. */
    private const KEEP_PREFIX = 'carpool_';

    /** Does this person appear in any carpool record? */
    public function hasFootprint(User $user): bool
    {
        return Driver::query()->where('user_id', $user->id)->carpool()->exists()
            || $user->carpool_banned_at !== null
            || DB::table('carpool_requests')->where('rider_id', $user->id)->exists()
            || DB::table('carpool_reports')->where('reporter_id', $user->id)->orWhere('reported_user_id', $user->id)->exists()
            || DB::table('carpool_ratings')->where('rater_id', $user->id)->orWhere('rated_id', $user->id)->exists()
            || DB::table('carpool_conversation_members')->where('user_id', $user->id)->exists();
    }

    /**
     * The one call every delete path makes instead of deleting the user row.
     * Returns true when the person was anonymised, false when they were really deleted.
     */
    public function retire(User $user, string $reason, ?User $by = null): bool
    {
        if (! $this->hasFootprint($user)) {
            $user->delete();

            return false;
        }
        if ($user->deleted_at !== null && $user->name === self::NAME) {
            return true; // already anonymised
        }
        $this->anonymise($user, $reason, $by);

        return true;
    }

    private function anonymise(User $user, string $reason, ?User $by): void
    {
        $driver = Driver::query()->where('user_id', $user->id)->carpool()->first();
        $wasBanned = $user->carpool_banned_at !== null;
        $phone = $user->phone;

        // Upcoming carpools end and riders are told, as with a pause or an admin delete.
        app(CarpoolAdminService::class)->closeOpenCarpoolsOf($user);

        DB::transaction(function () use ($user, $driver, $reason, $by, $wasBanned, $phone) {
            if ($wasBanned && $phone) {
                CarpoolAccess::rememberNumber($user);
            }
            if ($driver) {
                $this->scrubCarpoolDriver($driver);
            }
            $this->sweepAccountRows($user, $driver !== null);
            $this->scrubUser($user, $reason);

            CarpoolAnonymiseLog::record($user, $by, $reason, $driver?->id);
        });
    }

    /** A carpool driver's documents, car photos, plate and personal vehicle fields. The driver row stays, deactivated. */
    private function scrubCarpoolDriver(Driver $driver): void
    {
        foreach (DriverDocument::query()->where('driver_id', $driver->id)->get() as $doc) {
            $this->deleteFile('local', $doc->file_path, 'driver-documents/');
            $doc->delete();
        }
        $car = CarpoolVehicle::query()->where('driver_id', $driver->id)->first();
        if ($car) {
            foreach ([$car->front_photo_path, $car->interior_photo_path] as $path) {
                $this->deleteFile('public', $path, null);
            }
            $car->front_photo_path = null;
            $car->interior_photo_path = null;
            $car->plate = 'DELETED' . $car->id; // frees the plate for another driver
            $car->save();
        }
        CarpoolListing::query()->where('driver_id', $driver->id)->update(['car_plate' => null]);
        $driver->forceFill([
            'vehicle_reg_no' => null, 'vehicle_brand' => null, 'vehicle_model' => null, 'vehicle_color' => null,
            'deactivated_at' => $driver->deactivated_at ?? now(), 'is_online' => false,
        ])->save();
    }

    /** Everything a normal delete would remove through foreign keys, except carpool records and a carpool driver's rows. */
    private function sweepAccountRows(User $user, bool $keepDriverRows): void
    {
        $rows = DB::select(
            'select k.table_name as t, k.column_name as c from information_schema.key_column_usage k '
            . 'join information_schema.referential_constraints rc on rc.constraint_name = k.constraint_name and rc.constraint_schema = k.table_schema '
            . "where k.table_schema = database() and k.referenced_table_name = 'users' and k.referenced_column_name = 'id' and rc.delete_rule = 'CASCADE'"
        );
        foreach ($rows as $r) {
            $table = $r->t;
            if (str_starts_with($table, self::KEEP_PREFIX)) {
                continue;
            }
            if ($keepDriverRows && in_array($table, ['drivers', 'driver_subscriptions'], true)) {
                continue;
            }
            DB::table($table)->where($r->c, $user->id)->delete();
        }
        if ($user->phone) {
            DB::table('phone_otps')->where('phone', $user->phone)->delete();
        }
        DB::table('sessions')->where('user_id', $user->id)->delete();
    }

    private function scrubUser(User $user, string $reason): void
    {
        $this->deleteFile('public', $user->avatar_path, 'avatars/');
        $user->tokens()->delete();
        $user->forceFill([
            'name' => self::NAME, 'email' => null, 'email_verified_at' => null, 'phone' => null, 'google_sub' => null,
            'avatar_path' => null, 'dob' => null, 'address' => null, 'remember_token' => null,
            'current_lat' => null, 'current_lng' => null, 'current_location_updated_at' => null,
            'app_version' => null, 'os_version' => null, 'device_type' => null, 'referral_code' => null,
            'accepted_payment_methods' => null, 'razorpay_linked_account_id' => null, 'razorpay_route_product_id' => null,
            'payout_pan' => null, 'payout_beneficiary_name' => null, 'payout_account_number' => null, 'payout_ifsc' => null,
            'payout_upi' => null, 'payout_bank_last4' => null, 'payout_method' => null,
            'password' => Hash::make(Str::random(48)),
            'is_suspended' => true, 'suspended_reason' => $user->suspended_reason ?: mb_substr($reason, 0, 255),
            'suspended_at' => $user->suspended_at ?? now(), 'deleted_at' => now(),
        ])->save();
    }

    /** Only paths inside our own upload folders are touched, like AccountController does. */
    private function deleteFile(string $disk, ?string $path, ?string $prefix): void
    {
        if (! $path || filter_var($path, FILTER_VALIDATE_URL) || str_contains($path, '..') || str_contains($path, '\\')) {
            return;
        }
        if ($prefix !== null && ! str_starts_with($path, $prefix)) {
            return;
        }
        try {
            Storage::disk($disk)->delete($path);
        } catch (\Throwable) {
            // A missing or locked file must not stop the anonymising; the row no longer points at it.
        }
    }

    /** One-way hash of the last 10 digits, so +91 and plain numbers match. The number itself is never stored. */
    public static function phoneHash(string $phone): string
    {
        $digits = preg_replace('/\D/', '', $phone);

        return hash('sha256', substr($digits, -10));
    }
}

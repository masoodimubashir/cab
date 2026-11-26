<?php

namespace App\Services\Dev;

use App\Models\Carpool\CarpoolBannedWord;
use App\Models\Carpool\CarpoolConversation;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\DriverSubscription;
use App\Models\User;

/**
 * Scenarios for the developer hub. Each one builds data around the signed-in
 * person (a rider or a carpool driver) so a particular screen can be reached.
 * Other people in the story are the demo driver Asif and the demo riders Bilal and Sana.
 */
class DevScenarios
{
    public function __construct(private DevHub $h)
    {
    }

    /** @return array<string, array{role: string, label: string, hint: string}> */
    public function catalogue(): array
    {
        $out = [];
        foreach ($this->defs() as $key => [$role, $label, $hint]) {
            $out[] = ['key' => $key, 'role' => $role, 'label' => $label, 'hint' => $hint];
        }

        return $out;
    }

    private function defs(): array
    {
        return [
            // ---- rider ----
            'r-search' => ['customer', 'Carpools to search', 'Three carpools by Asif: in 3 hours, tomorrow, and a free one'],
            'r-waiting' => ['customer', 'My request is waiting', 'Pending request, driver has not answered'],
            'r-accepted' => ['customer', 'Accepted with my code', 'Leaves in 3 hours; shows the 4-digit code and the chats'],
            'r-soon' => ['customer', 'Leaving in 25 minutes', 'Accepted; the "leaving soon" state'],
            'r-onroad-waiting' => ['customer', 'Driver left, my request still waiting', 'On the road, request unanswered'],
            'r-onroad' => ['customer', 'On the road, not picked up yet', 'Accepted, ride started'],
            'r-picked' => ['customer', 'In the car', 'Picked up'],
            'r-rate' => ['customer', 'Finished ride, rate the driver', 'Completed; rating sheet and Past page'],
            'r-declined' => ['customer', 'Driver declined me', 'Declined request'],
            'r-removed' => ['customer', 'Driver removed me', 'Removed after accepting'],
            'r-full' => ['customer', 'A full carpool in search', 'Shows "Full" in the results'],
            'r-cancel-driver' => ['customer', 'Driver cancelled my carpool', 'Cancelled by driver'],
            'r-cancel-admin' => ['customer', 'Dream Cabs cancelled my carpool', 'Cancelled by admin'],
            'r-overlap' => ['customer', 'Two carpools at the same time', 'Accepted at 3 h, another at 3 h to try the warning'],
            'r-chat-masked' => ['customer', 'Chat with a hidden word and a report', 'Banned word masked; an open report'],
            'r-chat-deleted' => ['customer', 'Past ride, chat deleted', 'Shows "This chat was deleted"'],
            // ---- driver ----
            'd-published' => ['driver', 'Two published carpools', 'Home, Carpools tab, Upcoming'],
            'd-requests' => ['driver', 'Waiting requests and a rider in', '2 waiting and 1 accepted'],
            'd-start' => ['driver', 'Ready to start in 20 minutes', 'Start ride button, accepted rider and a waiting one'],
            'd-onroad' => ['driver', 'On the road with riders', 'One rider picked up, one not, one waiting'],
            'd-finished' => ['driver', 'Finished carpool', 'Completed with ratings'],
            'd-cancelled' => ['driver', 'A carpool I cancelled', 'Past tab, cancelled'],
            'd-full' => ['driver', 'A full carpool', 'All seats taken'],
            'd-plan-ended' => ['driver', 'My plan has ended', 'Plan expired 3 days ago'],
            'd-report' => ['driver', 'A rider reported me', 'Open report on me'],
            // ---- driver sign-up status and Plans (screens 1f to 1i) ----
            'd-docs-sent' => ['driver', 'Documents sent, being checked', 'Status page: "We are checking your sign-up"'],
            'd-docs-fix' => ['driver', 'Documents to fix', 'One rejected (blurry photo), one not sent'],
            'd-approve-me' => ['driver', 'Approve me', 'All documents approved; the approved page shows once'],
            'd-no-plan' => ['driver', 'No plan', 'Plans page: "Pick a plan"'],
            'd-plan-30' => ['driver', 'Plan with 30 days left', 'Plans page: ring, active'],
            'd-plan-ending' => ['driver', 'Plan ends in 2 days', 'Plans page: amber, ending soon'],
            'd-plan-waiting' => ['driver', 'Next plan waiting', 'Plans page: nothing to buy'],
        ];
    }

    public function run(string $key, User $me): string
    {
        abort_unless(isset($this->defs()[$key]), 422, 'Unknown scenario.');
        $this->h->bootstrap();
        CarpoolSetting::current()->update(['enabled' => true]);
        $asif = $this->h->demo('asif');
        $bilal = $this->h->demo('bilal');
        $sana = $this->h->demo('sana');
        $nida = User::query()->where('email', 'demo-carpool-approved-2@dreamcabs.test')->first();
        $this->ready($asif);

        return match ($key) {
            'r-search' => $this->rSearch($asif),
            'r-waiting' => $this->msg($this->h->request($this->h->listing($asif, 180), $me, 'pending'), 'A waiting request'),
            'r-accepted' => $this->rAccepted($asif, $me, 180, $bilal),
            'r-soon' => $this->rAccepted($asif, $me, 25, $bilal),
            'r-onroad-waiting' => $this->rOnRoad($asif, $me, 'pending'),
            'r-onroad' => $this->rOnRoad($asif, $me, 'accepted'),
            'r-picked' => $this->rOnRoad($asif, $me, 'picked'),
            'r-rate' => $this->rFinished($asif, $me, $bilal),
            'r-declined' => $this->msg($this->h->request($this->h->listing($asif, 200), $me, CarpoolRequest::STATUS_DECLINED), 'A declined request'),
            'r-removed' => $this->msg($this->h->request($this->h->listing($asif, 200), $me, CarpoolRequest::STATUS_REMOVED, ['ended_at' => now()]), 'A removed rider'),
            'r-full' => $this->rFull($asif, $bilal, $sana),
            'r-cancel-driver' => $this->rCancelled($asif, $me, CarpoolListing::CANCEL_DRIVER),
            'r-cancel-admin' => $this->rCancelled($asif, $me, CarpoolListing::CANCEL_ADMIN),
            'r-overlap' => $this->rOverlap($asif, $me, $nida),
            'r-chat-masked' => $this->rMasked($asif, $me),
            'r-chat-deleted' => $this->rChatDeleted($asif, $me),
            'd-published' => $this->dPublished($me),
            'd-requests' => $this->dRequests($me, $bilal, $sana),
            'd-start' => $this->dStart($me, $bilal, $sana),
            'd-onroad' => $this->dOnRoad($me, $bilal, $sana),
            'd-docs-sent' => $this->signupState($me, 'pending', 'sent'),
            'd-docs-fix' => $this->signupState($me, 'pending', 'fix'),
            'd-approve-me' => $this->signupState($me, 'approved', 'approved'),
            'd-no-plan' => $this->planState($me, 'none'),
            'd-plan-30' => $this->planState($me, '30'),
            'd-plan-ending' => $this->planState($me, 'ending'),
            'd-plan-waiting' => $this->planState($me, 'waiting'),
            'd-finished' => $this->dFinished($me, $bilal, $sana),
            'd-cancelled' => $this->dCancelled($me),
            'd-full' => $this->dFull($me, $bilal, $sana),
            'd-plan-ended' => $this->dPlanEnded($me),
            'd-report' => $this->dReport($me, $bilal),
        };
    }

    // ---- helpers ----

    private function ready(User $driver): void
    {
        if (! app(\App\Services\Carpool\CarpoolPlanService::class)->activePlan($driver)) {
            $this->h->plan($driver, 30);
        }
    }

    private function msg(CarpoolRequest $r, string $what): string
    {
        return "{$what} on carpool #{$r->listing_id}.";
    }

    private function started(CarpoolListing $l, int $minutesAgo): CarpoolListing
    {
        $l->status = CarpoolListing::STATUS_IN_PROGRESS;
        $l->started_at = now()->subMinutes($minutesAgo);
        $l->departs_at = now()->subMinutes($minutesAgo);
        $l->save();

        return $l;
    }

    // ---- rider ----

    private function rSearch(User $asif): string
    {
        $this->h->listing($asif, 180);
        $this->h->listing($asif, 24 * 60 + 60, ['price_per_seat' => 80]);
        $this->h->listing($asif, 300, ['is_free' => true, 'price_per_seat' => 0]);

        return 'Three carpools by Asif are published. Search Bemina Bypass to Kashmir University.';
    }

    private function rAccepted(User $asif, User $me, int $minutes, User $other): string
    {
        $l = $this->h->listing($asif, $minutes);
        $this->h->request($l, $other, CarpoolRequest::STATUS_ACCEPTED, ['pickup_m' => 2500]);
        $r = $this->h->request($l, $me, CarpoolRequest::STATUS_ACCEPTED);

        return "Accepted on carpool #{$l->id}. Your code is {$r->code}.";
    }

    private function rOnRoad(User $asif, User $me, string $state): string
    {
        $l = $this->started($this->h->listing($asif, -10), 10);
        $status = $state === 'pending' ? 'pending' : CarpoolRequest::STATUS_ACCEPTED;
        $r = $this->h->request($l, $me, $status);
        if ($state === 'picked') {
            $r->forceFill(['picked_up_at' => now()->subMinutes(3), 'code_verified_at' => now()->subMinutes(3)])->save();
        }

        return 'The ride is on the road (' . $state . ') on carpool #' . $l->id . '.';
    }

    private function rFinished(User $asif, User $me, User $other): string
    {
        $l = $this->h->listing($asif, -120, ['status' => CarpoolListing::STATUS_COMPLETED, 'started_at' => now()->subMinutes(110), 'completed_at' => now()->subMinutes(70)]);
        foreach ([$me, $other] as $u) {
            $r = $this->h->request($l, $u, CarpoolRequest::STATUS_COMPLETED);
            $r->forceFill(['picked_up_at' => now()->subMinutes(100), 'dropped_at' => now()->subMinutes(75)])->save();
        }

        return "A finished ride (#{$l->id}). Open My trips, Past, and rate Asif.";
    }

    private function rFull(User $asif, User $a, User $b): string
    {
        $l = $this->h->listing($asif, 200, ['seats_total' => 2]);
        $this->h->request($l, $a, CarpoolRequest::STATUS_ACCEPTED);
        $this->h->request($l, $b, CarpoolRequest::STATUS_ACCEPTED);

        return "Carpool #{$l->id} is full. It shows as Full in search.";
    }

    private function rCancelled(User $asif, User $me, string $reason): string
    {
        $l = $this->h->listing($asif, 240, ['status' => CarpoolListing::STATUS_CANCELLED, 'cancel_reason' => $reason, 'accepting_requests' => false]);
        $this->h->request($l, $me, CarpoolRequest::STATUS_CLOSED, ['closed_reason' => 'ended', 'ended_at' => now()]);

        return "Carpool #{$l->id} was cancelled ({$reason}). Check My trips, Past.";
    }

    private function rOverlap(User $asif, User $me, ?User $nida): string
    {
        $first = $this->h->listing($asif, 180);
        $this->h->request($first, $me, CarpoolRequest::STATUS_ACCEPTED);
        $other = $nida ?: $asif;
        $this->ready($other);
        $second = $this->h->listing($other, 185);

        return "You are in #{$first->id}. Open #{$second->id} (same time) and ask to join to see the warning.";
    }

    private function rMasked(User $asif, User $me): string
    {
        CarpoolBannedWord::query()->firstOrCreate(['word' => 'idiot'], ['active' => true]);
        $l = $this->h->listing($asif, 180);
        $r = $this->h->request($l, $me, CarpoolRequest::STATUS_ACCEPTED);
        $direct = CarpoolConversation::query()->where('request_id', $r->id)->where('kind', 'direct')->first();
        if ($direct) {
            $this->h->say($asif, $direct, 'You are late, idiot');
            $this->h->say($me, $direct, 'Sorry, on my way');
            $msg = \App\Models\Carpool\CarpoolMessage::query()->where('conversation_id', $direct->id)->where('sender_id', $asif->id)->latest('id')->first();
            if ($msg) {
                CarpoolReport::query()->create([
                    'reporter_id' => $me->id, 'reported_user_id' => $asif->id, 'message_id' => $msg->id,
                    'message_text' => $msg->body, 'original_text' => $msg->original_body, 'listing_id' => $l->id, 'reason' => 'harassment',
                ]);
            }
        }

        return "Chat on #{$l->id} has a hidden word, and an open report is in admin Carpool > Reports.";
    }

    private function rChatDeleted(User $asif, User $me): string
    {
        $l = $this->h->listing($asif, -60 * 30, ['status' => CarpoolListing::STATUS_COMPLETED, 'started_at' => now()->subHours(29), 'completed_at' => now()->subHours(28)]);
        $r = $this->h->request($l, $me, CarpoolRequest::STATUS_COMPLETED);
        $r->forceFill(['picked_up_at' => now()->subHours(29), 'dropped_at' => now()->subHours(28)])->save();
        $l->forceFill(['chats_deleted_at' => now()->subHours(3)])->save();

        return "A past ride (#{$l->id}) whose chat was deleted.";
    }

    // ---- driver ----

    private function dPublished(User $me): string
    {
        $this->h->listing($me, 180);
        $this->h->listing($me, 24 * 60 + 90, ['price_per_seat' => 90]);

        return 'Two carpools are published for you.';
    }

    private function dRequests(User $me, User $a, User $b): string
    {
        $l = $this->h->listing($me, 180);
        $this->h->request($l, $a, CarpoolRequest::STATUS_ACCEPTED);
        $this->h->request($l, $b, 'pending', ['pickup_m' => 3000]);
        $c = User::query()->where('email', 'demo-carpool-approved-2@dreamcabs.test')->first();
        if ($c) {
            $this->h->request($l, $c, 'pending', ['pickup_m' => 4200]);
        }

        return "Carpool #{$l->id} has waiting requests and a rider in. Open Inbox.";
    }

    private function dStart(User $me, User $a, User $b): string
    {
        $l = $this->h->listing($me, 20);
        $this->h->request($l, $a, CarpoolRequest::STATUS_ACCEPTED);
        $this->h->request($l, $b, 'pending');

        return "Carpool #{$l->id} leaves in 20 minutes. Start ride is open.";
    }

    private function dOnRoad(User $me, User $a, User $b): string
    {
        $l = $this->started($this->h->listing($me, -12), 12);
        $r1 = $this->h->request($l, $a, CarpoolRequest::STATUS_ACCEPTED);
        $r1->forceFill(['picked_up_at' => now()->subMinutes(5), 'code_verified_at' => now()->subMinutes(5)])->save();
        $this->h->request($l, $b, CarpoolRequest::STATUS_ACCEPTED, ['pickup_m' => 4500]);
        $c = User::query()->where('email', 'demo-carpool-approved-2@dreamcabs.test')->first();
        if ($c) {
            $this->h->request($l, $c, 'pending', ['pickup_m' => 500]);
        }

        return "Carpool #{$l->id} is on the road: one picked up, one waiting at a stop, one request waiting.";
    }

    private function dFinished(User $me, User $a, User $b): string
    {
        $l = $this->h->listing($me, -180, ['status' => CarpoolListing::STATUS_COMPLETED, 'started_at' => now()->subMinutes(170), 'completed_at' => now()->subMinutes(120)]);
        foreach ([$a, $b] as $u) {
            $r = $this->h->request($l, $u, CarpoolRequest::STATUS_COMPLETED);
            $r->forceFill(['picked_up_at' => now()->subMinutes(160), 'dropped_at' => now()->subMinutes(125)])->save();
        }
        (new \App\Models\Carpool\CarpoolRating())->forceFill([
            'listing_id' => $l->id, 'rater_id' => $a->id, 'rated_id' => $me->id, 'score' => 5, 'comment' => 'Smooth ride, on time.',
        ])->save();

        return "A finished carpool (#{$l->id}) with a rating. Open Carpools, Past.";
    }

    private function dCancelled(User $me): string
    {
        $l = $this->h->listing($me, 240, ['status' => CarpoolListing::STATUS_CANCELLED, 'cancel_reason' => CarpoolListing::CANCEL_DRIVER, 'accepting_requests' => false]);

        return "Carpool #{$l->id} is cancelled. Open Carpools, Past.";
    }

    private function dFull(User $me, User $a, User $b): string
    {
        $l = $this->h->listing($me, 200, ['seats_total' => 2]);
        $this->h->request($l, $a, CarpoolRequest::STATUS_ACCEPTED);
        $this->h->request($l, $b, CarpoolRequest::STATUS_ACCEPTED);

        return "Carpool #{$l->id} is full.";
    }

    private function dPlanEnded(User $me): string
    {
        DriverSubscription::query()->where('driver_user_id', $me->id)->update(['expires_at' => now()->subDays(3), 'status' => 'expired']);

        return 'Your plan ended 3 days ago. Run the jobs, then open Home.';
    }

    private function signupState(User $me, string $approval, string $docs): string
    {
        $driver = \App\Models\Driver::query()->where('user_id', $me->id)->firstOrFail();
        $driver->forceFill(['approval_status' => $approval, 'approved_at' => $approval === 'approved' ? now() : null])->save();
        $this->h->documents($driver, $docs);

        return match ($docs) {
            'sent' => 'Documents sent and waiting to be checked.',
            'fix' => 'One document rejected (blurry photo) and one not sent.',
            default => 'Approved, with every document approved. The approved page shows once.',
        };
    }

    private function planState(User $me, string $state): string
    {
        DriverSubscription::query()->where('driver_user_id', $me->id)->delete();
        if ($state === 'none') {
            return 'No plan now.';
        }
        $this->h->plan($me, $state === 'ending' ? 2 : 30);
        if ($state === 'waiting') {
            $this->h->plan($me, 2);
            $running = DriverSubscription::query()->where('driver_user_id', $me->id)->firstOrFail();
            $next = $running->replicate();
            $next->forceFill(['starts_at' => $running->expires_at, 'expires_at' => $running->expires_at->copy()->addDays(30), 'days_count' => 30, 'is_queued' => true])->save();

            return 'Plan ends in 2 days and the next one is already paid.';
        }

        return $state === 'ending' ? 'Plan ends in 2 days.' : 'Plan with 30 days left.';
    }

    private function dReport(User $me, User $rider): string
    {
        $l = $this->h->listing($me, 180);
        $this->h->request($l, $rider, CarpoolRequest::STATUS_ACCEPTED);
        CarpoolReport::query()->create(['reporter_id' => $rider->id, 'reported_user_id' => $me->id, 'listing_id' => $l->id, 'reason' => 'unsafe', 'details' => 'Dev hub report.']);

        return 'An open report against you is in admin Carpool > Reports.';
    }
}

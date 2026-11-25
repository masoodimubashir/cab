import { AfterViewChecked, AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolChatConversation, CarpoolChatMessage, CarpoolReportReason } from '../carpool.models';

/** Reasons as drawn on the mockup sheets (driver 8e, rider 7c). */
const PERSON_REASONS: { key: CarpoolReportReason; label: string }[] = [
  { key: 'unsafe', label: 'Unsafe or aggressive behaviour' },
  { key: 'harassment', label: 'Harassment or abusive messages' },
  { key: 'photo', label: "Doesn't match the profile photo" },
  { key: 'other', label: 'Something else' },
];
const MESSAGE_REASONS: { key: CarpoolReportReason; label: string }[] = [
  { key: 'spam', label: 'Spam or selling' },
  { key: 'harassment', label: 'Abusive or harassing' },
  { key: 'unsafe', label: 'Unsafe or threatening' },
  { key: 'other', label: 'Something else' },
];

/** The reasons the server offers for this kind of report, or none (then the built-in list stays). */
function reasonsFor(all: { key: string; label: string; applies_to: string }[] | undefined, context: 'person' | 'message'): { key: CarpoolReportReason; label: string }[] {
  return (all ?? []).filter((r) => r.applies_to === 'both' || r.applies_to === context).map((r) => ({ key: r.key, label: r.label }));
}

/** Gap above and below the floating trip card, and the room the thread keeps free under the pill. */
const TRIP_GAP = 10;
const PILL_SPACE = 64;
/** Rider states in which the trip is over or never happened: the pill then shows the state, not the stops. */
const ENDED_STATES = ['cancelled', 'declined', 'removed', 'filled', 'ended', 'no_show', 'withdrawn', 'left'];

type TripMode = 'docked' | 'compact' | 'peek';
type StatusKind = 'live' | 'ok' | 'sent' | 'cancel' | 'done';

/**
 * A carpool chat, group or private (driver mockups 7, 7b; rider 4, 6b, 6c, 7c;
 * header and trip card: Saqib's v4 preview, 2026-11-20).
 *
 * Header: who you are talking to (a person, or the group named by its route),
 * one quiet line, and the Report circle in private chats. The trip lives in a
 * card that floats above the chat. It shows in full while the chat is short
 * enough that no message would go behind it ("docked"), becomes a pill when
 * messages would ("compact"), and opens over the chat when the pill is tapped
 * ("peek"). Private chat: the rider's own pickup and drop. Group chat: the
 * departure time, status and seats (the route is the group's name).
 *
 * Messages come over REST and are refreshed every few seconds while the chat
 * is open (the spec's polling fallback). Riders get the pin button to ask for
 * a new pickup; the driver answers on the card. Hold a message to report it.
 * Kept identical in both apps.
 */
@Component({
  selector: 'app-carpool-chat',
  template: `
    <div class="chat">
      <header class="hd">
        <button class="icon-btn" aria-label="Back" (click)="back()"><ion-icon name="chevron-back-outline"></ion-icon></button>
        <button class="who" *ngIf="conv" (click)="openCarpool()">
          <span class="av" [class.group]="conv.kind === 'group'"><ion-icon *ngIf="conv.kind === 'group'" name="people"></ion-icon><ng-container *ngIf="conv.kind !== 'group'">{{ conv.other_initials }}</ng-container></span>
          <span class="names"><h1>{{ headName }}</h1><p>{{ headSub }}</p></span>
        </button>
        <span class="who" *ngIf="!conv"></span>
        <button class="icon-btn report" *ngIf="conv && conv.kind === 'direct' && writable" [attr.aria-label]="'Report ' + conv.other_first_name" (click)="openReport(null)"><ion-icon name="flag-outline"></ion-icon></button>
      </header>

      <div class="tw">
        <div class="thread" #threadEl [style.padding-top.px]="conv ? threadPad : null" (click)="menuFor = null" (wheel)="closePeek()" (touchmove)="closePeek()">
          <div class="msgs" #msgsEl>
            <div class="center" *ngIf="!conv && !error"><ion-spinner name="crescent"></ion-spinner></div>
            <div class="errline" *ngIf="error && !conv" role="alert">Couldn't load this chat. <button (click)="load()">Try again</button></div>

            <button type="button" class="more-btn" *ngIf="conv && hasMoreBefore" [disabled]="loadingOlder" (click)="loadOlder()">{{ loadingOlder ? 'Loading…' : 'Show earlier messages' }}</button>
            <p class="sys" *ngIf="conv && conv.kind === 'direct' && !messages.length">Only you and {{ conv.other_first_name }} can see this chat</p>
            <ng-container *ngFor="let m of messages; let i = index; trackBy: track">
              <span class="day" *ngIf="newDay(i)">{{ dayLabel(m.created_at) }}</span>
              <p class="sys" *ngIf="i === 0 && conv && conv.kind === 'direct'">Only you and {{ conv.other_first_name }} can see this chat</p>
              <p class="unread" *ngIf="m.id === dividerId">{{ unreadCount }} unread {{ unreadCount === 1 ? 'message' : 'messages' }}</p>
              <p class="sys" *ngIf="m.type === 'system'">{{ m.body }}</p>

              <div class="me" *ngIf="m.type !== 'system' && m.mine">
                <div class="b" [class.fail]="m.local === 'failed'" [class.removed]="m.removed"><ion-icon *ngIf="m.removed" name="close-circle-outline"></ion-icon>{{ m.body }}<time>{{ time(m.created_at) }}</time></div>
                <p class="mask-note" *ngIf="m.masked">Some words were hidden</p>
                <div class="pk" *ngIf="m.type === 'pickup_request' && m.proposal" [class.accepted]="m.proposal.status === 'accepted'">
                  <svg class="pk-map" viewBox="0 0 258 104" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                    <rect width="258" height="104" fill="#eef1f4"/>
                    <path [attr.d]="mini(m).d" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
                    <path [attr.d]="mini(m).d" fill="none" stroke="#087f50" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle [attr.cx]="mini(m).x" [attr.cy]="mini(m).y" r="8" fill="#fff" stroke="#0d1b2a" stroke-width="3"/>
                  </svg>
                  <div class="in">
                    <span class="label">New pickup spot{{ conv?.kind === 'group' && m.proposal.proposed_by === 'driver' ? ' for ' + m.proposal.rider_first_name : '' }}</span><h4>{{ m.proposal.name }}</h4>
                    <p class="state"><ion-icon [name]="proposalIcon(m)"></ion-icon>{{ proposalWord(m, true) }}</p>
                  </div>
                </div>
                <button class="fail-line" *ngIf="m.local === 'failed'" (click)="retry(m)"><ion-icon name="alert-circle-outline"></ion-icon>Not sent. Tap to try again</button>
              </div>

              <div class="them" *ngIf="m.type !== 'system' && !m.mine">
                <span class="av-s">{{ m.sender?.initials }}</span>
                <div>
                  <p class="who-name" [class.driver]="m.sender?.is_driver" *ngIf="showName(i)">{{ m.sender?.first_name }}<em *ngIf="m.sender?.is_driver && !conv?.is_driver">Driver</em></p>
                  <div class="b" [class.removed]="m.removed" (contextmenu)="hold($event, m)" (touchstart)="holdStart(m)" (touchend)="holdEnd()" (touchmove)="holdEnd()"><ion-icon *ngIf="m.removed" name="close-circle-outline"></ion-icon>{{ m.body }}<time>{{ time(m.created_at) }}</time></div>
                  <p class="mask-note" *ngIf="m.masked">Some words were hidden</p>
                  <div class="pk" *ngIf="m.type === 'pickup_request' && m.proposal" [class.accepted]="m.proposal.status === 'accepted'">
                    <svg class="pk-map" viewBox="0 0 258 104" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                      <rect width="258" height="104" fill="#eef1f4"/>
                      <path [attr.d]="mini(m).d" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
                      <path [attr.d]="mini(m).d" fill="none" stroke="#087f50" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
                      <circle [attr.cx]="mini(m).x" [attr.cy]="mini(m).y" r="8" fill="#fff" stroke="#0d1b2a" stroke-width="3"/>
                    </svg>
                    <div class="in">
                      <span class="label">New pickup spot{{ conv?.kind === 'group' && m.proposal.proposed_by === 'driver' ? ' for ' + m.proposal.rider_first_name : '' }}</span><h4>{{ m.proposal.name }}</h4>
                      <p class="state"><ion-icon [name]="proposalIcon(m)"></ion-icon>{{ proposalWord(m, false) }}</p>
                      <div class="acts" *ngIf="canAnswer(m)">
                        <button class="btn line" [disabled]="answering" (click)="askPickup(m)">Another spot</button>
                        <button class="btn" [disabled]="answering" (click)="answer(m, true)">Accept</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="menu-pop" *ngIf="menuFor === m.id && !m.mine">
                <button (click)="copy(m)"><ion-icon name="copy-outline"></ion-icon>Copy</button>
                <button class="danger" (click)="reportFromMenu(m)"><ion-icon name="flag-outline"></ion-icon>Report message</button>
              </div>
            </ng-container>
            <p class="errline small" *ngIf="sendError" role="alert">{{ sendError }}</p>
          </div>
        </div>

        <!-- Floating above the chat: a tap outside the open card closes it; no dimming. -->
        <div class="scrim" *ngIf="conv" [class.on]="tripMode === 'peek'" (click)="closePeek()"></div>

        <div class="trip" #tripEl *ngIf="conv" [class.on]="tripMode !== 'compact'" [attr.aria-hidden]="tripMode === 'compact'">
          <div class="trip-top">
            <div class="when"><small>{{ tripLabel }}</small><b>{{ tripTime }}</b></div>
            <span class="status" *ngIf="tripStatus" [ngClass]="tripStatus.kind">{{ tripStatus.text }}</span>
          </div>
          <div class="rt" *ngIf="conv.kind === 'direct' && conv.trip">
            <div class="stop a"><ion-icon name="radio-button-on"></ion-icon><span>{{ conv.trip.pickup.name }}</span></div>
            <div class="link"></div>
            <div class="stop to"><ion-icon name="location"></ion-icon><span>{{ conv.trip.drop.name }}</span></div>
          </div>
          <div class="trip-foot" [class.bare]="conv.kind === 'group'">
            <span class="meta">{{ tripMeta }}</span>
            <button class="view" (click)="openCarpool()">View carpool<ion-icon name="chevron-forward-outline"></ion-icon></button>
          </div>
        </div>

        <button class="pill" *ngIf="conv" [class.on]="tripMode === 'compact'" [attr.aria-hidden]="tripMode !== 'compact'" [attr.tabindex]="tripMode === 'compact' ? 0 : -1" aria-label="Show trip details" (click)="openPeek()">
          <span class="l">
            <ng-container *ngIf="pillStops; else pillStatus">
              <ion-icon class="ring" name="radio-button-on"></ion-icon><span>{{ pillStops.from }}</span><ion-icon name="arrow-forward-outline"></ion-icon><ion-icon class="pn" name="location"></ion-icon><span>{{ pillStops.to }}</span>
            </ng-container>
            <ng-template #pillStatus><span class="st" [ngClass]="tripStatus?.kind">{{ tripStatus?.text }}</span></ng-template>
          </span>
          <span class="r">{{ tripTime }}<ion-icon name="chevron-down-outline" class="dn"></ion-icon></span>
        </button>
      </div>

      <p class="limit" *ngIf="conv && writable && draft.length > maxChars" role="alert"><ion-icon name="alert-circle-outline"></ion-icon>{{ draft.length | number }} of {{ maxChars | number }} characters. Shorten it to send.</p>
      <div class="compose" *ngIf="conv && writable" [class.typing]="!!draft.trim()">
        <button class="pin" *ngIf="canAskPickup" aria-label="Request pickup at a place" (click)="askPickup()"><ion-icon name="location-outline"></ion-icon></button>
        <input type="text" [placeholder]="conv.kind === 'group' ? 'Message the group' : 'Message ' + conv.other_first_name" [attr.aria-label]="'Message'" [(ngModel)]="draft" (keyup.enter)="send()" autocomplete="off" />
        <button class="send" aria-label="Send" [disabled]="draft.length > maxChars" [style.opacity]="draft.length > maxChars ? .45 : null" (click)="send()"><ion-icon name="send"></ion-icon></button>
      </div>
      <div class="ro-bar" *ngIf="conv && !writable"><ion-icon name="lock-closed-outline"></ion-icon>Read only. Deleted {{ retention }} {{ retention === 1 ? 'day' : 'days' }} after the trip ended.</div>
    </div>

    <ng-container *ngIf="sheet">
      <div class="sheet-scrim" (click)="closeSheet()"></div>
      <div class="bsheet" role="dialog" aria-modal="true">
        <div class="grab"></div>
        <div class="sheet-in">
          <h2>{{ sheet.message ? 'Report message' : 'Report ' + (conv?.other_first_name || 'this person') }}</h2>
          <div class="quote" *ngIf="sheet.message"><small>{{ sheet.message.sender?.first_name }}, {{ time(sheet.message.created_at) }}</small>{{ sheet.message.body }}</div>
          <p class="t13 muted">Our team reviews every report. {{ sheet.message ? (sheet.message.sender?.first_name || 'They') : (conv?.other_first_name || 'They') }} isn't told who reported.</p>
          <ng-container *ngIf="!reported">
            <button class="opt" *ngFor="let r of reasons" [class.on]="reason === r.key" role="radio" [attr.aria-checked]="reason === r.key" (click)="reason = r.key"><span class="dot"></span><span class="grow">{{ r.label }}</span></button>
            <textarea *ngIf="!sheet.message" [(ngModel)]="details" maxlength="1000" placeholder="Tell us what happened (optional)" aria-label="What happened"></textarea>
            <p class="errline small" *ngIf="reportError" role="alert">{{ reportError }}</p>
            <button class="go" [disabled]="!reason || reporting" (click)="sendReport()">{{ reporting ? 'Sending…' : 'Send report' }}</button>
          </ng-container>
          <p class="done" *ngIf="reported" role="status"><ion-icon name="checkmark-circle"></ion-icon>Report sent. Thank you.</p>
        </div>
      </div>
    </ng-container>
  `,
  styles: [`
    :host { display: block; height: 100%; font-family: Roboto, "Segoe UI", system-ui, sans-serif; font-size: 15px; color: #0d1b2a; --green: #087f50; --line: #e4e9ef; --muted: #6b7a8f; --ink2: #3a4a5e; --red: #c62f3c;
      --lift: 0 1px 2px #0d1b2a0d, 0 8px 24px #0d1b2a12; }
    .chat { position: absolute; inset: 0; display: flex; flex-direction: column; background: #fff; padding-top: var(--ion-safe-area-top, 0px); }

    /* Header: one white surface and one soft shadow */
    .hd { position: relative; z-index: 6; flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 12px 8px 4px; background: #fff; box-shadow: var(--lift); }
    .icon-btn { width: 44px; height: 44px; flex: none; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: #0d1b2a; font-size: 24px; }
    .icon-btn.report { background: #f2f4f7; color: var(--muted); font-size: 19px; }
    .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: transparent; text-align: left; color: inherit; font: inherit; }
    .av { width: 44px; height: 44px; flex: none; display: grid; place-items: center; border-radius: 50%; background: #e9eef4; color: var(--ink2); font-size: 15px; font-weight: 600; }
    .av.group { background: #0d1b2a; color: #fff; font-size: 21px; }
    .names { min-width: 0; }
    .names h1 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; font-weight: 600; line-height: 1.25; letter-spacing: -.1px; }
    .names p { margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 1.3; color: var(--muted); }

    /* The thread, with the trip card and the pill floating above it */
    .tw { position: relative; flex: 1; min-height: 0; display: flex; overflow: hidden; }
    .thread { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 12px 10px; overflow-y: auto; background-color: #efeae2; transition: padding-top .3s ease; }
    .msgs { flex: none; margin-top: auto; display: flex; flex-direction: column; }
    .center { display: grid; place-items: center; padding: 40px 0; }
    .day { align-self: center; margin: 4px 0 10px; padding: 4px 12px; border-radius: 12px; background: #fff; box-shadow: 0 1px 1px #0b141a14; font-size: 12px; font-weight: 500; color: #55657b; }
    .sys { align-self: center; margin: 2px 0 10px; padding: 4px 10px; border-radius: 8px; background: #fffffff0; box-shadow: 0 1px 1px #0b141a14; font-size: 12px; color: #5a6a80; text-align: center; }
    .them { display: flex; align-items: flex-end; gap: 8px; max-width: 86%; margin-bottom: 10px; }
    .them > div { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
    .av-s { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border-radius: 50%; background: #e6f4ed; color: var(--green); font-size: 11px; font-weight: 700; }
    .who-name { margin: 0 0 2px 12px; font-size: 12px; font-weight: 700; color: #3d5a80; }
    .who-name.driver { color: var(--green); }
    .who-name em { margin-left: 6px; padding: 1px 6px; border-radius: 6px; background: #e6f4ed; font-style: normal; font-size: 12px; }
    .b { padding: 8px 12px; border: 1px solid var(--line); border-radius: 18px 18px 18px 6px; background: #fff; font-size: 15px; line-height: 1.35; overflow-wrap: anywhere; -webkit-user-select: none; user-select: none; }
    .b.removed { font-style: italic; color: var(--muted); }
    .b time { float: right; margin: 5px 0 0 10px; font-size: 12px; color: #5a6a80; }
    .me { align-self: flex-end; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; max-width: 78%; margin-bottom: 10px; }
    .me .b { border-color: var(--green); border-radius: 18px 18px 6px 18px; background: var(--green); color: #fff; }
    .me .b time { color: #ffffffb8; }
    .me .b.fail { border-color: #f1c4c8; background: #fdf1f2; color: #0d1b2a; }
    .me .b.removed { color: #ffffffd0; }
    .fail-line { display: flex; align-items: center; gap: 5px; border: 0; background: transparent; min-height: 44px; padding: 0; font-size: 12px; font-weight: 700; color: #c62f3c; }
    .fail-line ion-icon { font-size: 15px; }
    .pk { width: 258px; max-width: 100%; box-sizing: border-box; overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: #fff; }
    .pk .pk-map { display: block; width: 100%; height: 104px; }
    .pk .in { padding: 10px 12px 12px; }
    .unread { display: flex; align-items: center; gap: 10px; margin: 4px 0 10px; padding: 4px 0; border-radius: 8px; background: #ffffffd0; font-size: 12px; font-weight: 700; color: var(--green); }
    .unread::before, .unread::after { content: ""; flex: 1; height: 1px; background: #b9dfcb; }
    .mask-note { margin: 2px 12px 0; font-size: 12px; color: var(--muted); }
    .b ion-icon { vertical-align: -3px; margin-right: 6px; font-size: 16px; }
    .menu-pop { align-self: flex-start; margin: -4px 0 12px 36px; width: 190px; padding: 6px; border: 1px solid var(--line); border-radius: 14px; background: #fff; box-shadow: 0 10px 30px #142b3a22; }
    .menu-pop button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 0 10px; border: 0; border-radius: 9px; background: transparent; font-size: 14px; color: #0d1b2a; }
    .menu-pop ion-icon { font-size: 19px; }
    .limit { flex: none; display: flex; align-items: center; gap: 6px; margin: 0; padding: 8px 16px 0; background: #fff; font-size: 12px; font-weight: 700; color: #c62f3c; }
    .pk .label { font-size: 12px; font-weight: 700; color: var(--muted); }
    .pk h4 { margin: 2px 0 0; font-size: 15px; font-weight: 700; color: #0d1b2a; }
    .pk .state { margin: 6px 0 0; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--muted); }
    .pk .state ion-icon { font-size: 17px; }
    .pk.accepted .state { color: var(--green); }
    .pk .acts { display: flex; gap: 8px; margin-top: 10px; }
    .btn { flex: 1; min-height: 44px; border-radius: 12px; border: 1px solid var(--green); background: var(--green); color: #fff; font-size: 14px; font-weight: 700; }
    .btn.line { background: #fff; color: var(--green); }
    .btn:disabled { opacity: .55; }

    /* The trip card (full) */
    .scrim { position: absolute; inset: 0; z-index: 3; background: transparent; pointer-events: none; }
    .scrim.on { pointer-events: auto; }
    .trip { position: absolute; left: 12px; right: 12px; top: 10px; z-index: 4; box-sizing: border-box; padding: 16px; border-radius: 14px; background: #fff; box-shadow: var(--lift);
      opacity: 0; transform: translateY(-14px) scale(.96); transform-origin: top center; pointer-events: none; transition: transform .45s cubic-bezier(.34, 1.56, .64, 1), opacity .2s ease; }
    .trip.on { opacity: 1; transform: none; pointer-events: auto; }
    .trip-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .when small { display: block; font-size: 12px; font-weight: 500; letter-spacing: .3px; text-transform: uppercase; color: var(--muted); }
    .when b { display: block; margin-top: 2px; font-size: 19px; font-weight: 600; letter-spacing: -.2px; }
    .status { flex: none; display: inline-flex; align-items: center; gap: 6px; margin-top: 2px; padding: 4px 10px; border-radius: 8px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
    .status.live, .status.ok { background: #e6f4ed; color: var(--green); }
    .status.live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #12b35b; }
    .status.sent { background: #fff3d6; color: #8a5a00; }
    .status.cancel { background: #fdecee; color: var(--red); }
    .status.done { background: #eef1f4; color: var(--ink2); }
    .rt { margin-top: 16px; display: flex; flex-direction: column; }
    .rt .stop { display: flex; align-items: center; gap: 12px; min-height: 24px; font-size: 15.5px; font-weight: 500; }
    .rt .stop span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rt .stop ion-icon { font-size: 18px; width: 18px; flex: none; }
    .rt .stop.a ion-icon { color: var(--green); } .rt .stop.to ion-icon { color: #0d1b2a; }
    .rt .link { width: 18px; height: 14px; display: flex; justify-content: center; } .rt .link::before { content: ""; width: 2px; height: 100%; border-radius: 1px; background: #d5dce5; }
    .trip-foot { margin-top: 16px; padding-top: 12px; border-top: 1px solid #eef1f5; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .trip-foot.bare { margin-top: 12px; padding-top: 0; border-top: 0; }
    .trip-foot .meta { min-width: 0; font-size: 13px; color: var(--muted); }
    .trip-foot .view { flex: none; display: inline-flex; align-items: center; gap: 2px; min-height: 32px; padding: 0; border: 0; background: transparent; font: inherit; font-size: 14px; font-weight: 600; color: var(--green); }
    .trip-foot .view ion-icon { font-size: 16px; }

    /* The pill: fixed width, two fixed slots (stops, time), squarer corners, no labels */
    .pill { position: absolute; left: 12px; right: 12px; top: 10px; z-index: 4; box-sizing: border-box; max-width: 340px; margin: 0 auto; height: 44px; display: grid; grid-template-columns: minmax(0, 1fr) 104px; align-items: center; padding: 0 14px; border: 0; border-radius: 10px; background: #fff; box-shadow: var(--lift); font: inherit; color: #0d1b2a; text-align: left;
      opacity: 0; transform: translateY(-16px) scale(.96); pointer-events: none; transition: transform .4s cubic-bezier(.34, 1.56, .64, 1), opacity .2s ease; }
    .pill.on { opacity: 1; transform: none; pointer-events: auto; }
    .pill .l { min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; }
    .pill .l span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill .l ion-icon { font-size: 15px; flex: none; color: var(--muted); } .pill .l .ring { color: var(--green); } .pill .l .pn { color: #0d1b2a; }
    .pill .r { height: 24px; display: flex; align-items: center; justify-content: flex-end; border-left: 1px solid var(--line); font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pill .r .dn { width: 16px; height: 16px; margin-left: 4px; color: var(--muted); }
    .pill .st { display: inline-flex; align-items: center; gap: 6px; }
    .pill .st.live { color: var(--green); } .pill .st.live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #12b35b; }
    .pill .st.ok { color: var(--green); } .pill .st.cancel { color: var(--red); }
    @media (prefers-reduced-motion: reduce) { .trip, .pill, .thread { transition: opacity .2s; } }

    .compose { position: relative; z-index: 6; flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 12px calc(14px + var(--ion-safe-area-bottom, 0px)); border-top: 1px solid var(--line); background: #fff; }
    .compose .pin { width: 44px; height: 44px; flex: none; display: grid; place-items: center; border: 0; border-radius: 50%; background: #e6f4ed; color: var(--green); font-size: 22px; }
    .compose input { flex: 1; min-width: 0; height: 44px; padding: 0 16px; border: 0; border-radius: 22px; background: #f1f4f7; font-size: 15px; font-family: inherit; color: #0d1b2a; outline: none; }
    .compose input::placeholder { color: #5f6f84; }
    .compose .send { width: 0; height: 44px; padding: 0; overflow: hidden; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--green); color: #fff; font-size: 20px; opacity: 0; transition: width .18s ease, opacity .18s ease; }
    .compose.typing .send { width: 44px; opacity: 1; }
    .ro-bar { position: relative; z-index: 6; flex: none; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 60px; padding: 10px 16px calc(14px + var(--ion-safe-area-bottom, 0px)); border-top: 1px solid var(--line); background: #fff; font-size: 13px; color: var(--muted); }
    .ro-bar ion-icon { font-size: 17px; }
    .errline { align-self: center; margin: 8px 0; font-size: 13px; color: #c62f3c; text-align: center; }
    .errline button { border: 0; background: transparent; color: var(--green); font-weight: 700; font-size: 13px; }
    .errline.small { font-size: 12px; }
    .sheet-scrim { position: fixed; inset: 0; z-index: 20; background: #0d1b2a66; }
    .bsheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; max-height: 90%; overflow-y: auto; border-radius: 22px 22px 0 0; background: #fff; padding-bottom: var(--ion-safe-area-bottom, 0px); }
    .grab { width: 40px; height: 4px; margin: 10px auto 0; border-radius: 2px; background: #d3dae2; }
    .sheet-in { padding: 8px 20px 18px; }
    .sheet-in h2 { margin: 0; font-size: 19px; font-weight: 800; }
    .t13 { font-size: 13px; } .muted { color: var(--muted); }
    .sheet-in p.t13 { margin: 10px 0 12px; }
    .quote { margin-top: 10px; padding: 10px 12px; border-left: 3px solid var(--green); border-radius: 8px; background: #f5f7fa; font-size: 14px; }
    .quote small { display: block; margin-bottom: 2px; font-size: 12px; font-weight: 700; color: var(--muted); }
    .opt { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; margin-bottom: 8px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px; background: #fff; font-size: 14px; text-align: left; color: #0d1b2a; }
    .opt .grow { flex: 1; }
    .opt .dot { width: 20px; height: 20px; flex: none; border: 2px solid #b8c3cf; border-radius: 50%; }
    .opt.on { border-color: var(--green); background: #f1faf5; }
    .opt.on .dot { border-color: var(--green); background: radial-gradient(var(--green) 45%, transparent 50%); }
    textarea { display: block; box-sizing: border-box; width: 100%; min-height: 76px; margin-top: 4px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; font: inherit; font-size: 14px; resize: none; color: #0d1b2a; }
    .go { display: block; width: 100%; min-height: 52px; margin-top: 14px; border: 0; border-radius: 12px; background: var(--green); color: #fff; font-size: 16px; font-weight: 700; }
    .go:disabled { opacity: .5; }
    .done { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 56px; margin: 14px 0 0; color: var(--green); font-weight: 700; }
    .done ion-icon { font-size: 20px; }
  `],
  standalone: false,
})
export class CarpoolChatPage implements OnInit, AfterViewInit, OnDestroy, AfterViewChecked {
  @ViewChild('threadEl') threadEl?: ElementRef<HTMLElement>;
  @ViewChild('msgsEl') msgsEl?: ElementRef<HTMLElement>;
  @ViewChild('tripEl') tripEl?: ElementRef<HTMLElement>;

  conv: CarpoolChatConversation | null = null;
  messages: CarpoolChatMessage[] = [];
  writable = false;
  error = false;
  draft = '';
  sendError: string | null = null;
  answering = false;
  /** Replaced by the server's limit when the chat loads; 1,000 is the spec value (P9). */
  maxChars = 1000;
  retention = 1;
  routeLine: [number, number][] = [];
  /** The message the "N unread messages" line sits above, and how many are unread (mockup 14). */
  dividerId: number | null = null;
  unreadCount = 0;
  /** The message whose Copy / Report menu is open (press and hold). */
  menuFor: number | null = null;
  private minis = new Map<string, { d: string; x: number; y: number }>();

  /** The trip card: full while the chat is short, a pill once messages would go behind it, open over the chat when the pill is tapped. */
  tripMode: TripMode = 'docked';
  /** Room the thread keeps free at its top for the card or the pill. */
  threadPad = 12;

  sheet: { message: CarpoolChatMessage | null } | null = null;
  reasons = PERSON_REASONS;
  reason: CarpoolReportReason | null = null;
  details = '';
  reporting = false;
  reported = false;
  reportError: string | null = null;

  private id = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private fitTimer: ReturnType<typeof setTimeout> | null = null;
  private watcher: ResizeObserver | null = null;
  private stick = true;
  private tempId = -1;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private nav: NavController,
    private carpool: CarpoolApiService,
    private zone: NgZone,
  ) {}

  ngOnInit(): void {
    this.id = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
    this.timer = setInterval(() => {
      if (!document.hidden && this.conv) this.poll();
    }, 4000);
  }

  ngAfterViewInit(): void {
    // Re-fit the card whenever the thread, the messages or the card change size (new messages, rotation, keyboard).
    if (typeof ResizeObserver === 'undefined') return;
    this.watcher = new ResizeObserver(() => this.scheduleFit());
    for (const el of [this.threadEl, this.msgsEl]) if (el) this.watcher.observe(el.nativeElement);
  }

  /** Coming back from the pickup page: show what was just sent without waiting for the next poll. */
  ionViewWillEnter(): void {
    if (this.conv) this.poll();
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.fitTimer) clearTimeout(this.fitTimer);
    this.watcher?.disconnect();
    this.holdEnd();
  }

  ngAfterViewChecked(): void {
    const el = this.threadEl?.nativeElement;
    if (el && this.stick) el.scrollTop = el.scrollHeight;
  }

  hasMoreBefore = false;
  loadingOlder = false;

  /** Older messages, one page at a time (S12); the thread keeps its place instead of jumping to the bottom. */
  loadOlder(): void {
    const first = this.messages.find((m) => m.id > 0)?.id;
    if (!first || this.loadingOlder) return;
    this.loadingOlder = true;
    this.stick = false;
    const el = this.threadEl?.nativeElement;
    const before = el?.scrollHeight ?? 0;
    this.carpool.chat(this.id, 0, first).subscribe({
      next: (t) => {
        this.messages = [...t.messages, ...this.messages];
        this.hasMoreBefore = !!t.has_more_before;
        this.loadingOlder = false;
        setTimeout(() => { if (el) el.scrollTop = el.scrollHeight - before; });
      },
      error: () => (this.loadingOlder = false),
    });
  }

  load(): void {
    this.error = false;
    this.carpool.chat(this.id).subscribe({
      next: (t) => {
        this.conv = t.conversation;
        this.messages = t.messages;
        this.hasMoreBefore = !!t.has_more_before;
        this.writable = t.writable;
        this.routeLine = t.route ?? [];
        this.retention = t.retention_days ?? 1;
        this.maxChars = t.message_max_chars ?? 1000;
        const unread = t.messages.filter((m) => m.id > t.last_read_message_id && !m.mine && m.type !== 'system');
        this.dividerId = unread[0]?.id ?? null;
        this.unreadCount = unread.length;
        this.stick = !this.dividerId;
        if (this.dividerId) setTimeout(() => this.scrollToDivider());
        this.markRead();
        this.scheduleFit();
        if (this.route.snapshot.queryParamMap.get('report') && t.conversation.kind === 'direct') this.openReport(null);
      },
      error: () => (this.error = true),
    });
  }

  private scrollToDivider(): void {
    this.threadEl?.nativeElement.querySelector('.unread')?.scrollIntoView({ block: 'center' });
  }

  /** Only newer messages, merged in. */
  private poll(): void {
    const last = this.messages.filter((m) => !m.local).reduce((n, m) => Math.max(n, m.id), 0);
    this.carpool.chat(this.id, last).subscribe({
      next: (t) => {
        this.writable = t.writable;
        // The card and the pill follow the live state (request answered, ride started, cancelled).
        if (t.conversation) this.conv = t.conversation;
        const have = new Set(this.messages.map((m) => m.id));
        const fresh = t.messages.filter((m) => !have.has(m.id));
        // Our own sent message is already shown from the send call.
        if (fresh.length) {
          this.messages = [...this.messages, ...fresh];
          this.stick = true;
          this.markRead();
          this.closePeek();
        }
        this.refreshProposals(t.proposal_states ?? {});
      },
      error: () => undefined,
    });
  }

  /** A pickup card changes state when the other side answers or a newer request replaces it. */
  private refreshProposals(states: Record<string, 'pending' | 'accepted' | 'declined' | 'replaced'>): void {
    for (const m of this.messages) {
      const status = m.proposal ? states[m.proposal.id] : undefined;
      if (m.proposal && status && status !== m.proposal.status) m.proposal = { ...m.proposal, status };
    }
  }

  private markRead(): void {
    this.carpool.markChatRead(this.id).subscribe({ error: () => undefined });
  }

  // ── Header and trip card ──

  /** A person's first name, or the route for the group (the group is named after the trip). */
  get headName(): string {
    const c = this.conv;
    if (!c) return '';
    return c.kind === 'group' ? `${c.listing.start.name} to ${c.listing.end.name}` : (c.other_first_name ?? '');
  }

  /** The one quiet line under the name. */
  get headSub(): string {
    const c = this.conv;
    if (!c) return '';
    let base: string;
    if (c.kind === 'group') {
      base = c.member_names?.length ? c.member_names.join(', ') : `${c.members} people`;
    } else if (c.is_driver) {
      const t = c.trip;
      base = 'Rider' + (t ? ` · ${t.seats} seat${t.seats === 1 ? '' : 's'}${t.paid_marked ? ' · Paid' : ''}` : '');
    } else {
      base = 'Driver' + (c.car_label ? ` · ${c.car_label}` : '');
    }
    return this.writable ? base : `${base} · Read only`;
  }

  /** Small capitals above the big time. */
  get tripLabel(): string {
    const c = this.conv;
    if (!c) return '';
    if (c.kind === 'direct' && c.trip) {
      const owner = c.is_driver ? `${c.trip.rider_first_name}'s` : 'Your';
      return `${owner} pickup${c.trip.state === 'sent' ? ', about' : ''} · ${this.dayLabel(c.trip.pickup.at)}`;
    }
    const word = c.listing.status === 'completed' ? 'Left' : c.listing.status === 'cancelled' ? 'Was leaving' : 'Leaves';
    return `${word} · ${this.dayLabel(c.listing.departs_at)}`;
  }

  /** The big time: a rider's own pickup time in a private chat, the departure time in the group. */
  get tripTime(): string {
    const c = this.conv;
    if (!c) return '';
    return this.time(c.kind === 'direct' && c.trip ? c.trip.pickup.at : c.listing.departs_at);
  }

  /** The status pill in the card, and the status shown in the compact pill when the trip has no stops to show. */
  get tripStatus(): { text: string; kind: StatusKind } | null {
    const c = this.conv;
    if (!c) return null;
    if (c.kind === 'direct' && c.trip) {
      switch (c.trip.state) {
        case 'sent': return { text: 'Request sent', kind: 'sent' };
        case 'accepted': return { text: 'Accepted', kind: 'ok' };
        case 'started': return { text: 'Live', kind: 'live' };
        case 'completed': return { text: 'Completed', kind: 'done' };
        case 'cancelled': return { text: 'Cancelled', kind: 'cancel' };
        case 'declined': return { text: 'Declined', kind: 'cancel' };
        case 'removed': return { text: 'Removed', kind: 'cancel' };
        case 'filled': return { text: 'Carpool full', kind: 'cancel' };
        case 'no_show': return { text: 'No-show', kind: 'cancel' };
        case 'withdrawn': return { text: 'Withdrawn', kind: 'done' };
        case 'left': return { text: c.is_driver ? 'Rider left' : 'You left', kind: 'done' };
        default: return { text: 'Ended', kind: 'done' };
      }
    }
    switch (c.listing.status) {
      case 'in_progress': return { text: 'Live', kind: 'live' };
      case 'completed': return { text: 'Completed', kind: 'done' };
      case 'cancelled': return { text: 'Cancelled', kind: 'cancel' };
      default: return { text: 'Upcoming', kind: 'ok' };
    }
  }

  /** The quiet line at the bottom of the card. */
  get tripMeta(): string {
    const c = this.conv;
    if (!c) return '';
    const leaves = `Leaves ${this.time(c.listing.departs_at)}`;
    if (c.kind === 'direct' && c.trip) {
      if (c.is_driver) return leaves;
      return `${leaves} · ${c.trip.is_free ? 'Free ride' : '₹' + c.trip.price_per_seat + ' a seat'}`;
    }
    if (c.listing.status === 'completed' || c.listing.status === 'cancelled') return `${c.members} ${c.members === 1 ? 'person' : 'people'} in this chat`;
    const free = c.listing.seats_free;
    const seats = free === 0 ? 'Full' : `${free} seat${free === 1 ? '' : 's'} left`;
    return `${seats} · ${c.listing.is_free ? 'Free ride' : '₹' + c.listing.price_per_seat + ' a seat'}`;
  }

  /** The two stops shown in the compact pill, or null when the pill shows the status instead (group chats, ended trips). */
  get pillStops(): { from: string; to: string } | null {
    const t = this.conv?.kind === 'direct' ? this.conv.trip : null;
    if (!t || ENDED_STATES.includes(t.state)) return null;
    return { from: t.pickup.name, to: t.drop.name };
  }

  // ── The trip card's three states ──

  /** Tap the pill: the full card opens over the chat. */
  openPeek(): void {
    this.tripMode = 'peek';
  }

  /** Tap outside the card, scroll, or a new message: back to the pill (or the docked card if there is room). */
  closePeek(): void {
    if (this.tripMode !== 'peek') return;
    this.tripMode = 'compact';
    this.scheduleFit();
  }

  /** The rule: docked while nothing would go behind the card, otherwise the pill. A card opened by the person is left alone. */
  chooseMode(fits: boolean, cardHeight: number): void {
    if (this.tripMode !== 'peek') this.tripMode = fits ? 'docked' : 'compact';
    this.threadPad = this.tripMode === 'docked' ? cardHeight + TRIP_GAP * 2 : PILL_SPACE;
  }

  private scheduleFit(): void {
    if (this.fitTimer) return;
    this.fitTimer = setTimeout(() => {
      this.fitTimer = null;
      this.zone.run(() => this.fit());
    }, 0);
  }

  private fit(): void {
    const th = this.threadEl?.nativeElement;
    const ms = this.msgsEl?.nativeElement;
    const card = this.tripEl?.nativeElement;
    if (!th || !ms || !card) return;
    const need = ms.offsetHeight + card.offsetHeight + TRIP_GAP * 2 + 10;
    this.chooseMode(need <= th.clientHeight, card.offsetHeight);
  }

  get canAskPickup(): boolean {
    const c = this.conv;
    // Riders ask from the private chat or the group chat (mockups 6b, 7); the group only exists once they are accepted.
    return !!c && !c.is_driver && c.listing.status === 'published' && (c.kind === 'group' || !!c.request_id);
  }

  // ── Showing messages ──

  track = (_: number, m: CarpoolChatMessage) => m.id;

  time(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  dayLabel(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === -1) return 'Yesterday';
    if (days === 1) return 'Tomorrow';
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }

  newDay(i: number): boolean {
    if (i === 0) return true;
    return new Date(this.messages[i].created_at).toDateString() !== new Date(this.messages[i - 1].created_at).toDateString();
  }

  /** In the group, a name shows above a run of messages from one person. */
  showName(i: number): boolean {
    const m = this.messages[i];
    const prev = this.messages[i - 1];
    // A rider sees "Imran  Driver" over the driver's messages in the private chat (mockup 6b).
    if (this.conv?.kind === 'direct') return !this.conv.is_driver && !!m.sender?.is_driver && (!prev || prev.type === 'system' || prev.mine);
    if (this.conv?.kind !== 'group') return false;
    return !prev || prev.type === 'system' || prev.mine || prev.sender?.id !== m.sender?.id;
  }

  /** The other person answers a pickup request (mockup 14): the driver a rider's, the rider the driver's. */
  canAnswer(m: CarpoolChatMessage): boolean {
    const p = m.proposal;
    if (!p || p.status !== 'pending' || !this.writable || !this.conv) return false;
    return p.proposed_by === 'rider' ? this.conv.is_driver : p.for_me;
  }

  /**
   * The mini map on a pickup card (mockups 14, 7): the saved route near the
   * spot, drawn as a line, with the spot on it. No map call, so it is instant.
   */
  mini(m: CarpoolChatMessage): { d: string; x: number; y: number } {
    const p = m.proposal;
    const key = `${m.id}:${this.routeLine.length}`;
    const hit = this.minis.get(key);
    if (hit) return hit;
    const W = 258;
    const H = 104;
    if (!p || this.routeLine.length < 2) return { d: '', x: W / 2, y: H / 2 };
    const cos = Math.cos((p.lat * Math.PI) / 180);
    const pts = this.routeLine.map(([lat, lng]) => ({ x: (lng - p.lng) * cos, y: (lat - p.lat) }));
    // The part of the route around the spot, so the spot stays in view.
    let nearest = 0;
    pts.forEach((q, i) => { if (Math.hypot(q.x, q.y) < Math.hypot(pts[nearest].x, pts[nearest].y)) nearest = i; });
    const win = pts.slice(Math.max(0, nearest - 6), nearest + 8);
    const ext = win.reduce((a, q) => ({ x: Math.max(a.x, Math.abs(q.x)), y: Math.max(a.y, Math.abs(q.y)) }), { x: 1e-6, y: 1e-6 });
    const k = Math.min((W / 2 - 18) / ext.x, (H / 2 - 18) / ext.y);
    const d = win.map((q, i) => `${i ? 'L' : 'M'}${(W / 2 + q.x * k).toFixed(1)} ${(H / 2 - q.y * k).toFixed(1)}`).join('');
    const out = { d, x: W / 2, y: H / 2 };
    this.minis.set(key, out);
    return out;
  }

  /** Who the other side of a card is: the driver for a rider's card, the rider for the driver's. */
  private waitingFor(m: CarpoolChatMessage): string {
    return (m.proposal?.proposed_by === 'driver' ? m.proposal.rider_first_name : this.conv?.driver_first_name) ?? 'them';
  }

  proposalIcon(m: CarpoolChatMessage): string {
    const s = m.proposal?.status;
    return s === 'accepted' ? 'checkmark-circle' : s === 'declined' ? 'close-circle-outline' : 'time-outline';
  }

  proposalWord(m: CarpoolChatMessage, mine: boolean): string {
    switch (m.proposal?.status) {
      case 'accepted': return 'Accepted' + (mine ? ` by ${this.waitingFor(m)}` : '');
      case 'declined': return 'Declined';
      case 'replaced': return 'Replaced by a newer request';
      default: return mine ? `Waiting for ${this.waitingFor(m)}` : (this.conv?.is_driver ? 'On your route' : `On ${this.conv?.driver_first_name}'s route`);
    }
  }

  // ── Sending ──

  send(): void {
    const body = this.draft.trim();
    if (!body || !this.conv || !this.writable || body.length > this.maxChars) return;
    this.draft = '';
    this.sendError = null;
    const temp: CarpoolChatMessage = {
      id: this.tempId--, conversation_id: this.id, type: 'text', body, removed: false, masked: false, sender: null, mine: true,
      proposal: null, created_at: new Date().toISOString(), local: 'sending',
    };
    this.messages = [...this.messages, temp];
    this.stick = true;
    this.closePeek();
    this.deliver(temp);
  }

  retry(m: CarpoolChatMessage): void {
    m.local = 'sending';
    this.deliver(m);
  }

  private deliver(temp: CarpoolChatMessage): void {
    this.carpool.sendMessage(this.id, temp.body).subscribe({
      next: (sent) => {
        // Swap the temporary bubble for the saved one (unless polling already added it).
        const already = this.messages.some((m) => m.id === sent.id);
        this.messages = this.messages.filter((m) => m !== temp);
        if (!already) this.messages = [...this.messages, sent];
        this.stick = true;
      },
      error: (e) => {
        temp.local = 'failed';
        this.sendError = (Object.values(e?.error?.errors ?? {})[0] as string[] | undefined)?.[0] ?? null;
      },
    });
  }

  /** Opens the pin screen. From a card, it carries the card so the answer goes to the right rider. */
  askPickup(m?: CarpoolChatMessage): void {
    void this.router.navigate(['/carpool/chat', this.id, 'pickup'], m?.proposal ? { queryParams: { proposal: m.proposal.id } } : undefined);
  }

  answer(m: CarpoolChatMessage, accept: boolean): void {
    if (!m.proposal || this.answering) return;
    this.answering = true;
    this.carpool.answerPickup(m.proposal.id, accept).subscribe({
      next: () => {
        this.answering = false;
        if (m.proposal) m.proposal = { ...m.proposal, status: accept ? 'accepted' : 'declined' };
        this.poll();
      },
      error: (e) => {
        this.answering = false;
        this.sendError = (Object.values(e?.error?.errors ?? {})[0] as string[] | undefined)?.[0] ?? 'Something went wrong. Try again.';
        this.poll();
      },
    });
  }

  // ── Navigation ──

  back(): void {
    const driver = this.conv?.is_driver;
    void this.nav.navigateBack(driver === false ? '/carpool/messages' : '/carpool/inbox');
  }

  openCarpool(): void {
    if (!this.conv) return;
    void this.nav.navigateForward(this.conv.is_driver ? `/carpool/listing/${this.conv.listing.id}` : `/carpool/ride/${this.conv.listing.id}`);
  }

  // ── Report (driver 8e, rider 7c) ──

  /** Press and hold a message to report it. */
  holdStart(m: CarpoolChatMessage): void {
    this.holdEnd();
    this.holdTimer = setTimeout(() => this.zone.run(() => (this.menuFor = m.removed || m.type === 'system' ? null : m.id)), 550);
  }

  holdEnd(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  /** Press and hold (or right-click) opens Copy and Report message (mockup "Chat problems"). */
  hold(ev: Event, m: CarpoolChatMessage): void {
    ev.preventDefault();
    this.menuFor = m.removed || m.type === 'system' ? null : m.id;
  }

  copy(m: CarpoolChatMessage): void {
    void navigator.clipboard?.writeText(m.body).catch(() => undefined);
    this.menuFor = null;
  }

  reportFromMenu(m: CarpoolChatMessage): void {
    this.menuFor = null;
    this.openReport(m);
  }

  openReport(message: CarpoolChatMessage | null): void {
    if (message && (message.removed || message.type === 'system')) return;
    this.sheet = { message };
    this.reasons = message ? MESSAGE_REASONS : PERSON_REASONS; // until the server's list arrives
    this.carpool.config().subscribe({
      next: (c) => {
        const list = reasonsFor(c.report_reasons, message ? 'message' : 'person');
        if (list.length && this.sheet) this.reasons = list;
      },
      error: () => {},
    });
    this.reason = null;
    this.details = '';
    this.reported = false;
    this.reportError = null;
  }

  closeSheet(): void {
    if (this.reporting) return;
    this.sheet = null;
  }

  sendReport(): void {
    if (!this.sheet || !this.reason || !this.conv || this.reporting) return;
    this.reporting = true;
    this.reportError = null;
    const m = this.sheet.message;
    this.carpool
      .report(
        m
          ? { reason: this.reason, message_id: m.id }
          : { reason: this.reason, details: this.details.trim() || undefined, user_id: this.conv.other_user_id ?? undefined, listing_id: this.conv.listing.id },
      )
      .subscribe({
        next: () => {
          this.reporting = false;
          this.reported = true;
          setTimeout(() => (this.sheet = null), 1400);
        },
        error: (e) => {
          this.reporting = false;
          this.reportError = (Object.values(e?.error?.errors ?? {})[0] as string[] | undefined)?.[0] ?? 'Something went wrong. Try again.';
        },
      });
  }
}

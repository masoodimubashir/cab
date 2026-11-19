import { Injectable } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import {
  CARPOOL_OFF,
  CarpoolChatInbox,
  CarpoolChatMessage,
  CarpoolChatThread,
  CarpoolConfig,
  CarpoolDriverHome,
  CarpoolEditInput,
  CarpoolInbox,
  CarpoolJoinInput,
  CarpoolJoinRequest,
  CarpoolListFilter,
  CarpoolListing,
  CarpoolMyRequest,
  CarpoolPaymentResult,
  CarpoolPlan,
  CarpoolPlanPurchase,
  CarpoolPlanState,
  CarpoolPickupInput,
  CarpoolPublishInput,
  CarpoolReportInput,
  CarpoolRide,
  CarpoolRiderProfile,
  CarpoolSearchAnswer,
  CarpoolSearchQuery,
  CarpoolTrip,
  CarpoolUpiOrder,
} from './carpool.models';

/**
 * Every carpool API call goes through here. Keep identical in both apps.
 *
 * The app never assumes carpool exists: it asks /carpool/config and treats a
 * failed call as "off", so no carpool entry point shows when in doubt.
 */
@Injectable({ providedIn: 'root' })
export class CarpoolApiService {
  /** How long a config answer is reused before asking again. */
  private static readonly CONFIG_TTL_MS = 60_000;

  private config$: Observable<CarpoolConfig> | null = null;
  private fetchedAt = 0;

  /** Fires after a request is answered, so the Inbox badge can recount. */
  readonly answered$ = new Subject<void>();

  constructor(private api: ApiService) {}

  config(force = false): Observable<CarpoolConfig> {
    const stale = Date.now() - this.fetchedAt > CarpoolApiService.CONFIG_TTL_MS;
    if (!this.config$ || stale || force) {
      this.fetchedAt = Date.now();
      this.config$ = this.api.get<CarpoolConfig>('/carpool/config').pipe(
        map((c) => (c && c.enabled === true ? c : { ...CARPOOL_OFF, driver_signup: c?.driver_signup === true })),
        catchError(() => {
          this.fetchedAt = 0; // try again next time instead of caching the failure
          return of(CARPOOL_OFF);
        }),
        shareReplay(1),
      );
    }
    return this.config$;
  }

  enabled(): Observable<boolean> {
    return this.config().pipe(map((c) => c.enabled));
  }

  /** True when private car owners may sign up as carpool drivers (driver app). */
  signupOpen(): Observable<boolean> {
    return this.config().pipe(map((c) => c.driver_signup === true));
  }

  /** Plans the signed-in carpool driver can buy (driver app). */
  plans(): Observable<CarpoolPlan[]> {
    return this.api.get<{ data: CarpoolPlan[] }>('/carpool/plans').pipe(map((r) => r?.data ?? []));
  }

  /** The running plan, a waiting one, and whether the driver may publish (driver app). */
  planState(): Observable<CarpoolPlanState> {
    return this.api.get<CarpoolPlanState>('/carpool/plan');
  }

  createPlanOrder(planId: number): Observable<CarpoolUpiOrder> {
    return this.api.post<CarpoolUpiOrder>('/carpool/plan/upi/order', { plan_id: planId });
  }

  verifyPlanPayment(planId: number, payment: CarpoolPaymentResult): Observable<{ queued: boolean; subscription: CarpoolPlanPurchase; message: string }> {
    return this.api.post('/carpool/plan/upi/verify', { plan_id: planId, ...payment });
  }

  /** Driver Home: next carpool, the requests switch, recent trips (driver app). */
  driverHome(): Observable<CarpoolDriverHome> {
    return this.api.get<CarpoolDriverHome>('/carpool/driver/home');
  }

  /** The Carpools tab: Upcoming, Today or Past (driver app). */
  myListings(filter: CarpoolListFilter): Observable<CarpoolListing[]> {
    return this.api.get<{ data: CarpoolListing[] }>(`/carpool/driver/listings?filter=${filter}`).pipe(map((r) => r?.data ?? []));
  }

  listing(id: number): Observable<CarpoolListing> {
    return this.api.get<{ data: CarpoolListing }>(`/carpool/driver/listings/${id}`).pipe(map((r) => r.data));
  }

  publish(input: CarpoolPublishInput): Observable<CarpoolListing> {
    return this.api.post<{ data: CarpoolListing }>('/carpool/driver/listings', input).pipe(map((r) => r.data));
  }

  editListing(id: number, input: CarpoolEditInput): Observable<CarpoolListing> {
    return this.api.patch<{ data: CarpoolListing }>(`/carpool/driver/listings/${id}`, input).pipe(map((r) => r.data));
  }

  /** "+10 min delay". */
  delayListing(id: number): Observable<CarpoolListing> {
    return this.api.post<{ data: CarpoolListing }>(`/carpool/driver/listings/${id}/delay`, {}).pipe(map((r) => r.data));
  }

  cancelListing(id: number, note: string | null): Observable<CarpoolListing> {
    return this.api.post<{ data: CarpoolListing }>(`/carpool/driver/listings/${id}/cancel`, { note }).pipe(map((r) => r.data));
  }

  /** The Home "Requests on/off" switch for every carpool not yet started. */
  setRequests(on: boolean): Observable<boolean> {
    return this.api.post<{ requests_on: boolean }>('/carpool/driver/requests', { on }).pipe(map((r) => r.requests_on));
  }

  /* ── M4, driver app: join requests ── */

  inbox(): Observable<CarpoolInbox> {
    return this.api.get<CarpoolInbox>('/carpool/driver/inbox');
  }

  /** The Inbox tab badge. */
  inboxCount(): Observable<number> {
    return this.api.get<{ count: number }>('/carpool/driver/inbox/count').pipe(map((r) => r?.count ?? 0));
  }

  /** The rider profile (driver mockup 8c). */
  joinRequest(id: number): Observable<CarpoolRiderProfile> {
    return this.api.get<{ data: CarpoolRiderProfile }>(`/carpool/driver/join-requests/${id}`).pipe(map((r) => r.data));
  }

  acceptRequest(id: number): Observable<CarpoolJoinRequest> {
    return this.api.post<{ data: CarpoolJoinRequest }>(`/carpool/driver/join-requests/${id}/accept`, {}).pipe(map((r) => r.data), tap(() => this.answered$.next()));
  }

  declineRequest(id: number): Observable<CarpoolJoinRequest> {
    return this.api.post<{ data: CarpoolJoinRequest }>(`/carpool/driver/join-requests/${id}/decline`, {}).pipe(map((r) => r.data), tap(() => this.answered$.next()));
  }

  removeRider(id: number): Observable<CarpoolJoinRequest> {
    return this.api.post<{ data: CarpoolJoinRequest }>(`/carpool/driver/join-requests/${id}/remove`, {}).pipe(map((r) => r.data));
  }

  /** The driver's private Paid tick. */
  markPaid(id: number, paid: boolean): Observable<CarpoolJoinRequest> {
    return this.api.post<{ data: CarpoolJoinRequest }>(`/carpool/driver/join-requests/${id}/paid`, { paid }).pipe(map((r) => r.data));
  }

  /* ── M4, customer app: search and join ── */

  search(q: CarpoolSearchQuery): Observable<CarpoolSearchAnswer> {
    return this.api.get<CarpoolSearchAnswer>(`/carpool/search?${query(q)}`);
  }

  /** The carpool page. Pass the search to get the suggested pickup and drop. */
  ride(id: number, q?: Partial<CarpoolSearchQuery>): Observable<CarpoolRide> {
    const qs = q ? query(q) : '';
    return this.api.get<{ data: CarpoolRide }>(`/carpool/rides/${id}${qs ? `?${qs}` : ''}`).pipe(map((r) => r.data));
  }

  join(id: number, input: CarpoolJoinInput): Observable<CarpoolMyRequest> {
    return this.api.post<{ data: CarpoolMyRequest }>(`/carpool/rides/${id}/join`, input).pipe(map((r) => r.data));
  }

  /** Cancel a request the driver hasn't answered. */
  withdrawRequest(id: number): Observable<CarpoolMyRequest> {
    return this.api.post<{ data: CarpoolMyRequest }>(`/carpool/join-requests/${id}/withdraw`, {}).pipe(map((r) => r.data));
  }

  /** Leave a carpool after being accepted, before the ride starts. */
  leaveCarpool(id: number): Observable<CarpoolMyRequest> {
    return this.api.post<{ data: CarpoolMyRequest }>(`/carpool/join-requests/${id}/leave`, {}).pipe(map((r) => r.data));
  }

  /** Every carpool request the rider made, for My trips. */
  myTrips(): Observable<CarpoolTrip[]> {
    return this.api.get<{ data: CarpoolTrip[] }>('/carpool/trips').pipe(map((r) => r?.data ?? []));
  }

  /** The profile photo asked for at the first join request. */
  uploadPhoto(photo: Blob, fileName = 'photo.jpg'): Observable<{ avatar_path: string; avatar_url: string | null }> {
    const form = new FormData();
    form.append('photo', photo, fileName);
    return this.api.postForm('/carpool/rider/photo', form);
  }

  /* ── M5: chat (both apps) ── */

  chats(): Observable<CarpoolChatInbox> {
    return this.api.get<CarpoolChatInbox>('/carpool/chats');
  }

  /** Unread messages, for the badges. */
  chatsUnread(): Observable<number> {
    return this.api.get<{ count: number }>('/carpool/chats/unread').pipe(map((r) => r?.count ?? 0));
  }

  /** A conversation; pass the last message id seen to get only newer ones. */
  chat(id: number, after = 0): Observable<CarpoolChatThread> {
    return this.api.get<CarpoolChatThread>(`/carpool/chats/${id}${after ? `?after=${after}` : ''}`);
  }

  sendMessage(id: number, body: string): Observable<CarpoolChatMessage> {
    return this.api.post<{ data: CarpoolChatMessage }>(`/carpool/chats/${id}/messages`, { body }).pipe(map((r) => r.data));
  }

  markChatRead(id: number): Observable<unknown> {
    return this.api.post(`/carpool/chats/${id}/read`, {});
  }

  /** A rider asks to change their pickup; the point must be on the route. */
  proposePickup(id: number, p: CarpoolPickupInput): Observable<CarpoolChatMessage> {
    return this.api.post<{ data: CarpoolChatMessage }>(`/carpool/chats/${id}/pickup`, p).pipe(map((r) => r.data));
  }

  answerPickup(proposalId: number, accept: boolean): Observable<unknown> {
    return this.api.post(`/carpool/pickup-proposals/${proposalId}/${accept ? 'accept' : 'decline'}`, {});
  }

  report(input: CarpoolReportInput): Observable<unknown> {
    return this.api.post('/carpool/reports', input);
  }

  /** Forget the cached config, e.g. after logout. */
  reset(): void {
    this.config$ = null;
    this.fetchedAt = 0;
  }
}

/** A query string from the defined values only. */
function query(q: object): string {
  return Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

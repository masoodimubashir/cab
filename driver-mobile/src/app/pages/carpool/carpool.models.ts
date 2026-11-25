/**
 * Carpool API types. They follow the backend responses (Carpool.md section 9)
 * and grow milestone by milestone. Keep this file identical in customer-mobile
 * and driver-mobile.
 */

/**
 * GET /api/carpool/config. When `enabled` is false only `driver_signup` is sent:
 * private car owners can sign up before carpool opens to riders (A38).
 */
export interface CarpoolConfig {
  enabled: boolean;
  driver_signup?: boolean;
  search_distance_m?: number;
  publish_horizon_days?: number;
  /** Start ride opens this many minutes before departure (an admin setting). */
  start_early_minutes?: number;
  /** A waiting request on a ride on the road closes this many minutes after its planned pickup. */
  pending_expire_minutes?: number;
  /** Days after a plan's last day on which carpools still run. */
  plan_grace_days?: number;
  /** 0 = an unstarted carpool is cancelled at the end of its departure day, 1 = at the end of the next day. */
  missed_departure_days?: number;
  seats_max?: number;
  /** How many minutes the driver's delay button moves the departure. */
  delay_minutes?: number;
  message_max_chars?: number;
  chat_retention_days?: number;
  timezone?: string;
  /** Tile name and picture set in Operator Settings; null means use "Carpool" and the icon. */
  tile_name?: string | null;
  tile_image_url?: string | null;
  /** The reasons offered when reporting (admin-editable). Missing on an older server: the app keeps its built-in list. */
  report_reasons?: { key: string; label: string; applies_to: 'person' | 'message' | 'both' }[];
}

export const CARPOOL_OFF: CarpoolConfig = { enabled: false };

/** GET /api/carpool/plans: a plan the driver can buy (day-based, no commission). */
export interface CarpoolPlan {
  id: number;
  title: string;
  subtitle: string | null;
  amount: number;
  days_count: number;
  terms: string | null;
}

/** A bought plan, running or waiting to start. */
export interface CarpoolPlanPurchase {
  id: number;
  title: string;
  amount_paid: number;
  days_count: number;
  starts_at: string | null;
  expires_at: string | null;
  is_queued: boolean;
}

/** GET /api/carpool/plan. `can_publish` is the publish gate; `ending_soon` drives the Home warning. */
export interface CarpoolPlanState {
  plan: CarpoolPlanPurchase | null;
  next_plan: CarpoolPlanPurchase | null;
  can_publish: boolean;
  ending_soon: boolean;
}

/** POST /api/carpool/plan/upi/order: what Razorpay Checkout needs. */
export interface CarpoolUpiOrder {
  order_id: string;
  amount_paise: number;
  amount: number;
  currency: string;
  key_id: string;
  plan_id: number;
  plan_title: string;
}

export interface CarpoolPaymentResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/** A place on a carpool: `name` is short ("Bemina Bypass"), `address` the full line. */
export interface CarpoolPlace {
  lat: number;
  lng: number;
  name: string;
  address: string;
}

export type CarpoolListingStatus = 'published' | 'in_progress' | 'completed' | 'cancelled';

/** A driver's carpool (GET /api/carpool/driver/listings[/id]). `route_polyline` only on one carpool. */
export interface CarpoolListing {
  id: number;
  status: CarpoolListingStatus;
  start: CarpoolPlace;
  end: CarpoolPlace;
  route_summary: string | null;
  distance_m: number;
  duration_s: number;
  departs_at: string;
  /** India days from today: 0 today, 1 tomorrow, negative in the past. */
  departs_day: number;
  seats_total: number;
  seats_taken: number;
  price_per_seat: number;
  is_free: boolean;
  accepting_requests: boolean;
  cancel_reason: 'driver' | 'missed_departure' | 'plan_ended' | 'admin' | null;
  cancel_note: string | null;
  can_edit: boolean;
  /** M6: the ride. */
  started_at: string | null;
  completed_at: string | null;
  completed_by: 'driver' | 'auto' | null;
  counts_as_ride: boolean;
  /** Start ride opens before the departure time (see start_opens_at). */
  can_start: boolean;
  start_opens_at: string;
  route_polyline?: [number, number][];
  /** One carpool only: accepted riders in pickup order, and how many requests wait (M4). */
  riders?: CarpoolJoinRequest[];
  pending_count?: number;
  /** One carpool only (M6). Complete ride unlocks once every rider is dropped or a no-show. */
  can_complete?: boolean;
  riders_rode?: number;
  riders_picked_up?: number;
  group_chat_id?: number | null;
  chats_deleted?: boolean;
}

/** A route as the driver app sends it: a simplified line plus Google's numbers (Carpool.md P5). */
export interface CarpoolRoute {
  polyline: [number, number][];
  distance_m: number;
  duration_s: number;
  summary: string | null;
}

export interface CarpoolPublishInput {
  start: CarpoolPlace;
  end: CarpoolPlace;
  route: CarpoolRoute;
  departs_at: string;
  seats: number;
  is_free: boolean;
  price_per_seat: number | null;
  accepting_requests: boolean;
}

export type CarpoolEditInput = Partial<Pick<CarpoolPublishInput, 'route' | 'departs_at' | 'seats' | 'is_free' | 'price_per_seat' | 'accepting_requests'>>;

/** GET /api/carpool/driver/home. "Waiting for you": the soonest request in full, then the rest as a count. */
export interface CarpoolDriverHome {
  /** The driver's carpool access is paused: Home shows "Carpool access paused" instead of Publish (mockup "Carpool ban: driver"). */
  banned?: boolean;
  next: CarpoolListing | null;
  requests_on: boolean;
  has_live: boolean;
  recent: { start: CarpoolPlace; end: CarpoolPlace; departs_at: string }[];
  waiting: number;
  first_request: (CarpoolJoinRequest & { listing: CarpoolListingSummary }) | null;
  more: { count: number; routes: string[] };
}

export type CarpoolListFilter = 'upcoming' | 'today' | 'past';

/* ── M4: search and join ── */

/** Someone on the other side of a carpool. Never their phone number. Photos replace initials later. */
export interface CarpoolPerson {
  id?: number | null;
  name: string;
  first_name: string;
  initials: string;
  photo_url?: string | null;
}

/** A point on a carpool's route for one rider: a suggested or chosen pickup or drop. */
export interface CarpoolRoutePoint {
  lat: number;
  lng: number;
  name?: string;
  address?: string | null;
  /** Metres along the driver's route. */
  along_m?: number;
  /** Metres from the rider's own place (search results and suggestions). */
  walk_m?: number;
  /** When the car is expected there, at the planned speed. */
  at: string;
}

export type CarpoolRequestStatus =
  | 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'closed'
  | 'cancelled_by_rider' | 'removed' | 'no_show' | 'completed';

/** How a request stands from the rider's side (customer mockup 8 to 8l). */
export type CarpoolRiderState =
  | 'sent' | 'accepted' | 'started' | 'completed' | 'cancelled' | 'declined'
  | 'removed' | 'filled' | 'ended' | 'withdrawn' | 'left' | 'no_show';

/** Where a rider stands once the ride is on the road (driver mockup 9). */
export type CarpoolRideState = 'waiting' | 'picked_up' | 'dropped' | 'no_show';

/** A request as its rider sees it. `code` only while accepted on a carpool that hasn't ended. */
export interface CarpoolMyRequest {
  id: number;
  /** The private chat with the driver. */
  chat_id: number | null;
  listing_id: number;
  status: CarpoolRequestStatus;
  closed_reason: 'filled' | 'ended' | null;
  state: CarpoolRiderState;
  past: boolean;
  seats: number;
  price_per_seat: number;
  is_free: boolean;
  total: number;
  code: string | null;
  picked_up_at: string | null;
  dropped_at: string | null;
  no_show_at: string | null;
  /** Dropped off and not rated yet: shows Rate (customer 8f, 8g). */
  can_rate: boolean;
  /** Waiting for an answer while the car is already on the road (requests stay open, decided 2026-11-19). */
  on_road: boolean;
  /** While the ride is on the road: how far the car is, from the plan (no live location in v1). */
  ride: { picked_up: boolean; minutes_away: number; pickup_at: string; drop_at: string } | null;
  pickup: CarpoolRoutePoint;
  drop: CarpoolRoutePoint;
  created_at: string | null;
}

/** A row of My trips (GET /api/carpool/trips). */
export interface CarpoolTrip extends CarpoolMyRequest {
  listing: {
    status: CarpoolListingStatus;
    departs_at: string;
    day: number;
    start: { name: string };
    end: { name: string };
    cancel_reason: CarpoolListing['cancel_reason'];
  };
  driver: { name: string; first_name: string };
}

/** The driver as riders see them. Ratings arrive with M6. */
export interface CarpoolDriverCard extends CarpoolPerson {
  rating: number | null;
  rating_count: number;
  carpools_driven: number;
  /** Month approved, "2026-08". */
  since: string | null;
}

export interface CarpoolCar {
  label: string;
  make: string;
  model: string;
  colour: string;
  plate: string;
  seats: number;
  photo_url: string | null;
}

/** Why a carpool can't be asked to join: full, not enough seats, requests off, ended, or your own. */
export type CarpoolBlocked = 'full' | 'seats' | 'off' | 'ended' | 'own' | null;

export interface CarpoolSearchQuery {
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  /** India date, YYYY-MM-DD. */
  date: string;
  seats: number;
}

/** One search result (GET /api/carpool/search). */
export interface CarpoolResult {
  id: number;
  status: CarpoolListingStatus;
  departs_at: string;
  day: number;
  start: { name: string };
  end: { name: string };
  price_per_seat: number;
  is_free: boolean;
  seats_total: number;
  seats_free: number;
  driver: CarpoolDriverCard;
  car: CarpoolCar | null;
  pickup: CarpoolRoutePoint;
  drop: CarpoolRoutePoint;
  can_request: boolean;
  blocked: CarpoolBlocked;
  my_request: { id: number; status: CarpoolRequestStatus } | null;
}

export interface CarpoolSearchAnswer {
  results: CarpoolResult[];
  /** Only when the chosen day has nothing (customer mockup 3b). */
  other_days: { date: string; day: number; count: number; first_at: string }[];
  distance_m: number;
  /** The day has more carpools than the search looked at; the earliest are shown (S12). */
  truncated?: boolean;
}

/** The carpool page for a rider (GET /api/carpool/rides/{id}). */
export interface CarpoolRide {
  id: number;
  status: CarpoolListingStatus;
  departs_at: string;
  /** When the driver can press Start ride (set by the server). */
  start_opens_at?: string;
  day: number;
  start: CarpoolPlace;
  end: CarpoolPlace;
  route_polyline: [number, number][];
  distance_m: number;
  duration_s: number;
  price_per_seat: number;
  is_free: boolean;
  seats_total: number;
  seats_free: number;
  accepting_requests: boolean;
  cancel_reason: CarpoolListing['cancel_reason'];
  cancel_note: string | null;
  /** Set for a day after the driver changes the time or route (customer 8i). */
  changed: { kind: 'time' | 'route'; was_at: string | null } | null;
  driver: CarpoolDriverCard;
  car: CarpoolCar | null;
  /** Closest points on the route to the rider's search, when the search was passed. */
  suggested: { pickup: CarpoolRoutePoint; drop: CarpoolRoutePoint } | null;
  can_request: boolean;
  blocked: CarpoolBlocked;
  /** The rider's carpool access is paused: Request to join shows the ban sheet (mockup "Carpool ban: rider"). */
  banned?: boolean;
  my_request: CarpoolMyRequest | null;
  /** 4b: how soon a carpool already on the road reaches the suggested pickup (negative = probably passed). */
  on_road: { minutes_to_pickup: number; started_at: string } | null;
  group_chat_id: number | null;
  /** The chats of this carpool were deleted after the retention time (B1, Option A). */
  chat_deleted: boolean;
  started_at: string | null;
  completed_at: string | null;
}

/** POST .../check-code (driver mockup 11, 11b). */
export interface CarpoolCodeCheck {
  ok: boolean;
  tries_left: number;
  /** Set while checking is locked after too many wrong codes. */
  locked_until: string | null;
}

export interface CarpoolJoinInput {
  seats: number;
  /** Set when the rider chose "Ask anyway" after being told they have a carpool at the same time. */
  confirm_overlap?: boolean;
  pickup: { lat: number; lng: number; name: string; address?: string | null };
  drop: { lat: number; lng: number; name: string; address?: string | null };
}

/** A join request as the driver sees it (Home card, Inbox, riders list). */
export interface CarpoolJoinRequest {
  id: number;
  listing_id: number;
  status: CarpoolRequestStatus;
  rider: CarpoolPerson;
  seats: number;
  price_per_seat: number;
  is_free: boolean;
  total: number;
  /** The driver's private Paid tick. Riders never see it. */
  paid_marked: boolean;
  /** The private chat with this rider. */
  chat_id: number | null;
  /** M6: waiting, picked up, dropped or no-show, and the code check. */
  ride_state: CarpoolRideState;
  /** Minutes the car should be past this waiting request's pickup, by the plan; null unless the ride is on the road. */
  pickup_passed_min: number | null;
  picked_up_at: string | null;
  dropped_at: string | null;
  no_show_at: string | null;
  code_verified: boolean;
  code_locked_until: string | null;
  pickup: CarpoolRoutePoint & { name: string };
  drop: CarpoolRoutePoint & { name: string };
  created_at: string | null;
}

/** A carpool's headline in driver lists. */
export interface CarpoolListingSummary {
  id: number;
  status: CarpoolListingStatus;
  start: { name: string };
  end: { name: string };
  departs_at: string;
  day: number;
  seats_total: number;
  seats_taken: number;
  seats_free: number;
  price_per_seat: number;
  is_free: boolean;
}

/** GET /api/carpool/driver/inbox. Chats join the containers in M5. */
export interface CarpoolInbox {
  active: { listing: CarpoolListingSummary; requests: CarpoolJoinRequest[] }[];
  past: unknown[];
  count: number;
}

/** GET /api/carpool/driver/join-requests/{id}: the rider profile (driver mockup 8c). */
export interface CarpoolRiderProfile extends CarpoolJoinRequest {
  profile: { joined: string | null; phone_verified: boolean; photo_added: boolean; carpools_taken: number };
  listing: CarpoolListingSummary;
}

/* ── M5: chat ── */

export type CarpoolChatKind = 'group' | 'direct';
/** A report reason key. The five built-ins (spam, harassment, unsafe, photo, other) plus any the admin adds. */
export type CarpoolReportReason = string;

/** One rider's own trip, for the card in their private chat: their pickup, their drop, seats and price. */
export interface CarpoolChatTrip {
  /** sent, accepted, started, completed, cancelled, declined, removed ... (CarpoolPresenter::riderState). */
  state: string;
  seats: number;
  price_per_seat: number;
  is_free: boolean;
  paid_marked: boolean;
  rider_first_name: string;
  pickup: { name: string; at: string };
  drop: { name: string; at: string };
}

export interface CarpoolChatConversation {
  id: number;
  kind: CarpoolChatKind;
  /** "Group chat" or "Sana, private". */
  title: string;
  request_id: number | null;
  is_driver: boolean;
  other_initials: string | null;
  other_first_name: string | null;
  other_user_id: number | null;
  driver_first_name: string;
  pickup_name: string | null;
  car_label?: string | null;
  /** Private chats only: the rider's own trip. The group chat has none and shows the whole carpool. */
  trip?: CarpoolChatTrip | null;
  /** Group chats only: first names, the driver first and "You" last. */
  member_names?: string[] | null;
  listing: CarpoolListingSummary;
  members: number;
}

export interface CarpoolChatMessage {
  id: number;
  conversation_id: number;
  type: 'text' | 'pickup_request' | 'system';
  body: string;
  removed: boolean;
  /** Banned words were replaced with dots (mockup "Chat: moderation"). */
  masked: boolean;
  sender: { id: number; first_name: string; initials: string; is_driver: boolean } | null;
  mine: boolean;
  proposal: {
    id: number;
    status: 'pending' | 'accepted' | 'declined' | 'replaced';
    name: string;
    address: string | null;
    lat: number;
    lng: number;
    /** The rider asks for a spot; the driver can answer with another one (mockup 14b). */
    proposed_by: 'rider' | 'driver';
    /** Whose pickup it is, so the driver can answer in the group chat. */
    request_id: number;
    rider_first_name: string;
    /** True for the rider whose pickup it is. In the group chat everyone else just reads the card. */
    for_me: boolean;
  } | null;
  created_at: string;
  /** App only: a message still being sent, or one that failed. */
  local?: 'sending' | 'failed';
}

export interface CarpoolChatRow {
  conversation: CarpoolChatConversation;
  unread: number;
  last: CarpoolChatMessage | null;
  writable: boolean;
}

/** GET /api/carpool/chats: one container per carpool, Active and Past. */
export interface CarpoolChatBox {
  listing: CarpoolListingSummary;
  unread: number;
  conversations: CarpoolChatRow[];
  /** The chats of this trip were deleted after the retention time; the trip stays under Past (B1, Option A). */
  chats_deleted?: boolean;
}

export interface CarpoolChatInbox {
  active: CarpoolChatBox[];
  past: CarpoolChatBox[];
  /** There are older trips whose chats were deleted: ask for the next page (S12). */
  past_more?: boolean;
  unread: number;
  /** Days a chat is kept after the trip ends (admin setting). */
  retention_days: number;
}

export interface CarpoolChatThread {
  conversation: CarpoolChatConversation;
  messages: CarpoolChatMessage[];
  writable: boolean;
  /** There are messages older than the first one returned: offer "Show earlier messages" (S12). */
  has_more_before?: boolean;
  /** Where this person had read up to when the chat opened (for the unread divider, mockup 14). */
  last_read_message_id: number;
  /** The saved route, thinned, for the mini map on pickup cards. */
  route: [number, number][];
  retention_days: number;
  /** The server's message length limit (config), so the app never repeats the number. */
  message_max_chars: number;
  /** Where each pickup card stands now (proposal id to status), so cards already on screen update. */
  proposal_states: Record<string, 'pending' | 'accepted' | 'declined' | 'replaced'>;
}

export interface CarpoolPickupInput {
  lat: number;
  lng: number;
  name: string;
  address?: string | null;
  /** Driver, in the group chat: which rider's pickup this answers. */
  request_id?: number;
}

export interface CarpoolReportInput {
  reason: CarpoolReportReason;
  details?: string;
  message_id?: number;
  user_id?: number;
  listing_id?: number;
}

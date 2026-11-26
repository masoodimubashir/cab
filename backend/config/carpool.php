<?php

/*
| Carpool module settings that are fixed in code.
|
| The four admin-editable settings (enabled, search distance, auto-complete
| hours, chat retention) live in the `carpool_settings` table instead. Each
| value here names the spec item it comes from (Carpool.md) so an answer from
| the client is a one-line change.
*/

return [

    // Emergency stop (spec P1). When true, every /api/carpool route returns
    // 404, /api/carpool/config reports carpool as off and carpool:* scheduler
    // commands do nothing. Deploy with this on; turn it off only for a pilot.
    'kill_switch' => (bool) env('CARPOOL_KILL_SWITCH', false),

    // All carpool "day" rules use India time (spec P8). Storage stays UTC.
    'timezone' => 'Asia/Kolkata',

    // Publishing horizon in days, counted from today in India time (assumption, section 2).
    'publish_horizon_days' => 30,

    // A plan warning shows this many days before a plan ends (section 10, fixed values).
    'plan_warning_days' => (int) env('CARPOOL_PLAN_WARNING_DAYS', 3),
    // Hours before a plan ends that the reminder push goes out (admin setting plan_push_hours since W4).
    'plan_push_hours' => (int) env('CARPOOL_PLAN_PUSH_HOURS', 24),
    // Days before a dated document (insurance) runs out the driver is warned (admin setting document_warning_days, S11).
    'document_warning_days' => (int) env('CARPOOL_DOCUMENT_WARNING_DAYS', 7),

    // Pickup proposals must be this close to the route (P9, same check as Fixed pins).
    'pickup_max_distance_m' => (int) env('CARPOOL_PICKUP_MAX_DISTANCE_M', 300),

    // List sizes (S12). Each list is shown in pages of this size; the apps ask for the next page.
    'trips_page_size' => (int) env('CARPOOL_TRIPS_PAGE_SIZE', 100),
    'past_page_size' => (int) env('CARPOOL_PAST_PAGE_SIZE', 50),
    'thread_page_size' => (int) env('CARPOOL_THREAD_PAGE_SIZE', 100),
    // The search looks at the earliest this many carpools of the day and says so when there are more.
    'search_max_candidates' => (int) env('CARPOOL_SEARCH_MAX_CANDIDATES', 300),

    // Chat message length limit (P9: 1,000 characters, fixed in code, not an admin setting).
    'message_max_chars' => 1000,

    // Chat rate limit (P9 says "a rate limit" without a number; 20 a minute is our proposal, decided 2026-11-19).
    'messages_per_minute' => (int) env('CARPOOL_MESSAGES_PER_MINUTE', 20),

    // Rider code checks (section 10, proposed): wrong tries before a lock, and the lock length.
    'code_max_attempts' => (int) env('CARPOOL_CODE_MAX_ATTEMPTS', 3),
    'code_lock_minutes' => (int) env('CARPOOL_CODE_LOCK_MINUTES', 5),

    // Days after a plan's last day on which carpools still run (A16). The admin setting plan_grace_days
    // overrides this; it is the fallback and the default of a new settings row.
    'plan_grace_days' => (int) env('CARPOOL_PLAN_GRACE_DAYS', 1),

    // Start ride opens this long before the departure time (our proposal, M6).
    'start_early_minutes' => 60,

    // HARD-CODED, to review for admin Settings: a waiting request on a ride on the road closes this many
    // minutes after its planned pickup time (Saqib, 2026-11-19).
    'pending_expire_after_pickup_minutes' => 15,

    // A driver's average shows only after this many ratings, so one early 1-star doesn't define them.
    'rating_min_count' => (int) env('CARPOOL_RATING_MIN_COUNT', 3),

    // The hourly lifecycle job must have run within this many hours, or carpool:heartbeat fails.
    'heartbeat_stale_hours' => 3,

    // Seats a carpool driver can offer (section 2, driver sign-up).
    'seats_min' => (int) env('CARPOOL_SEATS_MIN', 1),
    'seats_max' => (int) env('CARPOOL_SEATS_MAX', 6),

    // Stored route lines are simplified to at most this many points (P5).
    'route_max_points' => 500,

    // Route check on publish (P5). Google snaps the ends to the nearest road, so
    // the route's first and last points may sit a little away from the places.
    'route_endpoint_max_m' => 2000,
    'route_min_m' => (int) env('CARPOOL_ROUTE_MIN_M', 1000),
    'route_max_m' => (int) env('CARPOOL_ROUTE_MAX_M', 1500000),

    // Shortest ride a rider can ask for, in metres: the pickup must be at least this far before the drop.
    'min_ride_m' => (float) env('CARPOOL_MIN_RIDE_M', 300),

    // How long a rider sees "the driver changed or delayed this carpool" on the carpool page.
    'changed_notice_hours' => (int) env('CARPOOL_CHANGED_NOTICE_HOURS', 24),

    // Upload size limits in kilobytes: the profile photo (driver sign-up and rider photo), and the car photos.
    'photo_max_kb' => (int) env('CARPOOL_PHOTO_MAX_KB', 4096),
    'car_photo_max_kb' => (int) env('CARPOOL_CAR_PHOTO_MAX_KB', 6144),

    // Per-person limits on actions that create things (publish, join, report) and on search, per minute.
    // They were typed into AppServiceProvider until hardening slice S3.
    'rate_limit_write_per_minute' => (int) env('CARPOOL_RATE_LIMIT_WRITE_PER_MINUTE', 20),
    'rate_limit_search_per_minute' => (int) env('CARPOOL_RATE_LIMIT_SEARCH_PER_MINUTE', 60),

    // "+10 min delay" on the carpool page (mockup screen 8).
    'delay_minutes' => (int) env('CARPOOL_DELAY_MINUTES', 10),

    // Defaults for the one carpool_settings row (section 10, Carpool > Settings).
    'defaults' => [
        'enabled' => false,             // Off until launch
        'search_distance_m' => 2000,    // A19: 2 km (range 1-10 km)
        'auto_complete_hours' => 12,    // A11: 12 hours (range 1-48)
        'chat_retention_days' => 1,     // 1 day (range 1-30)
        'publish_horizon_days' => 30,   // S4: 30 days ahead
        'start_early_minutes' => 60,    // S4: Start ride opens 60 minutes before departure
        'pending_expire_minutes' => 15, // S4: waiting request closes 15 minutes after the planned pickup
        'plan_grace_days' => 1,         // S4: plan end day plus 1 day
        'missed_departure_days' => 0, // S4: 0 = cancel at the end of the departure day, 1 = at the end of the next day
        'plan_warning_days' => 3,       // admin setting since 2026-11-25 (falls back to plan_warning_days above)
        'plan_push_hours' => 24,        // admin setting since W4 (falls back to plan_push_hours above)
        'document_warning_days' => 7,   // S11: warn about a document running out this many days ahead
        'report_retention_days' => 180, // closed reports keep their message text this long
    ],

    // Closed reports keep the reported message text this long (admin setting report_retention_days).
    'report_retention_days' => (int) env('CARPOOL_REPORT_RETENTION_DAYS', 180),

    // How long the settings row is cached; saving it clears the cache.
    'settings_cache_seconds' => 300,
];

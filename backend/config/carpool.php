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
    'plan_warning_days' => 3,

    // Pickup proposals must be this close to the route (P9, same check as Fixed pins).
    'pickup_max_distance_m' => 300,

    // Chat message length limit (P9).
    'message_max_chars' => 1000,

    // Rider code checks (section 10, proposed): wrong tries before a lock, and the lock length.
    'code_max_attempts' => 3,
    'code_lock_minutes' => 5,

    // Seats a carpool driver can offer (section 2, driver sign-up).
    'seats_min' => 1,
    'seats_max' => 6,

    // Stored route lines are simplified to at most this many points (P5).
    'route_max_points' => 500,

    // Defaults for the one carpool_settings row (section 10, Carpool > Settings).
    'defaults' => [
        'enabled' => false,             // Off until launch
        'search_distance_m' => 2000,    // A19: 2 km (range 1-10 km)
        'auto_complete_hours' => 12,    // A11: 12 hours (range 1-48)
        'chat_retention_days' => 1,     // 1 day (range 1-30)
    ],

    // How long the settings row is cached; saving it clears the cache.
    'settings_cache_seconds' => 300,
];

<?php

/*
| Developer hub: test people, scenarios and a time offset for the carpool test apps.
| Off unless DEV_HUB=true, and it never runs outside APP_ENV=local.
*/
return [
    'enabled' => (bool) env('DEV_HUB', false),
];

<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // MSG91 SMS gateway (login OTP). Leave MSG91_AUTH_KEY blank to run in MOCK
    // mode: no SMS is sent — the code is logged + returned in the API response
    // so you can test the whole flow. Fill the keys to send real SMS.
    'msg91' => [
        'authkey' => env('MSG91_AUTH_KEY', ''),
        'template_id' => env('MSG91_TEMPLATE_ID', ''),   // DLT-approved flow template id
        'sender' => env('MSG91_SENDER_ID', ''),
        'otp_var' => env('MSG91_OTP_VAR', 'otp'),         // variable name in your template
        'flow_url' => env('MSG91_FLOW_URL', 'https://control.msg91.com/api/v5/flow'),
        'otp_ttl_min' => (int) env('MSG91_OTP_TTL_MIN', 5),
        'resend_cooldown_sec' => (int) env('MSG91_OTP_RESEND_SEC', 30),
        'max_attempts' => (int) env('MSG91_OTP_MAX_ATTEMPTS', 5),
        'default_message' => env('MSG91_DEFAULT_OTP_MESSAGE', '{otp} is your verification code. Valid for {ttl} minutes.'),
    ],

];

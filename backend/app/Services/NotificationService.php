<?php

namespace App\Services;

use App\Models\DeviceToken;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Kreait\Firebase\Exception\Messaging\NotFound;
use Kreait\Firebase\Exception\MessagingException;
use Kreait\Firebase\Factory;
use Kreait\Firebase\Messaging;
use Kreait\Firebase\Messaging\CloudMessage;
use Kreait\Firebase\Messaging\Notification;

class NotificationService
{
    private ?Messaging $messaging = null;

    public function __construct()
    {
        $credentialsPath = env('FIREBASE_CREDENTIALS_PATH');
        if (!$credentialsPath || !is_readable($credentialsPath)) {
            Log::warning('FCM push disabled; FIREBASE_CREDENTIALS_PATH is missing or unreadable.', [
                'path' => $credentialsPath,
            ]);
            return;
        }

        try {
            $this->messaging = (new Factory())
                ->withServiceAccount($credentialsPath)
                ->createMessaging();
        } catch (\Throwable $e) {
            Log::warning('FCM push disabled; Firebase messaging could not be initialised.', [
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Send a notification to all of a user's registered devices.
     * Dead tokens are pruned automatically.
     *
     * @param  array<string, mixed>  $data  string-only payload data (FCM requires string values).
     */
    public function sendToUser(User $user, string $title, string $body, array $data = []): void
    {
        if ($user->push_unsubscribed) {
            return;
        }

        if (!$this->messaging) {
            return;
        }

        $tokens = DeviceToken::query()
            ->where('user_id', $user->id)
            ->pluck('token', 'id')
            ->all();

        if (empty($tokens)) {
            return;
        }

        $stringData = array_map(static fn ($v) => is_scalar($v) ? (string) $v : json_encode($v), $data);

        $androidConfig = [
            'priority' => 'high',
            'notification' => [
                'channel_id' => 'ride_requests',
                'sound' => 'default',
                'priority' => 'high',
                'visibility' => 'public',
                'default_vibrate_timings' => true,
                'default_sound' => true,
            ],
        ];
        $apnsConfig = [
            'headers' => [
                'apns-priority' => '10',
            ],
            'payload' => [
                'aps' => [
                    'sound' => 'default',
                    'content-available' => 1,
                ],
            ],
        ];

        foreach ($tokens as $tokenId => $token) {
            $message = CloudMessage::new()
                ->withToken($token)
                ->withNotification(Notification::create($title, $body))
                ->withData($stringData)
                ->withHighestPossiblePriority()
                ->withAndroidConfig($androidConfig)
                ->withApnsConfig($apnsConfig);

            try {
                $this->messaging->send($message);
            } catch (NotFound) {
                DeviceToken::query()->whereKey($tokenId)->delete();
            } catch (MessagingException $e) {
                Log::warning('FCM send failed', [
                    'user_id' => $user->id,
                    'token_id' => $tokenId,
                    'message' => $e->getMessage(),
                ]);
            }
        }
    }
}

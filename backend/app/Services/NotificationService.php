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
    private Messaging $messaging;

    public function __construct()
    {
        $credentialsPath = env('FIREBASE_CREDENTIALS_PATH');
        if (!$credentialsPath) {
            throw new \RuntimeException('Missing FIREBASE_CREDENTIALS_PATH env var.');
        }

        $this->messaging = (new Factory())
            ->withServiceAccount($credentialsPath)
            ->createMessaging();
    }

    /**
     * Send a notification to all of a user's registered devices.
     * Dead tokens are pruned automatically.
     *
     * @param  array<string, mixed>  $data  string-only payload data (FCM requires string values).
     */
    public function sendToUser(User $user, string $title, string $body, array $data = []): void
    {
        $tokens = DeviceToken::query()
            ->where('user_id', $user->id)
            ->pluck('token', 'id')
            ->all();

        if (empty($tokens)) {
            return;
        }

        $stringData = array_map(static fn ($v) => is_scalar($v) ? (string) $v : json_encode($v), $data);

        foreach ($tokens as $tokenId => $token) {
            $message = CloudMessage::withTarget('token', $token)
                ->withNotification(Notification::create($title, $body))
                ->withData($stringData);

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

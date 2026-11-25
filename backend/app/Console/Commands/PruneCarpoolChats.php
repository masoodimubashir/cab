<?php

namespace App\Console\Commands;

use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolSetting;
use App\Services\Carpool\CarpoolChatService;
use App\Services\Carpool\CarpoolJobStatus;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Deletes carpool chats a set time after the trip ends (Carpool.md section 2, admin setting), and
 * blanks the message text of closed reports after report_retention_days (Admin-Audit.md J-02).
 * The report row and its outcome stay.
 */
class PruneCarpoolChats extends Command
{
    protected $signature = 'carpool:prune-chats';

    protected $description = 'Delete carpool chats past the retention time and old report text';

    public function handle(CarpoolChatService $chat): int
    {
        $errors = [];
        try {
            $this->info('Deleted ' . $chat->prune() . ' conversations.');
        } catch (\Throwable $e) {
            $errors[] = 'chats: ' . $e->getMessage();
        }
        try {
            $this->info('Report texts cleared: ' . self::clearOldReportText());
        } catch (\Throwable $e) {
            $errors[] = 'reports: ' . $e->getMessage();
        }
        if ($errors) {
            Log::error('carpool:prune-chats failed', ['errors' => $errors]);
        }
        CarpoolJobStatus::finished($this->getName(), $errors ? implode(' | ', $errors) : null);

        return $errors ? self::FAILURE : self::SUCCESS;
    }

    public static function clearOldReportText(): int
    {
        $days = CarpoolSetting::number('report_retention_days');

        return CarpoolReport::query()->where('status', '!=', 'open')
            ->where('updated_at', '<', now()->subDays($days))
            ->where(fn ($q) => $q->whereNotNull('message_text')->orWhereNotNull('original_text')->orWhereNotNull('details'))
            ->update(['message_text' => null, 'original_text' => null, 'details' => null]);
    }
}

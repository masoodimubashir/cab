<?php

namespace App\Console\Commands;

use App\Services\Carpool\CarpoolChatService;
use Illuminate\Console\Command;

/** Deletes carpool chats a set time after the trip ends (Carpool.md section 2, admin setting). */
class PruneCarpoolChats extends Command
{
    protected $signature = 'carpool:prune-chats';

    protected $description = 'Delete carpool chats past the retention time';

    public function handle(CarpoolChatService $chat): int
    {
        $this->info('Deleted ' . $chat->prune() . ' conversations.');

        return self::SUCCESS;
    }
}

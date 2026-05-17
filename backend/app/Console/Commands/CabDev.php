<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class CabDev extends Command
{
    protected $signature = 'cab:dev
                            {--host=0.0.0.0 : Host for serve + reverb}
                            {--port=8000 : HTTP API port}
                            {--reverb-port=8080 : WebSocket port}';

    protected $description = 'Start serve, reverb, queue:work, and schedule:work together with prefixed output. Ctrl+C stops them all.';

    public function handle(): int
    {
        $php = (defined('PHP_BINARY') && PHP_BINARY) ? PHP_BINARY : 'php';
        $artisan = base_path('artisan');

        $host = $this->option('host');
        $port = $this->option('port');
        $reverbPort = $this->option('reverb-port');

        $services = [
            'serve'  => [$php, $artisan, 'serve', "--host={$host}", "--port={$port}"],
            'reverb' => [$php, $artisan, 'reverb:start', "--host={$host}", "--port={$reverbPort}"],
            'queue'  => [$php, $artisan, 'queue:work', '--tries=3', '--sleep=1'],
            'sched'  => [$php, $artisan, 'schedule:work'],
        ];

        $colors = [
            'serve'  => 'cyan',
            'reverb' => 'magenta',
            'queue'  => 'yellow',
            'sched'  => 'green',
        ];

        $this->info('[cab:dev] Starting services…');
        $this->line("[cab:dev]   HTTP API:  http://{$host}:{$port}/api");
        $this->line("[cab:dev]   WebSocket: ws://{$host}:{$reverbPort}");
        $this->line('[cab:dev]   Ctrl+C to stop everything.');
        $this->newLine();

        /** @var array<string, Process> $processes */
        $processes = [];
        foreach ($services as $label => $cmd) {
            $proc = new Process($cmd, base_path(), null, null, null);
            $proc->setPty(Process::isPtySupported());
            $proc->start();
            $processes[$label] = $proc;
        }

        $shuttingDown = false;
        $shutdown = function () use (&$processes, &$shuttingDown) {
            if ($shuttingDown) {
                return;
            }
            $shuttingDown = true;
            $this->newLine();
            $this->warn('[cab:dev] Shutting down…');
            foreach ($processes as $proc) {
                if ($proc->isRunning()) {
                    $proc->stop(5, SIGTERM);
                }
            }
        };

        if (function_exists('pcntl_async_signals')) {
            pcntl_async_signals(true);
            pcntl_signal(SIGINT, $shutdown);
            pcntl_signal(SIGTERM, $shutdown);
        }

        while (! $shuttingDown) {
            $anyRunning = false;
            foreach ($processes as $label => $proc) {
                foreach (['out' => $proc->getIncrementalOutput(), 'err' => $proc->getIncrementalErrorOutput()] as $stream => $chunk) {
                    if ($chunk === '') {
                        continue;
                    }
                    $color = $colors[$label] ?? 'white';
                    foreach (preg_split('/\r\n|\r|\n/', rtrim($chunk, "\r\n")) as $line) {
                        $this->line("<fg={$color}>[{$label}]</> {$line}");
                    }
                }
                if ($proc->isRunning()) {
                    $anyRunning = true;
                } else {
                    $this->error("[cab:dev] '{$label}' exited (code {$proc->getExitCode()}). Stopping the rest.");
                    $shutdown();
                    break;
                }
            }
            if (! $anyRunning) {
                break;
            }
            usleep(150_000);
        }

        foreach ($processes as $proc) {
            if ($proc->isRunning()) {
                $proc->stop(5, SIGTERM);
            }
        }

        $this->info('[cab:dev] Bye.');

        return self::SUCCESS;
    }
}

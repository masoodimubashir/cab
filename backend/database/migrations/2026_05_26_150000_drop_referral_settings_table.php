<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::dropIfExists('referral_settings');
    }

    public function down(): void
    {
        // Forward-only removal — the original create_referral_settings_table
        // migration is no longer referenced, so reverting requires restoring
        // that file (or a fresh DB rebuild from the historical migrations).
    }
};

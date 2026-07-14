<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table("fixed_seat_holds", function (Blueprint $table) {
            if (!Schema::hasColumn("fixed_seat_holds", "original_amount")) {
                $table->decimal("original_amount", 10, 2)->nullable()->after("amount");
            }
            if (!Schema::hasColumn("fixed_seat_holds", "discount_amount")) {
                $table->decimal("discount_amount", 10, 2)->nullable()->after("original_amount");
            }
            if (!Schema::hasColumn("fixed_seat_holds", "coupon_assignment_id")) {
                $table->foreignId("coupon_assignment_id")->nullable()->after("discount_amount")->constrained("coupon_assignments")->nullOnDelete();
            }
        });

        Schema::table("seat_reservations", function (Blueprint $table) {
            if (!Schema::hasColumn("seat_reservations", "coupon_assignment_id")) {
                $afterColumn = Schema::hasColumn("seat_reservations", "promo_discount_amount") ? "promo_discount_amount" : "fare_amount";
                $table->foreignId("coupon_assignment_id")->nullable()->after($afterColumn)->constrained("coupon_assignments")->nullOnDelete();
            }
            if (!Schema::hasColumn("seat_reservations", "promo_discount_amount")) {
                $table->decimal("promo_discount_amount", 10, 2)->nullable()->after("coupon_assignment_id");
            }
        });
    }

    public function down(): void
    {
        Schema::table("seat_reservations", function (Blueprint $table) {
            if (Schema::hasColumn("seat_reservations", "coupon_assignment_id")) {
                $table->dropConstrainedForeignId("coupon_assignment_id");
            }
        });

        Schema::table("fixed_seat_holds", function (Blueprint $table) {
            if (Schema::hasColumn("fixed_seat_holds", "coupon_assignment_id")) {
                $table->dropConstrainedForeignId("coupon_assignment_id");
            }
            if (Schema::hasColumn("fixed_seat_holds", "discount_amount")) {
                $table->dropColumn("discount_amount");
            }
            if (Schema::hasColumn("fixed_seat_holds", "original_amount")) {
                $table->dropColumn("original_amount");
            }
        });
    }
};
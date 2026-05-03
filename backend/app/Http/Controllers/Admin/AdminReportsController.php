<?php

namespace App\Http\Controllers\Admin;

use App\Models\FareNegotiation;
use App\Models\Payment;
use App\Models\Trip;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminReportsController
{
    public function index(Request $request)
    {
        $days = (int) $request->query('days', 7);
        $days = max(1, min($days, 30));

        $start = now()->subDays($days - 1)->startOfDay();

        $earningsByDay = [];
        $completedTripsByDay = [];
        $negotiationsByDay = [];

        for ($i = 0; $i < $days; $i++) {
            $dayStart = (clone $start)->addDays($i);
            $dayEnd = (clone $dayStart)->endOfDay();

            $earningsByDay[] = [
                'date' => $dayStart->toDateString(),
                'earnings' => (float) Payment::query()
                    ->where('status', 'SUCCESS')
                    ->whereNotNull('paid_at')
                    ->whereBetween('paid_at', [$dayStart, $dayEnd])
                    ->sum('amount'),
            ];

            $completedTripsByDay[] = [
                'date' => $dayStart->toDateString(),
                'count' => Trip::query()
                    ->where('status', 'COMPLETED')
                    ->whereBetween('completed_at', [$dayStart, $dayEnd])
                    ->count(),
            ];

            $negotiationsByDay[] = [
                'date' => $dayStart->toDateString(),
                'count' => FareNegotiation::query()
                    ->whereBetween('created_at', [$dayStart, $dayEnd])
                    ->count(),
            ];
        }

        $paymentAgg = Payment::query()
            ->whereNotNull('paid_at')
            ->whereBetween('paid_at', [$start, now()->endOfDay()])
            ->selectRaw('
                SUM(CASE WHEN status = "SUCCESS" THEN amount ELSE 0 END) as success_amount,
                SUM(CASE WHEN status != "SUCCESS" THEN 1 ELSE 0 END) as non_success_count,
                COUNT(*) as total_count,
                SUM(CASE WHEN status = "SUCCESS" THEN 1 ELSE 0 END) as success_count
            ')
            ->first();

        $successCount = (int) ($paymentAgg?->success_count ?? 0);
        $totalCount = (int) ($paymentAgg?->total_count ?? 0);
        $paymentSuccessRate = $totalCount > 0 ? round(($successCount / $totalCount) * 100, 2) : 0.0;

        return response()->json([
            'days' => $days,
            'range_start' => $start->toDateString(),
            'range_end' => now()->toDateString(),
            'earnings_by_day' => $earningsByDay,
            'completed_trips_by_day' => $completedTripsByDay,
            'negotiations_by_day' => $negotiationsByDay,
            'payment_success_rate_percent' => $paymentSuccessRate,
        ]);
    }
}


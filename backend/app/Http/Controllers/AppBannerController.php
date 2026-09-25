<?php

namespace App\Http\Controllers;

use App\Models\AppBanner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AppBannerController extends Controller
{
    /**
     * Retrieve active banners for mobile clients (customer or driver).
     */
    public function index(Request $request): JsonResponse
    {
        $app = $request->query('app', 'customer');
        if (!in_array($app, [AppBanner::TARGET_CUSTOMER, AppBanner::TARGET_DRIVER], true)) {
            $app = AppBanner::TARGET_CUSTOMER;
        }

        $banners = AppBanner::query()
            ->active()
            ->forApp($app)
            ->orderBy('sort_order')
            ->orderByDesc('id')
            ->get();

        return response()->json([
            'data' => $banners,
        ]);
    }
}

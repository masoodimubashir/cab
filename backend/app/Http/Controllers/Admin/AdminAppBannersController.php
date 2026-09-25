<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppBanner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class AdminAppBannersController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = AppBanner::query();

        if ($request->filled('target_app')) {
            $query->where('target_app', $request->query('target_app'));
        }

        if ($request->filled('position')) {
            $query->where('position', $request->query('position'));
        }

        if ($request->has('is_active') && $request->query('is_active') !== '' && $request->query('is_active') !== null) {
            $query->where('is_active', filter_var($request->query('is_active'), FILTER_VALIDATE_BOOLEAN));
        }

        if ($request->filled('search')) {
            $term = '%' . trim((string) $request->query('search')) . '%';
            $query->where('title', 'like', $term);
        }

        $banners = $query->orderBy('sort_order')
            ->orderByDesc('id')
            ->get();

        return response()->json([
            'data' => $banners,
            'meta' => [
                'total' => $banners->count(),
                'active' => $banners->where('is_currently_active', true)->count(),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:160'],
            'image' => ['required', 'file', 'image', 'max:8192'],
            'url_link' => ['nullable', 'url', 'max:500'],
            'target_app' => ['required', 'in:customer,driver,both'],
            'position' => ['required', 'in:full_screen,half'],
            'is_active' => ['nullable', 'boolean'],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date', 'after_or_equal:starts_at'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);

        $imagePath = $request->file('image')->store('app_banners', 'public');

        $banner = AppBanner::query()->create([
            'title' => trim($data['title']),
            'image_path' => $imagePath,
            'url_link' => !empty($data['url_link']) ? trim($data['url_link']) : null,
            'target_app' => $data['target_app'],
            'position' => $data['position'],
            'is_active' => $request->has('is_active') ? $request->boolean('is_active') : true,
            'starts_at' => !empty($data['starts_at']) ? $data['starts_at'] : null,
            'ends_at' => !empty($data['ends_at']) ? $data['ends_at'] : null,
            'sort_order' => (int) ($data['sort_order'] ?? 0),
        ]);

        return response()->json([
            'data' => $banner->fresh(),
            'banner' => $banner->fresh(),
            'message' => 'Banner created successfully.',
        ], 201);
    }

    public function show(AppBanner $banner): JsonResponse
    {
        return response()->json([
            'data' => $banner,
        ]);
    }

    public function update(Request $request, AppBanner $banner): JsonResponse
    {
        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:160'],
            'image' => ['nullable', 'file', 'image', 'max:8192'],
            'url_link' => ['nullable', 'url', 'max:500'],
            'target_app' => ['sometimes', 'required', 'in:customer,driver,both'],
            'position' => ['sometimes', 'required', 'in:full_screen,half'],
            'is_active' => ['nullable', 'boolean'],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date', 'after_or_equal:starts_at'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);

        if ($request->hasFile('image')) {
            if ($banner->image_path && Storage::disk('public')->exists($banner->image_path)) {
                Storage::disk('public')->delete($banner->image_path);
            }
            $banner->image_path = $request->file('image')->store('app_banners', 'public');
        }

        if (array_key_exists('title', $data)) {
            $banner->title = trim($data['title']);
        }
        if (array_key_exists('url_link', $data)) {
            $banner->url_link = !empty($data['url_link']) ? trim($data['url_link']) : null;
        }
        if (array_key_exists('target_app', $data)) {
            $banner->target_app = $data['target_app'];
        }
        if (array_key_exists('position', $data)) {
            $banner->position = $data['position'];
        }
        if ($request->has('is_active')) {
            $banner->is_active = $request->boolean('is_active');
        }
        if (array_key_exists('starts_at', $data)) {
            $banner->starts_at = !empty($data['starts_at']) ? $data['starts_at'] : null;
        }
        if (array_key_exists('ends_at', $data)) {
            $banner->ends_at = !empty($data['ends_at']) ? $data['ends_at'] : null;
        }
        if (array_key_exists('sort_order', $data)) {
            $banner->sort_order = (int) $data['sort_order'];
        }

        $banner->save();

        return response()->json([
            'data' => $banner->fresh(),
            'banner' => $banner->fresh(),
            'message' => 'Banner updated successfully.',
        ]);
    }

    public function toggle(AppBanner $banner): JsonResponse
    {
        $banner->is_active = !$banner->is_active;
        $banner->save();

        return response()->json([
            'data' => $banner->fresh(),
            'banner' => $banner->fresh(),
            'message' => $banner->is_active ? 'Banner activated.' : 'Banner deactivated.',
        ]);
    }

    public function destroy(AppBanner $banner): JsonResponse
    {
        if ($banner->image_path && Storage::disk('public')->exists($banner->image_path)) {
            Storage::disk('public')->delete($banner->image_path);
        }

        $banner->delete();

        return response()->json([
            'message' => 'Banner deleted successfully.',
        ]);
    }
}

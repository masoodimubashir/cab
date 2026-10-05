<?php

namespace Tests\Unit;

use App\Models\AppBanner;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AppBannerImageUrlTest extends TestCase
{
    public static function imageUrls(): array
    {
        return [
            'production with stale HTTP configuration' => ['production', 'http://dreamcabs.in/storage', 'https://dreamcabs.in/storage/app_banners/promo.png'],
            'production HTTPS configuration' => ['production', 'https://dreamcabs.in/storage', 'https://dreamcabs.in/storage/app_banners/promo.png'],
            'local HTTP development' => ['local', 'http://localhost:8000/storage', 'http://localhost:8000/storage/app_banners/promo.png'],
            'production CDN configuration' => ['production', 'https://cdn.example.com/uploads', 'https://cdn.example.com/uploads/app_banners/promo.png'],
        ];
    }

    #[DataProvider('imageUrls')]
    public function test_banner_image_url_is_safe_for_its_environment(string $environment, string $storageUrl, string $expected): void
    {
        $originalEnvironment = app()->environment();
        try {
            app()->instance('env', $environment);
            config()->set('filesystems.disks.public.url', $storageUrl);
            Storage::forgetDisk('public');
            $banner = new AppBanner(['image_path' => 'app_banners/promo.png']);
            $this->assertSame($expected, $banner->image_url);
            $this->assertSame($expected, $banner->toArray()['image_url']);
        } finally {
            app()->instance('env', $originalEnvironment);
            Storage::forgetDisk('public');
        }
    }

    public function test_banner_without_an_image_returns_null(): void
    {
        $this->assertNull((new AppBanner())->image_url);
    }
}

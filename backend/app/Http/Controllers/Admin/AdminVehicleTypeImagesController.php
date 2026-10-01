<?php

namespace App\Http\Controllers\Admin;

/** Legacy city/platform endpoints must not modify archived uploads or global assets. */
class AdminVehicleTypeImagesController
{
    public function index() { return $this->retired(); }
    public function store() { return $this->retired(); }
    public function update() { return $this->retired(); }
    public function destroy() { return $this->retired(); }

    private function retired()
    {
        return response()->json([
            'message' => 'Vehicle images are now shared across all cities and apps. Refresh the dashboard and use App Assets.',
        ], 410);
    }
}

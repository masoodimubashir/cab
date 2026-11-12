import { isMapCameraManual, updateMapCamera } from './map-camera';

export const CUSTOMER_NAVIGATION_ZOOM = 17.5;

export const CUSTOMER_MAP_STYLE = {
  renderingType: 'VECTOR',
  colorScheme: 'LIGHT',
  tilt: 35,
  zoom: CUSTOMER_NAVIGATION_ZOOM,
  headingInteractionEnabled: true,
  tiltInteractionEnabled: true,
  gestureHandling: 'greedy',
};

export function moveCustomerMap(map: any, camera: any): void {
  updateMapCamera(map, () => map.moveCamera(camera));
}

export function focusCustomerNavigation(map: any, center: { lat: number; lng: number }): void {
  moveCustomerMap(map, { center, zoom: CUSTOMER_NAVIGATION_ZOOM, tilt: CUSTOMER_MAP_STYLE.tilt });
}

/** Google Maps resets the vector camera tilt when fitting bounds. */
export function fitCustomerMap(map: any, bounds: any, padding: number | Record<string, number>): void {
  updateMapCamera(map, () => {
    google.maps.event.addListenerOnce(map, 'idle', () => {
      if (!isMapCameraManual(map) && map.getTilt() === 0) map.setTilt(CUSTOMER_MAP_STYLE.tilt);
    });
    map.fitBounds(bounds, padding);
    if (!isMapCameraManual(map) && map.getTilt() === 0) map.setTilt(CUSTOMER_MAP_STYLE.tilt);
  });
}

declare const google: any;


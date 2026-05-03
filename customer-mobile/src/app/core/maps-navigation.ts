/** Lat/lng pair from a trip or API payload. */
export type MapCoords = { lat: number; lng: number };

export function coordsFromTrip(
  trip: Record<string, unknown>,
  latKey: string,
  lngKey: string
): MapCoords | null {
  const lat = Number(trip[latKey]);
  const lng = Number(trip[lngKey]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

/**
 * Opens Google Maps directions. Omit origin to use the device’s current location as start.
 * @see https://developers.google.com/maps/documentation/urls/get-started#directions-action
 */
export function googleMapsDirectionsUrl(opts: {
  origin?: MapCoords;
  destination: MapCoords;
  travelmode?: 'driving' | 'walking' | 'bicycling' | 'transit';
}): string {
  const params = new URLSearchParams({ api: '1' });
  params.set('destination', `${opts.destination.lat},${opts.destination.lng}`);
  if (opts.origin) {
    params.set('origin', `${opts.origin.lat},${opts.origin.lng}`);
  }
  if (opts.travelmode) {
    params.set('travelmode', opts.travelmode);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function openExternalUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

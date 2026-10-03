export interface CustomerLocation {
  customer_lat?: number | null;
  customer_lng?: number | null;
  customer_location_updated_at?: string | null;
}

export function hasCustomerLocation(customer: CustomerLocation): boolean {
  return customer.customer_lat != null && customer.customer_lng != null &&
    Number.isFinite(Number(customer.customer_lat)) && Number.isFinite(Number(customer.customer_lng));
}

export function isCustomerLocationLive(customer: CustomerLocation, now = Date.now()): boolean {
  const updated = Date.parse(customer.customer_location_updated_at || '');
  const age = now - updated;
  return hasCustomerLocation(customer) && Number.isFinite(updated) && age >= 0 && age <= 120_000;
}

// Capture freshness too: an unchanged location must lose its live badge on polling.
export function customerMarkerSignature(customers: CustomerLocation[]): string {
  return JSON.stringify(customers.map((p) => ({
    ...p,
    locationLive: isCustomerLocationLive(p),
  })));
}

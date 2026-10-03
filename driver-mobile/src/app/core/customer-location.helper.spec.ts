import { customerMarkerSignature, isCustomerLocationLive } from './customer-location.helper';

describe('customer location freshness', () => {
  const now = Date.parse('2026-10-03T10:00:00Z');
  const passenger = {
    id: 1, status: 'BOOKED', customer_lat: 34, customer_lng: 74,
    customer_location_updated_at: new Date(now - 60_000).toISOString(),
  };

  it('labels only recently timestamped GPS coordinates live', () => {
    expect(isCustomerLocationLive(passenger, now)).toBeTrue();
    expect(isCustomerLocationLive(passenger, now + 61_000)).toBeFalse();
    expect(isCustomerLocationLive({ ...passenger, customer_location_updated_at: null }, now)).toBeFalse();
    expect(isCustomerLocationLive({ ...passenger, customer_location_updated_at: 'invalid' }, now)).toBeFalse();
    expect(isCustomerLocationLive({ ...passenger, customer_lat: null }, now)).toBeFalse();
  });

  it('refreshes moving customer markers without a passenger status change', () => {
    const before = customerMarkerSignature([passenger]);
    expect(customerMarkerSignature([{ ...passenger, customer_lat: 34.001 }])).not.toBe(before);
  });

  it('refreshes badges when unchanged coordinates become stale', () => {
    spyOn(Date, 'now').and.returnValue(now);
    const before = customerMarkerSignature([passenger]);
    (Date.now as jasmine.Spy).and.returnValue(now + 61_000);
    expect(customerMarkerSignature([passenger])).not.toBe(before);
  });
});

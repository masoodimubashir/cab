import { firstValueFrom, from, mergeMap, toArray } from 'rxjs';
import { ApiService } from '../../../core/api.service';
import { RawScope } from '../booking.service';
import { TripScope } from '../booking.models';

interface CityVehicle {
  id: number;
  display_name: string;
  vehicle_type_id: number;
  ride_type_id: number;
  image_url?: string | null;
  local_enabled?: boolean;
  outstation_enabled?: boolean;
}

export interface PrivateModel {
  id: number;
  name: string;
  image_url?: string | null;
  rateCardVehicleId: number | null;
}

export function privateModels(rows: CityVehicle[], scope: TripScope): PrivateModel[] {
  const models = new Map<string, PrivateModel>();
  const sharedCards = new Set<string>();
  for (const row of rows) {
    const key = row.vehicle_type_id + ':' + row.display_name.trim().toLowerCase();
    const model: PrivateModel = models.get(key) ?? {
      id: row.id, name: row.display_name, image_url: row.image_url, rateCardVehicleId: null,
    };
    const enabled = scope === 'local' ? row.local_enabled : row.outstation_enabled;
    if (row.local_enabled && row.outstation_enabled && !sharedCards.has(key)) {
      sharedCards.add(key);
      model.rateCardVehicleId = row.id;
    } else if (enabled && model.rateCardVehicleId === null) {
      model.rateCardVehicleId = row.id;
    }
    models.set(key, model);
  }
  return [...models.values()];
}

export async function loadPrivateModels(api: ApiService, cityId: number, scope: TripScope, catalog: RawScope[]): Promise<PrivateModel[]> {
  const url = `/catalog/cities/${cityId}/vehicles`;
  try {
    const res = await firstValueFrom(api.get<{ data: CityVehicle[] }>(url + '?mode=private'));
    return privateModels(res.data, scope);
  } catch (err: any) {
    // The previous API requires a family filter. Use its city assignments during rollout.
    if (err.status !== 422 || !err.error?.errors?.vehicle_type_id) throw err;
  }
  const privateIds = (kind: TripScope) => catalog.find(s => s.scope === kind)?.modes
    .filter(m => m.mode === 'private').map(m => m.ride_type_id ?? m.id) ?? [];
  const local = privateIds('local'), outstation = privateIds('outstation');
  const families = await firstValueFrom(api.get<{ data: { id: number }[] }>('/pricing/vehicle-types?city_id=' + cityId));
  const groups = await firstValueFrom(from(families.data).pipe(mergeMap(async family => {
    const { data } = await firstValueFrom(api.get<{ data: CityVehicle[] }>(url + '?vehicle_type_id=' + family.id));
    const rows = data.filter(row => local.includes(row.ride_type_id) || outstation.includes(row.ride_type_id));
    for (const row of rows) {
      row.local_enabled = local.includes(row.ride_type_id);
      row.outstation_enabled = outstation.includes(row.ride_type_id);
    }
    return rows;
  }, 4), toArray()));
  const rows = groups.reduce<CityVehicle[]>((all, group) => all.concat(group), []);
  return privateModels(rows.sort((a, b) => a.vehicle_type_id - b.vehicle_type_id || a.id - b.id), scope);
}

export interface PriceComponents {
  base_fare: number;
  distance_component: number;
  time_component: number;
  pickup_component: number;
  subtotal_before_tax: number;
  tax_amount: number;
  toll_amount?: number;
  region_fare_name?: string;
  region_fare_amount?: number;
}

export function fareLines(fare: PriceComponents): { label: string; amount: number }[] {
  const lines = [
    { label: 'Base fare', amount: fare.base_fare },
    { label: 'Distance charge', amount: fare.distance_component },
    { label: 'Time charge', amount: fare.time_component },
    { label: 'Pickup charge', amount: fare.pickup_component },
  ];
  if (fare.region_fare_name && fare.region_fare_amount) {
    lines.push({ label: fare.region_fare_name, amount: fare.region_fare_amount });
  }
  const adjustment = fare.subtotal_before_tax - lines.reduce((sum, line) => sum + line.amount, 0);
  lines.push({ label: 'Fare adjustment', amount: Math.round(adjustment * 100) / 100 },
    { label: 'Tax', amount: fare.tax_amount }, { label: 'Tolls', amount: fare.toll_amount ?? 0 });
  return lines.filter(line => Number.isFinite(line.amount) && line.amount !== 0);
}

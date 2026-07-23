import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/api.service';

export type SeatCellKind = 'seat' | 'blocked' | 'aisle';
export type SeatCategory = 'front' | 'window' | 'middle' | 'rear' | 'premium';

export interface SeatCell {
  id?: number;
  row: number;
  col: number;
  kind: SeatCellKind;
  label?: string | null;
  category?: SeatCategory | null;
  price_delta?: number;
}

export interface VehicleSeatLayout {
  id: number;
  city_id: number;
  vehicle_type_id: number;
  name: string;
  rows: number;
  cols: number;
  is_active: boolean;
  seat_count: number;
  in_use: boolean;
  cells: SeatCell[];
}

export interface SeatLayoutPayload {
  name: string;
  vehicle_type_id: number;
  rows: number;
  cols: number;
  is_active?: boolean;
  cells: SeatCell[];
}

@Injectable({ providedIn: 'root' })
export class VehicleSeatLayoutsService {
  constructor(private api: ApiService) {}

  list(cityId: number): Observable<{ data: VehicleSeatLayout[] }> {
    return this.api.get(`/admin/cities/${cityId}/vehicle-seat-layouts`);
  }

  get(cityId: number, layoutId: number): Observable<{ layout: VehicleSeatLayout }> {
    return this.api.get(`/admin/cities/${cityId}/vehicle-seat-layouts/${layoutId}`);
  }

  create(cityId: number, payload: SeatLayoutPayload): Observable<{ layout: VehicleSeatLayout }> {
    return this.api.post(`/admin/cities/${cityId}/vehicle-seat-layouts`, payload);
  }

  update(cityId: number, layoutId: number, payload: SeatLayoutPayload): Observable<{ layout: VehicleSeatLayout }> {
    return this.api.patch(`/admin/cities/${cityId}/vehicle-seat-layouts/${layoutId}`, payload);
  }

  destroy(cityId: number, layoutId: number): Observable<{ message: string }> {
    return this.api.delete(`/admin/cities/${cityId}/vehicle-seat-layouts/${layoutId}`);
  }
}

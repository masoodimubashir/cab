// Standalone local design preview. This entry is never included in the production app.
import 'zone.js';
import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { of } from 'rxjs';
import { ApiService } from '../src/app/core/api.service';
import { ToastService } from '../src/app/core/toast.service';
import { RouteOperationsComponent } from '../src/app/admin/vehicles/route-operations.component';

@Component({
  selector: 'app-root', standalone: true, imports: [RouteOperationsComponent],
  template: `<div class="preview-shell"><aside class="preview-sidebar"><div class="brand">Dream<span>Cabs</span></div><small>LOCAL DESIGN PREVIEW</small><div class="nav-caption">WORKSPACE</div><div class="nav-item active">Routes & fleet</div><div class="nav-item">Vehicle configuration</div><div class="nav-item">Pricing</div><div class="nav-caption">OPERATIONS</div><div class="nav-item">Rides</div><div class="nav-item">Customers</div><div class="nav-item">Drivers</div><div class="preview-note">Sample data<br>Changes here do not affect the live website.</div></aside><main><div class="preview-top"><span>DreamCabs / Routes</span><span class="preview-badge">Local preview · Sample data</span></div><app-route-operations [cityId]="1" cityName="Sopore" [routes]="routes" [groups]="groups" [vehicles]="vehicles" [vehicleRows]="vehicleRows" [sets]="sets" [drivers]="drivers" (action)="showAction($event.kind)" /></main></div>`,
  styles: [`:host { display: block; }.preview-shell { display: flex; min-height: 100vh; background: var(--tm-canvas); font-family: var(--tm-font-body); }.preview-sidebar { width: 200px; flex-shrink: 0; padding: 26px 16px; box-sizing: border-box; background: var(--tm-surface); border-right: 1px solid var(--tm-line); }.brand { font-size: 22px; font-weight: 800; margin-bottom: 12px; color: var(--tm-text); }.brand span { color: var(--tm-green-deep); }.preview-sidebar small { font-size: 9px; color: var(--tm-text-muted); letter-spacing: .1em; }.nav-caption { margin: 32px 12px 12px; font-size: 9px; color: var(--tm-text-muted); font-weight: 700; letter-spacing: .1em; }.nav-item { padding: 12px; font-size: 12px; color: var(--tm-text-muted); border-radius: 7px; margin: 4px 0; }.nav-item.active { background: var(--tm-green-tint); color: var(--tm-green-deep); font-weight: 650; }.preview-note { margin: 48px 12px; font-size: 11px; line-height: 1.8; color: var(--tm-text-muted); }main { flex: 1; min-width: 0; padding: 0 28px 28px; }.preview-top { display: flex; align-items: center; justify-content: space-between; padding: 21px 0 30px; color: var(--tm-text-muted); font-size: 11px; }.preview-badge { background: var(--tm-green-tint); padding: 6px 10px; border-radius: 20px; color: var(--tm-green-deep); }@media(max-width:800px) { .preview-sidebar { display: none; }main { padding: 0 16px; }.preview-top { gap: 12px; } }`],
})
class RoutesWorkspacePreview {
  vehicles = [
    { id: 1, display_name: 'SUMO', vehicle_type_name: 'Sumo Maxi', vehicle_type_id: 1, max_people: 9, luggage_capacity: 2, is_active: true, vehicle_set_ids: [10] },
    { id: 2, display_name: 'TAVERA', vehicle_type_name: 'Chevrolet Tavera', vehicle_type_id: 2, max_people: 7, luggage_capacity: 2, is_active: true, vehicle_set_ids: [10] },
    { id: 3, display_name: 'BUS', vehicle_type_name: 'Mini bus', vehicle_type_id: 3, max_people: 24, luggage_capacity: 4, is_active: false, vehicle_set_ids: [] },
  ];
  vehicleRows = this.vehicles.map(vehicle => ({ ...vehicle, ride_type_name: 'Share a seat', vehicle_set_id: vehicle.id < 3 ? 10 : null }));
  routes = [
    { id: 20, name: 'Sopore Bus Stand → Arampora', origin_name: 'General bus stand, Sopore', dest_name: 'Gulabad Arampora', scope: 'local', flat_fare: 50, booking_window_hours: 6, city_vehicle_type_id: 1, is_active: true, stops: Array.from({ length: 7 }, (_, id) => ({ id })) },
    { id: 21, name: 'Model Town → Sopore Adda', origin_name: 'Model Town', dest_name: 'Sopore Adda', scope: 'local', flat_fare: 20, booking_window_hours: 6, city_vehicle_type_id: 1, is_active: true, stops: Array.from({ length: 5 }, (_, id) => ({ id })) },
    { id: 22, name: 'Sopore → Srinagar', origin_name: 'Sopore Bus Stand', dest_name: 'Batamaloo, Srinagar', scope: 'outstation', flat_fare: 150, booking_window_hours: 12, city_vehicle_type_id: 1, is_active: true, stops: Array.from({ length: 12 }, (_, id) => ({ id })) },
    { id: 23, name: 'Sopore → Baramulla', origin_name: 'Sopore Bus Stand', dest_name: 'Baramulla Main Market', scope: 'local', flat_fare: null, booking_window_hours: null, city_vehicle_type_id: 3, is_active: false, stops: Array.from({ length: 9 }, (_, id) => ({ id })) },
  ];
  groups = [
    { id: 5, name: 'Sopore town service', is_active: true, city_vehicle_type_id: 1, vehicle_set_ids: [10], route_ids: [20, 21], driver_user_ids: [50, 51] },
    { id: 6, name: 'Srinagar express', is_active: true, city_vehicle_type_id: 1, vehicle_set_ids: [10], route_ids: [22], driver_user_ids: [52] },
    { id: 7, name: 'Baramulla service', is_active: false, city_vehicle_type_id: 3, vehicle_set_ids: [], route_ids: [], driver_user_ids: [] },
  ];
  sets = [{ id: 10, name: 'Sopore shared fleet', members: [{ id: 1, display_name: 'SUMO' }, { id: 2, display_name: 'TAVERA' }], route_group_ids: [5, 6] }];
  drivers = ['Driver One', 'Driver Two', 'Driver Three'].map((name, index) => ({ id: index + 1, user_id: 50 + index, name, phone: null, city_vehicle_type_id: index === 1 ? 2 : 1, vehicle_type_id: index === 1 ? 2 : 1, vehicle_reg_no: `JK05 DEMO${index + 1}`, vehicle_model: index === 1 ? 'Tavera' : 'Sumo', vehicle_color: null }));
  showAction(kind: string): void { alert(`${kind}: this local design preview uses sample data. The production workspace opens the connected editor for this action.`); }
}
const previewApi = { get: () => of({ groups: [], assigned_group_ids: [], effective_routes: [] }), put: () => of({}), post: () => of({}) };
bootstrapApplication(RoutesWorkspacePreview, { providers: [{ provide: ApiService, useValue: previewApi }, { provide: ToastService, useValue: { success: () => undefined } }] }).catch(error => console.error(error));

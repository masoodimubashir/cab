import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent, DrawerComponent, IconComponent } from '../../ui';
import { DriverRouteGroupsPanelComponent } from '../drivers/driver-route-groups-panel.component';
import { MasterAction, MasterDriver, MasterGroup, MasterRoute, MasterVehicle, MasterExplorerComponent, RouteGrouping } from './master-explorer.component';
import { RouteGroupSetupComponent, SetupVehicle, SetupVehicleSet } from './route-group-setup.component';
import { AddVehiclesComponent } from './add-vehicles.component';

export type OperationsAction = MasterAction | { kind: 'add-vehicle' | 'vehicle-types' | 'vehicle-sets' | 'edit-vehicle' | 'toggle-vehicle' | 'vehicle-layouts' | 'vehicle-fare' | 'vehicle-assets' | 'vehicle-drivers' | 'copy-vehicles' | 'bulk-enable' | 'bulk-disable' | 'export-vehicles'; id?: number; vehicleId?: number | null; rideTypeId?: number; ids?: number[] };
type View = 'routes' | 'groups' | 'vehicles' | 'drivers';
interface DirectoryRow { key: string; depth: number; name: string; kind: string; id?: number; ids: number[]; route?: MasterRoute; }
@Component({
  selector: 'app-route-operations', standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, DrawerComponent, IconComponent, RouteGroupSetupComponent, DriverRouteGroupsPanelComponent, AddVehiclesComponent],
  templateUrl: './route-operations.component.html', styleUrls: ['./route-operations.component.scss'],
})
export class RouteOperationsComponent implements OnChanges {
  @Input() cityId!: number;
  @Input() cityName = '';
  @Input() loading = false;
  @Input() loadError = '';
  @Input() routes: MasterRoute[] = [];
  @Input() groups: MasterGroup[] = [];
  @Input() vehicles: MasterVehicle[] = [];
  @Input() vehicleRows: SetupVehicle[] = [];
  @Input() sets: SetupVehicleSet[] = [];
  @Input() drivers: MasterDriver[] = [];
  @Input() fareModes: { id: number; name: string }[] = [];
  @Input() vehicleTypeOptions: { id: number; name: string }[] = [];
  @Input() editId: number | null = null;
  @Input() editField = '';
  @Input() editValue = '';
  @Output() cellEdit = new EventEmitter<{ phase: 'start' | 'change' | 'save' | 'cancel'; id: number; field: 'name' | 'seats' | 'bags'; value?: string }>();
  @ViewChild('vehicleCellInput') set focusVehicleCell(input: ElementRef<HTMLInputElement> | undefined) { input?.nativeElement.focus(); input?.nativeElement.select(); }
  @Output() action = new EventEmitter<OperationsAction>();
  @Output() refresh = new EventEmitter<void>();
  view: View = 'routes';
  search = '';
  status: 'all' | 'active' | 'inactive' | 'attention' = 'all';
  scope = 'all';
  vehicleId: number | null = null;
  selectedRouteId: number | null = null;
  showFilters = false;
  groupSetupOpen = false;
  initialRouteId: number | null = null;
  routeForGroup: MasterRoute | null = null;
  editingGroup: MasterGroup | null = null;
  driverAssignment: MasterDriver | null = null;
  routeStarterOpen = false;
  newRouteVehicleId: number | null = null;
  grouping: RouteGrouping = 'routes';
  readonly explorer = new MasterExplorerComponent();
  selectedVehicleIds = new Set<number>();
  vehicleTypeId: number | null = null;
  vehicleSettingsId: number | null = null;
  batchVehicleOpen = false;
  pageSize = 10;
  readonly pageSizes = [10, 25, 50, 100];
  private pageNumber = 1;
  private paginationFilterKey = '';
  get totalItems(): number { return this.view === 'routes' ? this.directoryRows.length : this.view === 'groups' ? this.filteredGroups.length : this.view === 'vehicles' ? this.filteredVehicles.length : this.filteredDrivers.length; }
  get pageCount(): number { return Math.max(1, Math.ceil(this.totalItems / this.pageSize)); }
  get currentPage(): number {
    const key = JSON.stringify([this.cityId, this.view, this.search, this.status, this.scope, this.vehicleId, this.vehicleTypeId, this.grouping]);
    if (key !== this.paginationFilterKey) { this.paginationFilterKey = key; this.pageNumber = 1; }
    this.pageNumber = Math.min(this.pageNumber, this.pageCount);
    return this.pageNumber;
  }
  get firstItem(): number { return this.totalItems ? (this.currentPage - 1) * this.pageSize + 1 : 0; }
  get lastItem(): number { return Math.min(this.currentPage * this.pageSize, this.totalItems); }
  goToPage(page: number): void { void this.currentPage; this.pageNumber = Math.max(1, Math.min(page, this.pageCount)); this.selectedRouteId = null; this.vehicleSettingsId = null; }
  changePageSize(size: number): void { if (this.pageSizes.includes(Number(size))) { this.pageSize = Number(size); this.goToPage(1); } }
  private paginate<T>(items: T[]): T[] { return items.slice((this.currentPage - 1) * this.pageSize, this.currentPage * this.pageSize); }
  get pagedGroups(): MasterGroup[] { return this.paginate(this.filteredGroups); }
  get pagedVehicles(): MasterVehicle[] { return this.paginate(this.filteredVehicles); }
  get pagedDrivers(): MasterDriver[] { return this.paginate(this.filteredDrivers); }
  get pagedDirectoryRows(): DirectoryRow[] {
    const rows = this.directoryRows;
    const page = this.paginate(rows);
    const first = page[0];
    if (!first) return [];
    // Repeat ancestor headings when a grouped branch continues onto another page.
    const context = rows.filter(row => !row.route && first.key.startsWith(row.key + '/'));
    return [...context, ...page];
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cityId']) {
      this.search = ''; this.status = 'all'; this.scope = 'all'; this.vehicleId = null;
      this.selectedRouteId = null; this.groupSetupOpen = false; this.editingGroup = null;
      this.driverAssignment = null; this.routeStarterOpen = false;
      this.routeForGroup = null; this.initialRouteId = null; this.importStarter = false; this.newRouteVehicleId = null;
      this.selectedVehicleIds.clear(); this.vehicleTypeId = null; this.vehicleSettingsId = null;
      this.batchVehicleOpen = false;
      this.pageNumber = 1; this.paginationFilterKey = '';
      this.explorer.expanded.clear(); this.restorePreferences();
    }
    if (this.vehicleId !== null && !this.loading && this.vehicles.length && !this.vehicles.some(vehicle => vehicle.id === this.vehicleId)) this.vehicleId = null;
    if (this.selectedRouteId !== null && !this.routes.some(route => route.id === this.selectedRouteId)) this.selectedRouteId = null;
  }
  savePreferences(): void {
    try { localStorage.setItem(`master-route-view:v1:${this.cityId}`, JSON.stringify({ grouping: this.grouping, vehicleId: this.vehicleId })); } catch { /* Storage is optional. */ }
  }
  private restorePreferences(): void {
    this.grouping = 'routes';
    try {
      const saved = JSON.parse(localStorage.getItem(`master-route-view:v1:${this.cityId}`) ?? 'null');
      if (saved && ['route-set', 'city-area', 'scope', 'type', 'all-routes', 'routes'].includes(saved.grouping)) {
        this.grouping = saved.grouping;
        if (Number.isInteger(saved.vehicleId) && saved.vehicleId > 0) this.vehicleId = saved.vehicleId;
      }
    } catch { /* Invalid preferences do not block the page. */ }
  }
  changeGrouping(): void { this.explorer.expanded.clear(); this.selectedRouteId = null; this.savePreferences(); }
  get directoryRows(): DirectoryRow[] {
    this.explorer.routes = this.filteredRoutes; this.explorer.groups = this.groups;
    this.explorer.cityName = this.cityName; this.explorer.grouping = this.grouping;
    return this.explorer.rows.map(row => ({ key: row.trackKey, depth: row.depth, name: row.node.name, kind: row.node.kind, id: row.node.id, ids: row.node.ids, route: row.node.kind === 'route' ? this.routes.find(route => route.id === row.node.id) : undefined }));
  }
  toggleDirectory(row: { key: string }): void { this.explorer.toggle(row.key.split('/').pop()!); }
  trackDirectoryRow(_: number, row: { key: string }): string { return row.key; }
  directoryExpanded(row: { key: string }): boolean { return this.explorer.expanded.has(row.key.split('/').pop()!); }
  expandDirectory(): void {
    void this.directoryRows;
    const visit = (node: typeof this.explorer.tree) => { if (node.kind !== 'route') this.explorer.expanded.add(node.key); node.children.forEach(visit); };
    visit(this.explorer.tree);
  }
  groupById(id?: number): MasterGroup | null { return this.groups.find(group => group.id === id) ?? null; }
  get vehicleTypes(): { id: number; name: string }[] { return [...new Map(this.vehicles.filter(vehicle => vehicle.vehicle_type_id !== null).map(vehicle => [vehicle.vehicle_type_id!, { id: vehicle.vehicle_type_id!, name: vehicle.vehicle_type_name || vehicle.display_name }])).values()]; }
  toggleVehicleSelection(id: number): void { this.selectedVehicleIds.has(id) ? this.selectedVehicleIds.delete(id) : this.selectedVehicleIds.add(id); }
  get allVisibleVehiclesSelected(): boolean { return this.pagedVehicles.length > 0 && this.pagedVehicles.every(vehicle => this.selectedVehicleIds.has(vehicle.id)); }
  get selectedVehicle(): MasterVehicle | undefined { return this.vehicles.find(vehicle => vehicle.id === this.vehicleId); }
  vehicleCellEditing(id: number, field: string): boolean { return this.editId === id && this.editField === field; }
  editVehicleCell(phase: 'start' | 'change' | 'save' | 'cancel', id: number, field: 'name' | 'seats' | 'bags', value?: string): void { this.cellEdit.emit({ phase, id, field, value }); }
  selectVisibleVehicles(): void { const all = this.allVisibleVehiclesSelected; this.pagedVehicles.forEach(vehicle => { if (all) this.selectedVehicleIds.delete(vehicle.id); else this.selectedVehicleIds.add(vehicle.id); }); }
  vehicleBatch(kind: 'copy-vehicles' | 'bulk-enable' | 'bulk-disable' | 'export-vehicles'): void { this.action.emit({ kind, ids: [...this.selectedVehicleIds] }); }
  vehicleFare(id: number, rideTypeId: number): void { this.action.emit({ kind: 'vehicle-fare', id, rideTypeId }); }
  initials(name: string): string { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase(); }
  routeDrivers(routeId: number): MasterDriver[] { const ids = new Set(this.groupsForRoute(routeId).flatMap(group => group.driver_user_ids)); return this.drivers.filter(driver => ids.has(driver.user_id)); }
  vehicleForRoute(route: MasterRoute): MasterVehicle | undefined { return this.vehicles.find(vehicle => (vehicle.mode_row_ids ?? [vehicle.id]).includes(route.city_vehicle_type_id ?? -1)); }
  changeView(view: View): void { this.view = view; this.search = ''; this.status = 'all'; this.selectedRouteId = null; }
  clearFilters(): void { this.search = ''; this.status = 'all'; this.scope = 'all'; this.vehicleId = null; this.vehicleTypeId = null; this.savePreferences(); }
  get filtersActive(): boolean { return !!this.search || this.status !== 'all' || this.scope !== 'all' || this.vehicleId !== null || this.vehicleTypeId !== null; }
  private matches(value: string): boolean { return value.toLowerCase().includes(this.search.toLowerCase().trim()); }
  groupVehicles(group: MasterGroup): MasterVehicle[] {
    return this.vehicles.filter(vehicle => (vehicle.mode_row_ids ?? [vehicle.id]).includes(group.city_vehicle_type_id ?? -1)
      || (group.vehicle_set_ids ?? []).some(id => (vehicle.vehicle_set_ids ?? (vehicle.vehicle_set_id ? [vehicle.vehicle_set_id] : [])).includes(id)));
  }
  groupsForRoute(id: number): MasterGroup[] { return this.groups.filter(group => group.route_ids.includes(id)); }
  groupsForDriver(userId: number): MasterGroup[] { return this.groups.filter(group => group.driver_user_ids.includes(userId)); }
  driverRouteCount(userId: number): number { return new Set(this.groupsForDriver(userId).flatMap(group => group.route_ids)).size; }
  groupsForVehicle(vehicle: MasterVehicle): MasterGroup[] { return this.groups.filter(group => this.groupVehicles(group).some(member => member.id === vehicle.id)); }
  vehicleLabel(group: MasterGroup): string { return this.groupVehicles(group).map(vehicle => vehicle.display_name).join(', ') || 'Choose vehicles'; }
  driverCount(route: MasterRoute): number { return new Set(this.groupsForRoute(route.id).flatMap(group => group.driver_user_ids)).size; }
  needsAttention(route: MasterRoute): boolean { return !route.flat_fare || !this.groupsForRoute(route.id).length; }
  get attentionCount(): number { return this.routes.filter(route => this.needsAttention(route)).length; }
  get filteredRoutes(): MasterRoute[] {
    return this.routes.filter(route => {
      const groups = this.groupsForRoute(route.id);
      return this.matches(`${route.name} ${route.origin_name} ${route.dest_name} ${groups.map(group => group.name).join(' ')}`)
        && (this.scope === 'all' || route.scope === this.scope)
        && this.statusMatches(route.is_active, this.needsAttention(route))
        && (this.vehicleId === null || (this.vehicles.find(vehicle => vehicle.id === this.vehicleId)?.mode_row_ids ?? [this.vehicleId]).includes(route.city_vehicle_type_id ?? -1) || groups.some(group => this.groupVehicles(group).some(vehicle => vehicle.id === this.vehicleId)));
    });
  }
  private statusMatches(active: boolean, attention: boolean): boolean { return this.status === 'all' || (this.status === 'attention' ? attention : active === (this.status === 'active')); }
  get filteredGroups(): MasterGroup[] { return this.groups.filter(group => this.matches(`${group.name} ${this.vehicleLabel(group)}`) && (this.status === 'all' || (this.status === 'attention' ? !group.route_ids.length || !group.driver_user_ids.length : group.is_active === (this.status === 'active'))) && (this.vehicleId === null || this.groupVehicles(group).some(vehicle => vehicle.id === this.vehicleId))); }
  get filteredVehicles(): MasterVehicle[] { return this.vehicles.filter(vehicle => this.matches(`${vehicle.display_name} ${vehicle.vehicle_type_name ?? ''}`) && (this.vehicleId === null || vehicle.id === this.vehicleId) && (this.vehicleTypeId === null || vehicle.vehicle_type_id === this.vehicleTypeId) && (this.status === 'all' || (this.status === 'attention' ? !this.groupsForVehicle(vehicle).length : vehicle.is_active === (this.status === 'active')))); }
  get filteredDrivers(): MasterDriver[] { return this.drivers.filter(driver => this.matches(`${driver.name} ${driver.phone ?? ''} ${driver.vehicle_reg_no ?? ''} ${this.groupsForDriver(driver.user_id).map(group => group.name).join(' ')}`) && (this.vehicleId === null || this.driverMatchesVehicle(driver)) && (this.status !== 'attention' || !this.groupsForDriver(driver.user_id).length)); }
  private driverMatchesVehicle(driver: MasterDriver): boolean {
    const vehicle = this.vehicles.find(item => item.id === this.vehicleId);
    return !!vehicle && ((vehicle.mode_row_ids ?? [vehicle.id]).includes(driver.city_vehicle_type_id ?? -1)
      || (vehicle.vehicle_type_id !== null && driver.vehicle_type_id === vehicle.vehicle_type_id)
      || this.groupsForDriver(driver.user_id).some(group => this.groupVehicles(group).some(member => member.id === vehicle.id)));
  }
  get selectedRoute(): MasterRoute | undefined { return this.filteredRoutes.find(route => route.id === this.selectedRouteId); }
  get busy(): boolean { return this.loading || !!this.loadError; }
  startGroup(group: MasterGroup | null = null, routeId: number | null = null): void { this.editingGroup = group; this.initialRouteId = routeId; this.groupSetupOpen = true; }
  assignRoute(route: MasterRoute): void {
    if (!route.flat_fare || route.flat_fare <= 0) { this.emit('edit-route', route.id); return; }
    this.routeForGroup = route;
  }
  chooseGroupForRoute(group: MasterGroup | null): void { const id = this.routeForGroup?.id ?? null; this.routeForGroup = null; this.startGroup(group, id); }
  startRoute(): void {
    this.importStarter = false;
    const vehicleId = this.vehicleId ?? (this.vehicles.length === 1 ? this.vehicles[0].id : null);
    if (vehicleId) this.emit('add-route', undefined, vehicleId);
    else { this.newRouteVehicleId = this.vehicles[0]?.id ?? null; this.routeStarterOpen = true; }
  }
  createRoute(): void { if (this.newRouteVehicleId) { this.routeStarterOpen = false; this.emit('add-route', undefined, this.newRouteVehicleId); } }
  importRoutes(): void { if (this.vehicleId) this.emit('import', undefined, this.vehicleId); else { this.newRouteVehicleId = this.vehicles[0]?.id ?? null; this.importStarter = true; this.routeStarterOpen = true; } }
  importStarter = false;
  completeRouteStarter(): void { if (!this.newRouteVehicleId) return; if (this.importStarter) { this.emit('import', undefined, this.newRouteVehicleId); this.routeStarterOpen = false; } else this.createRoute(); this.importStarter = false; }
  emit(kind: OperationsAction['kind'], id?: number, vehicleId: number | null = this.vehicleId): void { this.action.emit({ kind, id, vehicleId } as OperationsAction); }
  exportRoutes(): void {
    const rows = [['Route', 'Origin', 'Destination', 'Scope', 'Fare', 'Status'], ...this.filteredRoutes.map(route => [route.name, route.origin_name, route.dest_name, route.scope, route.flat_fare ?? '', route.is_active ? 'Active' : 'Inactive'])];
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${this.cityName || 'city'}-routes.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

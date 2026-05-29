import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  FilterPillComponent,
  FilterSelectComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  StatusPillComponent,
} from '../../ui';

interface City { id: number; name: string; }
interface FleetOption { id: number; name: string; city_id: number; }

interface RoleOption {
  id: number;
  slug: string;
  name: string;
  is_system: boolean;
  is_suspendable: boolean;
  requires_fleet: boolean;
}

interface ManagerRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  manager_role_id: number;
  role: { id: number; slug: string; name: string; is_suspendable: boolean; requires_fleet: boolean; is_system: boolean } | null;
  manager_city_id: number | null;
  manager_all_cities: boolean;
  city_name: string | null;
  manager_fleet_id: number | null;
  fleet_name: string | null;
  is_suspended: boolean;
  status: string;
  created_at: string;
}

/**
 * Manager Settings — admin-panel users, each with a role, a city and (for
 * franchise roles) a fleet. Standard data-table layout: search + status/role
 * filters + dismissable pills; create/edit and confirmations use modals.
 */
@Component({
  selector: 'app-managers',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    FilterPillComponent, FilterSelectComponent, IconComponent,
    InputComponent, ModalComponent, StatusPillComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Manager Settings</h1>
          <p class="page__sub">Admin-panel users. Each manager has a role, a city and (for franchise roles) a fleet.</p>
        </div>
        <tm-button variant="green" icon="plus" (clicked)="openCreate()">Add manager</tm-button>
      </header>

      <tm-data-table
        [rows]="pageRows"
        [total]="total"
        [page]="page"
        [pageSize]="pageSize"
        [loading]="loading"
        emptyTitle="No managers"
        emptyHint="Try a different search, or clear the filters."
        (pageChange)="onPage($event)"
        (pageSizeChange)="onPageSize($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search by name, email or phone"
          [(ngModel)]="searchText"
          (ngModelChange)="onSearch()"
        />

        <ng-container slot="filters">
          <tm-filter-select
            icon="bolt"
            ariaLabel="Status filter"
            allLabel="Active"
            allValue="active"
            [options]="statusOptions"
            [value]="status"
            (valueChange)="onStatusChange($event)"
          />
          <tm-filter-select
            icon="shield"
            ariaLabel="Role filter"
            allLabel="All roles"
            [options]="roleFilterOptions"
            [value]="roleFilter"
            (valueChange)="onRoleFilterChange($event)"
          />
        </ng-container>

        <ng-container slot="banner">
          <tm-filter-pill *ngIf="searchText.trim()" icon="search" label="Search" [value]="searchText" (clear)="clearSearch()" />
          <tm-filter-pill *ngIf="status !== 'active'" icon="bolt" label="Status" [value]="statusLabel()" (clear)="clearStatus()" />
          <tm-filter-pill *ngIf="roleFilter !== 'all'" icon="shield" label="Role" [value]="roleName(roleFilter)" (clear)="clearRoleFilter()" />
        </ng-container>

        <tm-column key="name" label="Manager">
          <ng-template let-row>
            <div class="cell-id">
              <span class="cell-name">{{ row.name }}</span>
              <span class="cell-sub">{{ row.email }}</span>
            </div>
          </ng-template>
        </tm-column>
        <tm-column key="role" label="Role" width="170">
          <ng-template let-row>
            <tm-status-pill *ngIf="row.role" tone="info">{{ row.role.name }}</tm-status-pill>
            <span *ngIf="!row.role" class="muted">—</span>
          </ng-template>
        </tm-column>
        <tm-column key="city_name" label="City" width="150">
          <ng-template let-row>
            <span *ngIf="row.manager_all_cities" class="all-cities"><tm-icon name="map" [size]="12" /> All cities</span>
            <span *ngIf="!row.manager_all_cities && row.city_name">{{ row.city_name }}</span>
            <span *ngIf="!row.manager_all_cities && !row.city_name" class="muted">—</span>
          </ng-template>
        </tm-column>
        <tm-column key="fleet_name" label="Franchise" width="160">
          <ng-template let-row>
            <span *ngIf="row.fleet_name">{{ row.fleet_name }}</span>
            <span *ngIf="!row.fleet_name" class="muted">—</span>
          </ng-template>
        </tm-column>
        <tm-column key="status" label="Status" width="120">
          <ng-template let-row>
            <tm-status-pill [tone]="row.is_suspended ? 'danger' : 'success'">
              {{ row.is_suspended ? 'Suspended' : 'Active' }}
            </tm-status-pill>
          </ng-template>
        </tm-column>
        <tm-column key="actions" label="" width="240" align="right">
          <ng-template let-row>
            <div class="cell-actions">
              <tm-button
                *ngIf="row.role?.is_suspendable && !row.is_suspended"
                variant="outline" size="sm"
                (clicked)="suspendTarget = row"
              >Suspend</tm-button>
              <tm-button
                *ngIf="row.is_suspended"
                variant="green" size="sm"
                (clicked)="unsuspend(row)"
              >Unsuspend</tm-button>
              <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit manager"><tm-icon name="edit" [size]="14" /></button>
              <button
                *ngIf="!row.role?.is_system"
                class="icon-btn icon-btn--danger"
                (click)="deleteTarget = row"
                aria-label="Delete manager"
              ><tm-icon name="trash" [size]="14" /></button>
            </div>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <!-- Add / Edit modal -->
    <tm-modal
      [open]="dialogOpen"
      [title]="editingId ? 'Edit manager' : 'Add manager'"
      [dismissible]="false"
      (closed)="dialogOpen = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">Name <i>*</i></span>
          <input type="text" [(ngModel)]="form.name" name="manager_name" autocomplete="off" placeholder="Full name" />
        </label>
        <label class="field">
          <span class="field__lbl">Email <i>*</i></span>
          <input type="email" [(ngModel)]="form.email" name="manager_email" autocomplete="off" placeholder="name@example.com" />
        </label>
        <label class="field">
          <span class="field__lbl">Phone</span>
          <input type="text" [(ngModel)]="form.phone" name="manager_phone" autocomplete="off" placeholder="+91 90000 00000" />
        </label>
        <label class="field">
          <span class="field__lbl">{{ editingId ? 'New password (leave blank to keep)' : 'Password' }} <i *ngIf="!editingId">*</i></span>
          <input type="password" [(ngModel)]="form.password" name="manager_password" autocomplete="new-password" />
        </label>

        <label class="field">
          <span class="field__lbl">Role <i>*</i></span>
          <select [(ngModel)]="form.manager_role_id" (ngModelChange)="onRoleChange()">
            <option [ngValue]="null" disabled>Select a role</option>
            <option *ngFor="let r of roleOptions" [ngValue]="r.id">{{ r.name }}</option>
          </select>
        </label>

        <label class="field" *ngIf="!isSuperAdminRole()">
          <span class="field__lbl">City <i>*</i></span>
          <select [ngModel]="citySelect" (ngModelChange)="onCitySelectChange($event)" name="manager_city">
            <option value="" disabled>Select a city</option>
            <option *ngIf="!selectedRoleRequiresFleet()" value="all">All cities</option>
            <option *ngFor="let c of cityOptions" [value]="c.id">{{ c.name }}</option>
          </select>
          <span class="hint hint--info" *ngIf="form.manager_all_cities">
            This manager will have access to every city.
          </span>
        </label>

        <label class="field" *ngIf="selectedRoleRequiresFleet()">
          <span class="field__lbl">Franchise (Fleet) <i>*</i></span>
          <select [(ngModel)]="form.manager_fleet_id" [disabled]="!form.manager_city_id">
            <option [ngValue]="null" disabled>Select a franchise</option>
            <option *ngFor="let f of filteredFleets" [ngValue]="f.id">{{ f.name }}</option>
          </select>
          <span class="hint" *ngIf="form.manager_city_id && filteredFleets.length === 0">
            No fleets in this city yet. Create one in Settings → Fleets first.
          </span>
        </label>

        <div class="role-note" *ngIf="selectedRole()">
          <strong>{{ selectedRole()?.name }}</strong> grants the permissions shown on the Roles &amp; Permissions page.
        </div>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="dialogOpen = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="saving" (clicked)="submit()">
          {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create' }}
        </tm-button>
      </div>
    </tm-modal>

    <!-- Suspend confirm -->
    <tm-modal [open]="!!suspendTarget" title="Suspend manager" (closed)="suspendTarget = null">
      <div slot="body">
        <p>Suspend <strong>{{ suspendTarget?.name }}</strong>? They'll be logged out immediately and unable to sign in.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="suspendTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="busy" (clicked)="confirmSuspend()">
          {{ busy ? 'Suspending…' : 'Suspend' }}
        </tm-button>
      </div>
    </tm-modal>

    <!-- Delete confirm -->
    <tm-modal [open]="!!deleteTarget" title="Delete manager" (closed)="deleteTarget = null">
      <div slot="body">
        <p>Delete manager <strong>{{ deleteTarget?.name }}</strong>? This cannot be undone.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="busy" (clicked)="confirmDelete()">
          {{ busy ? 'Deleting…' : 'Delete' }}
        </tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); max-width: 70ch; }

    /* cell renderers */
    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); }
    .muted { color: var(--tm-text-muted); font-size: 12px; }
    .all-cities {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 12px; font-weight: 700; color: var(--tm-green-deep);
    }
    .cell-actions { display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer; border: 0;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    /* modal form */
    .form { display: flex; flex-direction: column; gap: 13px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field select {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field select:focus { border-color: var(--tm-green); }
    .field select:disabled { opacity: 0.6; cursor: not-allowed; }
    .hint {
      font-size: 11px; color: var(--tm-warning-fg);
      background: var(--tm-warning-bg); border-radius: 6px;
      padding: 6px 8px;
    }
    .hint--info { color: var(--tm-info-fg); background: var(--tm-info-bg); }
    .role-note {
      padding: 10px 12px;
      background: var(--tm-info-bg); color: var(--tm-info-fg);
      border-left: 3px solid var(--tm-info); border-radius: 6px;
      font-size: 12.5px;
    }

    @media (max-width: 720px) {
      .page__hero { flex-direction: column; }
    }
  `],
})
export class ManagersComponent implements OnInit, OnDestroy {
  managers: ManagerRow[] = [];

  // ── Filter / search / pagination ────────────────────────────────
  status: 'active' | 'inactive' = 'active';
  statusOptions = [{ label: 'Inactive', value: 'inactive' }];
  roleFilter = 'all';
  searchText = '';
  page = 1;
  pageSize = 25;
  loading = false;
  pageRows: ManagerRow[] = [];
  total = 0;

  roleOptions: RoleOption[] = [];
  cityOptions: City[] = [];
  fleetOptions: FleetOption[] = [];

  dialogOpen = false;
  editingId: number | null = null;
  saving = false;
  busy = false;
  form = this.blankForm();

  suspendTarget: ManagerRow | null = null;
  deleteTarget: ManagerRow | null = null;

  private searchTimer: number | null = null;

  constructor(
    private api: ApiService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadRoles();
    this.loadCities();
    this.loadFleets();
    this.loadManagers();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
  }

  blankForm() {
    return {
      name: '',
      email: '',
      phone: '',
      password: '',
      manager_role_id: null as number | null,
      manager_city_id: null as number | null,
      manager_all_cities: false,
      manager_fleet_id: null as number | null,
    };
  }

  // ── Loading ─────────────────────────────────────────────────────
  loadRoles(): void {
    this.api.get<{ data: RoleOption[] }>('/admin/manager-roles').subscribe({
      next: (r) => (this.roleOptions = r.data || []),
    });
  }
  loadCities(): void {
    this.api.get<{ data: City[] }>('/admin/cities').subscribe({
      next: (r) => (this.cityOptions = r.data || []),
    });
  }
  loadFleets(): void {
    this.api.get<{ data: FleetOption[] }>('/admin/fleets').subscribe({
      next: (r) => (this.fleetOptions = r.data || []),
    });
  }

  loadManagers(): void {
    const params = new URLSearchParams();
    params.set('status', this.status);
    const q = this.searchText.trim();
    if (q) params.set('q', q);
    this.loading = true;
    this.api.get<{ data: ManagerRow[] }>(`/admin/managers?${params.toString()}`).subscribe({
      next: (r) => {
        this.managers = r.data || [];
        this.loading = false;
        this.applyView();
      },
      error: (e) => {
        this.loading = false;
        this.toast.error(e?.error?.message || 'Failed to load managers');
      },
    });
  }

  // ── Filtering (role is client-side) + client pagination ─────────
  private applyView(): void {
    let list = this.managers;
    if (this.roleFilter !== 'all') {
      const rid = Number(this.roleFilter);
      list = list.filter((m) => m.manager_role_id === rid);
    }
    this.total = list.length;
    const maxPage = Math.max(1, Math.ceil(this.total / this.pageSize));
    if (this.page > maxPage) this.page = maxPage;
    const start = (this.page - 1) * this.pageSize;
    this.pageRows = list.slice(start, start + this.pageSize);
  }

  get roleFilterOptions(): { label: string; value: string }[] {
    return this.roleOptions.map((r) => ({ label: r.name, value: String(r.id) }));
  }
  roleName(id: string): string {
    return this.roleOptions.find((r) => String(r.id) === id)?.name ?? 'Role';
  }

  onSearch(): void {
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => {
      this.page = 1;
      this.loadManagers();
    }, 280);
  }
  clearSearch(): void {
    this.searchText = '';
    this.page = 1;
    this.loadManagers();
  }

  statusLabel(): string {
    return this.status === 'inactive' ? 'Inactive' : 'Active';
  }
  onStatusChange(value: string): void {
    this.status = value as 'active' | 'inactive';
    this.page = 1;
    this.loadManagers();
  }
  clearStatus(): void {
    if (this.status === 'active') return;
    this.status = 'active';
    this.page = 1;
    this.loadManagers();
  }

  onRoleFilterChange(value: string): void {
    this.roleFilter = value;
    this.page = 1;
    this.applyView();
  }
  clearRoleFilter(): void {
    if (this.roleFilter === 'all') return;
    this.roleFilter = 'all';
    this.page = 1;
    this.applyView();
  }

  onPage(p: number): void {
    this.page = p;
    this.applyView();
  }
  onPageSize(s: number): void {
    this.pageSize = s;
    this.page = 1;
    this.applyView();
  }

  // ── Role/city change handlers ───────────────────────────────────
  selectedRole(): RoleOption | null {
    return this.roleOptions.find((r) => r.id === this.form.manager_role_id) || null;
  }
  isSuperAdminRole(): boolean { return this.selectedRole()?.slug === 'super_admin'; }
  selectedRoleRequiresFleet(): boolean { return !!this.selectedRole()?.requires_fleet; }

  onRoleChange(): void {
    if (this.isSuperAdminRole()) {
      this.form.manager_city_id = null;
      this.form.manager_all_cities = false;
      this.form.manager_fleet_id = null;
    }
    // A franchise role is tied to a single city — "all cities" doesn't apply.
    if (this.selectedRoleRequiresFleet() && this.form.manager_all_cities) {
      this.form.manager_all_cities = false;
    }
    if (!this.selectedRoleRequiresFleet()) {
      this.form.manager_fleet_id = null;
    }
  }

  // City dropdown is driven by a string: '' (none), 'all' (every city) or a city id.
  get citySelect(): string {
    if (this.form.manager_all_cities) return 'all';
    return this.form.manager_city_id != null ? String(this.form.manager_city_id) : '';
  }
  onCitySelectChange(value: string): void {
    if (value === 'all') {
      this.form.manager_all_cities = true;
      this.form.manager_city_id = null;
    } else {
      this.form.manager_all_cities = false;
      this.form.manager_city_id = value === '' ? null : Number(value);
    }
    this.onCityChange();
  }

  onCityChange(): void {
    if (this.form.manager_fleet_id) {
      const fleet = this.fleetOptions.find((f) => f.id === this.form.manager_fleet_id);
      if (fleet && fleet.city_id !== this.form.manager_city_id) {
        this.form.manager_fleet_id = null;
      }
    }
  }

  get filteredFleets(): FleetOption[] {
    if (!this.form.manager_city_id) return [];
    return this.fleetOptions.filter((f) => f.city_id === this.form.manager_city_id);
  }

  // ── Create / edit ───────────────────────────────────────────────
  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.dialogOpen = true;
  }

  openEdit(m: ManagerRow): void {
    this.editingId = m.id;
    this.form = {
      name: m.name,
      email: m.email,
      phone: m.phone || '',
      password: '',
      manager_role_id: m.manager_role_id,
      manager_city_id: m.manager_city_id,
      manager_all_cities: m.manager_all_cities,
      manager_fleet_id: m.manager_fleet_id,
    };
    this.dialogOpen = true;
  }

  submit(): void {
    if (!this.form.name.trim()) { this.toast.warning('Name is required'); return; }
    if (!this.form.email.trim()) { this.toast.warning('Email is required'); return; }
    if (!this.editingId && !this.form.password) { this.toast.warning('Password is required'); return; }
    if (!this.form.manager_role_id) { this.toast.warning('Role is required'); return; }
    if (!this.isSuperAdminRole() && !this.form.manager_all_cities && !this.form.manager_city_id) {
      this.toast.warning('Select a city (or "All cities") for this role');
      return;
    }
    if (this.selectedRoleRequiresFleet() && !this.form.manager_fleet_id) {
      this.toast.warning('Franchise is required for this role');
      return;
    }

    const body: any = {
      name: this.form.name.trim(),
      email: this.form.email.trim(),
      phone: this.form.phone || null,
      manager_role_id: this.form.manager_role_id,
      manager_city_id: this.form.manager_all_cities ? null : this.form.manager_city_id,
      manager_all_cities: this.form.manager_all_cities,
      manager_fleet_id: this.selectedRoleRequiresFleet() ? this.form.manager_fleet_id : null,
    };
    if (this.form.password) body.password = this.form.password;

    this.saving = true;
    const req$ = this.editingId
      ? this.api.patch(`/admin/managers/${this.editingId}`, body)
      : this.api.post(`/admin/managers`, body);

    req$.subscribe({
      next: () => {
        this.saving = false;
        this.dialogOpen = false;
        this.toast.success(this.editingId ? 'Manager updated' : 'Manager created');
        this.loadManagers();
      },
      error: (e) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Save failed');
      },
    });
  }

  // ── Suspend / unsuspend / delete ────────────────────────────────
  confirmSuspend(): void {
    const m = this.suspendTarget;
    if (!m || this.busy) return;
    this.busy = true;
    this.api.post(`/admin/managers/${m.id}/suspend`, {}).subscribe({
      next: () => {
        this.busy = false;
        this.suspendTarget = null;
        this.toast.success('Manager suspended');
        this.loadManagers();
      },
      error: (e) => {
        this.busy = false;
        this.toast.error(e?.error?.message || 'Suspend failed');
      },
    });
  }

  unsuspend(m: ManagerRow): void {
    this.api.post(`/admin/managers/${m.id}/unsuspend`, {}).subscribe({
      next: () => { this.toast.success('Manager unsuspended'); this.loadManagers(); },
      error: (e) => this.toast.error(e?.error?.message || 'Unsuspend failed'),
    });
  }

  confirmDelete(): void {
    const m = this.deleteTarget;
    if (!m || this.busy) return;
    this.busy = true;
    this.api.delete(`/admin/managers/${m.id}`).subscribe({
      next: () => {
        this.busy = false;
        this.deleteTarget = null;
        this.toast.success('Manager deleted');
        this.loadManagers();
      },
      error: (e) => {
        this.busy = false;
        this.toast.error(e?.error?.message || 'Delete failed');
      },
    });
  }
}

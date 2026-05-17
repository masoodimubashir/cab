import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { PasswordModule } from 'primeng/password';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ApiService } from '../../core/api.service';

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
  city_name: string | null;
  manager_fleet_id: number | null;
  fleet_name: string | null;
  is_suspended: boolean;
  status: string;
  created_at: string;
}

@Component({
  selector: 'app-managers',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonModule, TableModule, DialogModule,
    InputTextModule, DropdownModule, PasswordModule,
    TagModule, ToastModule, ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <div class="page-head">
      <div>
        <h2 class="page-title">Manager Settings</h2>
        <p class="muted small">Admin-panel users. Each manager has a role, a city and (for franchise roles) a fleet.</p>
      </div>
      <button pButton type="button" icon="pi pi-plus" label="Add Manager"
              class="p-button-sm" (click)="openCreate()"></button>
    </div>

    <div class="toolbar">
      <div class="tabs">
        <button class="tab" [class.active]="tab === 'active'" (click)="setTab('active')">Active</button>
        <button class="tab" [class.active]="tab === 'inactive'" (click)="setTab('inactive')">Inactive</button>
      </div>
      <input
        pInputText
        type="text"
        placeholder="Search by name, email or phone…"
        [(ngModel)]="searchText"
        (ngModelChange)="onSearch()"
        class="search"
        name="managers_search"
        autocomplete="off"
        spellcheck="false"
      />
    </div>

    <p-table [value]="managers" styleClass="p-datatable-sm" [rowHover]="true" [paginator]="managers.length > 20" [rows]="20">
      <ng-template pTemplate="header">
        <tr>
          <th style="width: 70px;">ID</th>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>City</th>
          <th>Franchise</th>
          <th>Status</th>
          <th style="width: 220px;">Action</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-m>
        <tr>
          <td>{{ m.id }}</td>
          <td><strong>{{ m.name }}</strong></td>
          <td class="email">{{ m.email }}</td>
          <td>
            <p-tag [value]="m.role?.name || '—'" severity="info"></p-tag>
          </td>
          <td>{{ m.city_name || '—' }}</td>
          <td>{{ m.fleet_name || '—' }}</td>
          <td>
            <p-tag
              [value]="m.is_suspended ? 'Suspended' : 'Active'"
              [severity]="m.is_suspended ? 'danger' : 'success'"
            ></p-tag>
          </td>
          <td class="actions">
            <button pButton type="button" label="Edit" class="p-button-sm"
                    (click)="openEdit(m)"></button>
            <button pButton type="button"
                    *ngIf="m.role?.is_suspendable && !m.is_suspended"
                    label="Suspend"
                    class="p-button-sm p-button-warning"
                    (click)="suspend(m)"></button>
            <button pButton type="button"
                    *ngIf="m.is_suspended"
                    label="Unsuspend"
                    class="p-button-sm p-button-success"
                    (click)="unsuspend(m)"></button>
            <button pButton type="button"
                    *ngIf="!m.role?.is_system"
                    icon="pi pi-trash"
                    class="p-button-sm p-button-text p-button-danger"
                    (click)="remove(m)"></button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="8" class="empty">No managers match the current filters.</td></tr>
      </ng-template>
    </p-table>

    <!-- Add / Edit dialog -->
    <p-dialog
      [header]="editingId ? 'Edit Manager' : 'Add Manager'"
      [(visible)]="dialogOpen"
      [modal]="true"
      [style]="{ width: '680px' }"
      [draggable]="false"
    >
      <div class="form-grid">
        <div class="col">
          <label class="lbl">Name *</label>
          <input pInputText [(ngModel)]="form.name" name="manager_name" autocomplete="off" />

          <label class="lbl">Email *</label>
          <input pInputText [(ngModel)]="form.email" type="email" name="manager_email" autocomplete="off" />

          <label class="lbl">Phone</label>
          <input pInputText [(ngModel)]="form.phone" name="manager_phone" autocomplete="off" />

          <label class="lbl">
            {{ editingId ? 'New Password (leave blank to keep)' : 'Password *' }}
          </label>
          <p-password [(ngModel)]="form.password" [toggleMask]="true" [feedback]="false"
                      styleClass="full-pw" inputStyleClass="full-pw__inp"
                      autocomplete="new-password"></p-password>
        </div>

        <div class="col">
          <label class="lbl">Role *</label>
          <p-dropdown
            [options]="roleOptions"
            [(ngModel)]="form.manager_role_id"
            (onChange)="onRoleChange()"
            optionLabel="name"
            optionValue="id"
            placeholder="Select a role"
            appendTo="body"
          ></p-dropdown>

          <ng-container *ngIf="!isSuperAdminRole()">
            <label class="lbl">City *</label>
            <p-dropdown
              [options]="cityOptions"
              [(ngModel)]="form.manager_city_id"
              (onChange)="onCityChange()"
              optionLabel="name"
              optionValue="id"
              placeholder="Select a city"
              appendTo="body"
            ></p-dropdown>
          </ng-container>

          <ng-container *ngIf="selectedRoleRequiresFleet()">
            <label class="lbl">Franchise (Fleet) *</label>
            <p-dropdown
              [options]="filteredFleets"
              [(ngModel)]="form.manager_fleet_id"
              optionLabel="name"
              optionValue="id"
              placeholder="Select a franchise"
              appendTo="body"
              [disabled]="!form.manager_city_id"
            ></p-dropdown>
            <div *ngIf="form.manager_city_id && filteredFleets.length === 0" class="hint">
              No fleets in this city yet. Create one in Settings → Fleets first.
            </div>
          </ng-container>

          <div class="role-note" *ngIf="selectedRole()">
            <strong>{{ selectedRole()?.name }}</strong> — this role grants the permissions shown on the Roles & Permissions page.
          </div>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary" (click)="dialogOpen = false"></button>
        <button pButton type="button"
                [label]="editingId ? 'Save' : 'Create'"
                (click)="submit()" [loading]="saving"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .page-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
    .page-title { margin: 0 0 4px; font-size: 22px; font-weight: 800; color: #0f172a; }
    .muted { color: #64748b; }
    .small { font-size: 12px; }

    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
    .tabs {
      display: flex; gap: 0; background: #f1f5f9; border-radius: 10px;
      padding: 4px; max-width: 280px;
    }
    .tab {
      flex: 1; padding: 8px 16px; background: transparent; border: 0;
      border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12.5px; color: #475569;
    }
    .tab.active { background: #06b6d4; color: #fff; }
    .search { width: 320px; max-width: 50vw; }

    .empty { padding: 28px; text-align: center; color: #64748b; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .email { color: #475569; font-size: 13px; }

    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .col { display: flex; flex-direction: column; gap: 6px; }
    .lbl { font-size: 12px; font-weight: 700; color: #475569; margin-top: 6px; }
    .col input[pInputText] { width: 100%; }
    :host ::ng-deep .col .p-dropdown { width: 100%; }
    :host ::ng-deep .full-pw,
    :host ::ng-deep .full-pw .full-pw__inp { width: 100%; }
    .hint {
      margin-top: 6px;
      padding: 6px 10px;
      background: rgba(245, 158, 11, 0.1);
      color: #92400e;
      border-left: 3px solid #f59e0b;
      border-radius: 4px;
      font-size: 12px;
    }
    .role-note {
      margin-top: 14px;
      padding: 10px 12px;
      background: #ecfeff;
      border-left: 3px solid #06b6d4;
      border-radius: 6px;
      font-size: 12.5px;
      color: #0e7490;
    }
  `],
})
export class ManagersComponent implements OnInit, OnDestroy {
  managers: ManagerRow[] = [];
  tab: 'active' | 'inactive' = 'active';
  searchText = '';

  roleOptions: RoleOption[] = [];
  cityOptions: City[] = [];
  fleetOptions: FleetOption[] = [];

  dialogOpen = false;
  editingId: number | null = null;
  saving = false;
  form = this.blankForm();

  private searchTimer: number | null = null;

  constructor(
    private api: ApiService,
    private msg: MessageService,
    private confirm: ConfirmationService,
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
      manager_fleet_id: null as number | null,
    };
  }

  setTab(t: 'active' | 'inactive'): void {
    if (this.tab === t) return;
    this.tab = t;
    this.loadManagers();
  }

  onSearch(): void {
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => this.loadManagers(), 280);
  }

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
    params.set('status', this.tab);
    const q = this.searchText.trim();
    if (q) params.set('q', q);
    this.api.get<{ data: ManagerRow[] }>(`/admin/managers?${params.toString()}`).subscribe({
      next: (r) => (this.managers = r.data || []),
      error: (e) => this.msg.add({ severity: 'error', summary: e?.error?.message || 'Failed to load managers' }),
    });
  }

  // ── role/city change handlers ─────────────────────────────────────
  selectedRole(): RoleOption | null {
    return this.roleOptions.find((r) => r.id === this.form.manager_role_id) || null;
  }
  isSuperAdminRole(): boolean { return this.selectedRole()?.slug === 'super_admin'; }
  selectedRoleRequiresFleet(): boolean { return !!this.selectedRole()?.requires_fleet; }

  onRoleChange(): void {
    if (this.isSuperAdminRole()) {
      this.form.manager_city_id = null;
      this.form.manager_fleet_id = null;
    }
    if (!this.selectedRoleRequiresFleet()) {
      this.form.manager_fleet_id = null;
    }
  }

  onCityChange(): void {
    // If the previously-picked fleet doesn't belong to the new city, clear it.
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

  // ── dialog ────────────────────────────────────────────────────────
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
      manager_fleet_id: m.manager_fleet_id,
    };
    this.dialogOpen = true;
  }

  submit(): void {
    if (!this.form.name.trim()) { this.msg.add({ severity: 'warn', summary: 'Name is required' }); return; }
    if (!this.form.email.trim()) { this.msg.add({ severity: 'warn', summary: 'Email is required' }); return; }
    if (!this.editingId && !this.form.password) {
      this.msg.add({ severity: 'warn', summary: 'Password is required' });
      return;
    }
    if (!this.form.manager_role_id) {
      this.msg.add({ severity: 'warn', summary: 'Role is required' });
      return;
    }
    if (!this.isSuperAdminRole() && !this.form.manager_city_id) {
      this.msg.add({ severity: 'warn', summary: 'City is required for this role' });
      return;
    }
    if (this.selectedRoleRequiresFleet() && !this.form.manager_fleet_id) {
      this.msg.add({ severity: 'warn', summary: 'Franchise is required for this role' });
      return;
    }

    const body: any = {
      name: this.form.name.trim(),
      email: this.form.email.trim(),
      phone: this.form.phone || null,
      manager_role_id: this.form.manager_role_id,
      manager_city_id: this.form.manager_city_id,
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
        this.msg.add({ severity: 'success', summary: this.editingId ? 'Manager updated' : 'Manager created' });
        this.loadManagers();
      },
      error: (e) => {
        this.saving = false;
        this.msg.add({ severity: 'error', summary: e?.error?.message || 'Save failed' });
      },
    });
  }

  suspend(m: ManagerRow): void {
    this.confirm.confirm({
      message: `Suspend "${m.name}"? They will be logged out immediately and unable to sign in.`,
      accept: () => {
        this.api.post(`/admin/managers/${m.id}/suspend`, {}).subscribe({
          next: () => { this.msg.add({ severity: 'success', summary: 'Suspended' }); this.loadManagers(); },
          error: (e) => this.msg.add({ severity: 'error', summary: e?.error?.message || 'Suspend failed' }),
        });
      },
    });
  }

  unsuspend(m: ManagerRow): void {
    this.api.post(`/admin/managers/${m.id}/unsuspend`, {}).subscribe({
      next: () => { this.msg.add({ severity: 'success', summary: 'Unsuspended' }); this.loadManagers(); },
      error: (e) => this.msg.add({ severity: 'error', summary: e?.error?.message || 'Unsuspend failed' }),
    });
  }

  remove(m: ManagerRow): void {
    this.confirm.confirm({
      message: `Delete manager "${m.name}"? This cannot be undone.`,
      accept: () => {
        this.api.delete(`/admin/managers/${m.id}`).subscribe({
          next: () => { this.msg.add({ severity: 'success', summary: 'Deleted' }); this.loadManagers(); },
          error: (e) => this.msg.add({ severity: 'error', summary: e?.error?.message || 'Delete failed' }),
        });
      },
    });
  }
}

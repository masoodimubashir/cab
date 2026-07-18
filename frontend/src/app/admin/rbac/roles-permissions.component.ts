import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputSwitchModule } from 'primeng/inputswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ApiService } from '../../core/api.service';
import { IconComponent, StatusPillComponent } from '../../ui';

interface PermissionRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
}

interface PermissionGroup {
  group: string;
  permissions: PermissionRow[];
}

interface RoleRow {
  id: number;
  slug: string;
  name: string;
  is_system: boolean;
  is_suspendable: boolean;
  requires_fleet: boolean;
  sort_order: number;
  managers_count: number;
  permission_slugs?: string[];
}

@Component({
  selector: 'app-roles-permissions',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonModule, DialogModule, InputTextModule, InputSwitchModule, CheckboxModule,
    ToastModule, ConfirmDialogModule,
    IconComponent, StatusPillComponent,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <div class="rbac-page">
      <header class="hero">
        <div class="hero__copy">
          <h1>Roles & Permissions</h1>
          <p>Assign module access to admin roles. A module permission grants full access to that module.</p>
        </div>
        <button type="button" class="primary-btn" (click)="openCreate()">
          <tm-icon name="plus" [size]="16" /> Add Role
        </button>
      </header>


      <div class="layout">
        <aside class="roles-panel" aria-label="Roles">
          <div class="panel-head">
            <span>Roles</span>
            <small>{{ roles.length }} total</small>
          </div>
          <button
            type="button"
            class="role-card"
            *ngFor="let r of roles"
            [class.is-active]="selected?.id === r.id"
            (click)="selectRole(r)"
          >
            <div class="role-card__main">
              <strong>{{ r.name }}</strong>
              <span>{{ moduleCountLabel(r) }}</span>
            </div>
            <div class="badges">
              <span class="badge badge--system" *ngIf="r.is_system">System</span>
              <span class="badge" *ngIf="r.requires_fleet">Franchise</span>
            </div>
          </button>
          <div *ngIf="!roles.length" class="empty">No roles yet.</div>
        </aside>

        <main class="detail" *ngIf="selected; else nothingSelected">
          <section class="detail-head">
            <div>
              <div class="detail-title-row">
                <h2>{{ selected.name }}</h2>
                <tm-status-pill *ngIf="selected.is_system" tone="info">System</tm-status-pill>
              </div>
              <p>{{ moduleCountLabel(selected) }}</p>
            </div>
            <div class="actions" *ngIf="!selected.is_system">
              <button type="button" class="secondary-btn" (click)="openEdit(selected)">
                <tm-icon name="edit" [size]="15" /> Edit
              </button>
              <button type="button" class="danger-btn" [disabled]="selected.managers_count > 0" (click)="remove(selected)">
                <tm-icon name="trash" [size]="15" /> Delete
              </button>
            </div>
          </section>

          <section class="facts">
            <div class="fact">
              <span>Slug</span>
              <code>{{ selected.slug }}</code>
            </div>
            <div class="fact">
              <span>Can be suspended</span>
              <strong>{{ selected.is_suspendable ? 'Yes' : 'No' }}</strong>
            </div>
            <div class="fact">
              <span>Franchise required</span>
              <strong>{{ selected.requires_fleet ? 'Yes' : 'No' }}</strong>
            </div>
          </section>

          <section class="modules-head">
            <div>
              <h3>Module Access</h3>
            </div>
          </section>

          <section class="module-grid">
            <div class="module-item is-on is-locked">
              <span class="module-item__check">
                <tm-icon name="check" [size]="13" />
              </span>
              <div>
                <strong>Dashboard <em class="lock-tag">Always on</em></strong>
                <small>Every role can open the dashboard.</small>
              </div>
            </div>
            <div class="module-item" *ngFor="let p of modules" [class.is-on]="hasPermission(p.slug)">
              <span class="module-item__check">
                <tm-icon *ngIf="hasPermission(p.slug)" name="check" [size]="13" />
              </span>
              <div>
                <strong>{{ p.name }}</strong>
                <small>{{ p.description }}</small>
              </div>
            </div>
          </section>
        </main>

        <ng-template #nothingSelected>
          <main class="detail empty-detail">
            <tm-icon name="shield" [size]="26" />
            <p>Select a role to inspect module access.</p>
          </main>
        </ng-template>
      </div>
    </div>

    <p-dialog
      [(visible)]="dialogOpen"
      [modal]="true"
      [draggable]="false"
      [style]="{ width: 'min(1080px, 94vw)' }"
      [contentStyle]="{ padding: '0' }"
      styleClass="role-dialog"
    >
      <ng-template pTemplate="header">
        <div class="dialog-title">
          <strong>{{ editingId ? 'Edit Role' : 'Create Role' }}</strong>
          <span>{{ editingId ? 'Update module access and role settings.' : 'Create a role and choose the modules it can access.' }}</span>
        </div>
      </ng-template>

      <div class="role-form">
        <section class="form-section form-section--identity">
          <label class="field">
            <span>Name *</span>
            <input pInputText [(ngModel)]="form.name" [disabled]="!!editingId" placeholder="e.g. City Manager" />
            <small class="field-hint" *ngIf="!editingId">A short, unique ID is generated from this name automatically.</small>
          </label>

          <div class="switch-grid">
            <div class="switch-card">
              <span>
                <strong>Users with this role can be suspended</strong>
                <small>Turn off for protected roles such as Super Admin.</small>
              </span>
              <p-inputSwitch [(ngModel)]="form.is_suspendable"></p-inputSwitch>
            </div>
            <div class="switch-card">
              <span>
                <strong>Requires franchise assignment</strong>
                <small>Managers with this role must be tied to a fleet.</small>
              </span>
              <p-inputSwitch [(ngModel)]="form.requires_fleet"></p-inputSwitch>
            </div>
          </div>
        </section>

        <section class="form-section">
          <div class="module-picker-head">
            <div>
              <h3>Module Access</h3>
              <p [class.is-warn]="!form.permission_slugs.length">
                {{ form.permission_slugs.length }} selected · pick at least one module (Dashboard is always included).
              </p>
            </div>
            <div class="quick-actions">
              <button type="button" (click)="selectAll()">Select all</button>
              <button type="button" (click)="clearAll()">Clear</button>
            </div>
          </div>

          <div class="module-picker">
            <!-- Dashboard is a baseline every role gets — shown ticked + locked
                 so it's obvious it's always included, but it can't be toggled. -->
            <div class="module-option is-on is-locked">
              <p-checkbox [binary]="true" [ngModel]="true" [disabled]="true"></p-checkbox>
              <span>
                <strong>Dashboard <em class="lock-tag">Always on</em></strong>
                <small>Every role can open the dashboard.</small>
              </span>
            </div>
            <label class="module-option" *ngFor="let p of modules" [class.is-on]="formHasPermission(p.slug)">
              <p-checkbox [binary]="true" [ngModel]="formHasPermission(p.slug)" (ngModelChange)="toggleFormPermission(p.slug, $event)"></p-checkbox>
              <span>
                <strong>{{ p.name }}</strong>
                <small>{{ p.description }}</small>
              </span>
            </label>
          </div>
        </section>
      </div>

      <ng-template pTemplate="footer">
        <div class="dialog-footer">
          <button type="button" class="secondary-btn" (click)="dialogOpen = false">Cancel</button>
          <button type="button" class="primary-btn" (click)="submit()" [disabled]="saving || !form.permission_slugs.length">
            {{ saving ? 'Saving...' : (editingId ? 'Update Role' : 'Create Role') }}
          </button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    :host { display: block; }
    .rbac-page { display: flex; flex-direction: column; gap: 18px; }
    .hero {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
      padding: 22px; border: 1px solid var(--tm-line); border-radius: 8px; background: #fff;
      box-shadow: var(--tm-shadow-sm);
    }
    .hero h1 { margin: 0; font-size: clamp(26px, 3vw, 38px); color: var(--tm-text); letter-spacing: 0; }
    .hero p { margin: 6px 0 0; color: var(--tm-text-muted); font-size: 14px; }
    .primary-btn, .secondary-btn, .danger-btn {
      min-height: 38px; border-radius: 8px; border: 1px solid var(--tm-line); padding: 0 13px;
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      font: 800 13px var(--tm-font-body); cursor: pointer; white-space: nowrap;
    }
    .primary-btn { background: var(--tm-green); border-color: var(--tm-green); color: #fff; }
    .secondary-btn { background: #fff; color: var(--tm-text); }
    .danger-btn { background: #fff; color: var(--tm-danger, #dc2626); border-color: color-mix(in srgb, var(--tm-danger, #dc2626) 24%, var(--tm-line)); }
    .danger-btn:disabled, .primary-btn:disabled { opacity: .5; cursor: default; }
    .layout { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: 16px; align-items: start; }
    .roles-panel, .detail { border: 1px solid var(--tm-line); border-radius: 8px; background: #fff; box-shadow: var(--tm-shadow-sm); }
    .roles-panel { padding: 8px; max-height: calc(100vh - 220px); overflow: auto; }
    .panel-head { display: flex; justify-content: space-between; padding: 10px 10px 12px; color: var(--tm-text); font-weight: 850; }
    .panel-head small { color: var(--tm-text-muted); font-weight: 750; }
    .role-card { width: 100%; text-align: left; border: 0; background: transparent; border-radius: 8px; padding: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 8px; }
    .role-card:hover { background: var(--tm-canvas-2); }
    .role-card.is-active { background: var(--tm-green-tint); box-shadow: inset 0 0 0 1px var(--tm-green-deep); }
    .role-card__main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .role-card__main strong { color: var(--tm-text); font-size: 14px; }
    .role-card__main span { color: var(--tm-text-muted); font-size: 12px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .badges { display: flex; gap: 6px; flex-wrap: wrap; }
    .badge { padding: 3px 8px; border-radius: var(--tm-radius-pill); background: var(--tm-warning-bg); color: var(--tm-warning-fg); font-size: 10px; font-weight: 850; text-transform: uppercase; }
    .badge--system { background: var(--tm-info-bg); color: var(--tm-info-fg); }
    .detail { padding: 20px; min-height: 520px; }
    .detail-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .detail-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .detail h2 { margin: 0; color: var(--tm-text); font-size: 22px; }
    .detail-head p, .modules-head p, .module-picker-head p { margin: 5px 0 0; color: var(--tm-text-muted); font-size: 13px; }
    .module-picker-head p.is-warn { color: var(--tm-danger, #dc2626); font-weight: 750; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
    .fact { padding: 12px; border-radius: 8px; background: var(--tm-canvas-2); display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .fact span { color: var(--tm-text-muted); font-size: 11px; font-weight: 850; text-transform: uppercase; letter-spacing: .04em; }
    .fact strong, .fact code { color: var(--tm-text); font-weight: 850; overflow-wrap: anywhere; }
    .fact code { font-family: var(--tm-font-mono); font-size: 12px; }
    .modules-head, .module-picker-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-end; margin-bottom: 12px; }
    .modules-head h3, .module-picker-head h3 { margin: 0; color: var(--tm-text); font-size: 16px; }
    .module-grid, .module-picker { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .module-item, .module-option { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid var(--tm-line); border-radius: 8px; background: #fff; }
    .module-item { opacity: .45; min-height: 72px; }
    .module-item.is-on { opacity: 1; background: color-mix(in srgb, var(--tm-green-tint) 55%, #fff); }
    .module-item__check { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--tm-line); display: inline-flex; align-items: center; justify-content: center; color: var(--tm-green-deep); flex: 0 0 auto; }
    .module-item.is-on .module-item__check { border-color: var(--tm-green-deep); background: #fff; }
    .module-item strong, .module-option strong { display: block; color: var(--tm-text); font-size: 13px; }
    .module-item small, .module-option small { display: block; color: var(--tm-text-muted); font-size: 12px; line-height: 1.35; margin-top: 2px; }
    .empty, .empty-detail { color: var(--tm-text-muted); text-align: center; }
    .empty { padding: 22px; font-size: 13px; }
    .empty-detail { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
    .dialog-title { display: flex; flex-direction: column; gap: 2px; }
    .dialog-title strong { color: var(--tm-text); font-size: 18px; }
    .dialog-title span { color: var(--tm-text-muted); font-size: 12px; }
    .role-form { display: flex; flex-direction: column; gap: 0; }
    .form-section { padding: 18px; border-bottom: 1px solid var(--tm-line); }
    .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 6px; color: var(--tm-text); font-size: 12px; font-weight: 850; }
    .field input, .field textarea { width: 100%; border-radius: 8px; }
    .field-hint { color: var(--tm-text-muted); font-size: 11px; font-weight: 650; }
    .switch-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .switch-card { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 12px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-canvas-2); }
    .switch-card span { display: flex; flex-direction: column; gap: 2px; }
    .switch-card strong { color: var(--tm-text); font-size: 13px; }
    .switch-card small { color: var(--tm-text-muted); font-size: 12px; line-height: 1.35; }
    .quick-actions { display: flex; gap: 6px; }
    .quick-actions button { border: 1px solid var(--tm-line); background: #fff; border-radius: 8px; min-height: 32px; padding: 0 10px; font-weight: 800; color: var(--tm-text); cursor: pointer; }
    .module-option { cursor: pointer; }
    .module-option.is-on { background: color-mix(in srgb, var(--tm-green-tint) 55%, #fff); }
    .module-option.is-locked, .module-item.is-locked { cursor: default; border-style: dashed; }
    .lock-tag { font-style: normal; font-size: 10px; font-weight: 850; text-transform: uppercase; letter-spacing: .03em;
      color: var(--tm-green-deep); background: var(--tm-green-tint); border-radius: var(--tm-radius-pill); padding: 2px 7px; margin-left: 6px; }
    .dialog-footer { display: flex; justify-content: flex-end; gap: 8px; width: 100%; }
    :host ::ng-deep .role-dialog .p-dialog-header { padding: 18px 18px 12px; }
    :host ::ng-deep .role-dialog .p-dialog-footer { padding: 14px 18px; border-top: 1px solid var(--tm-line); }
    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .roles-panel { max-height: none; }
      .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      .hero { flex-direction: column; padding: 18px; }
      .primary-btn { width: 100%; }
      .module-grid, .module-picker, .field-grid, .switch-grid { grid-template-columns: 1fr; }
      .detail-head, .modules-head, .module-picker-head { flex-direction: column; align-items: stretch; }
      .actions { justify-content: flex-start; }
      .facts { grid-template-columns: 1fr; }
    }
  `],
})
export class RolesPermissionsComponent implements OnInit {
  roles: RoleRow[] = [];
  groups: PermissionGroup[] = [];
  selected: RoleRow | null = null;

  dialogOpen = false;
  editingId: number | null = null;
  saving = false;
  form = this.blankForm();

  constructor(
    private api: ApiService,
    private msg: MessageService,
    private confirm: ConfirmationService,
  ) {}

  ngOnInit(): void {
    this.loadPermissions();
    this.loadRoles();
  }

  get moduleCount(): number {
    return this.groups.reduce((sum, group) => sum + group.permissions.length, 0);
  }

  get modules(): PermissionRow[] {
    return this.groups.flatMap((group) => group.permissions);
  }

  /** "5 of 18 modules" — used on the role cards and detail header. */
  moduleCountLabel(r: RoleRow): string {
    const n = r.permission_slugs?.length ?? 0;
    if (r.is_system) return 'Full access — every module';
    return `${n} of ${this.modules.length} modules`;
  }

  blankForm() {
    return {
      name: '',
      is_suspendable: true,
      requires_fleet: false,
      sort_order: 100,
      permission_slugs: [] as string[],
    };
  }

  // Modules temporarily hidden from the role editor (not part of the first
  // release). The permission still exists in the DB, so nobody loses a grant —
  // it just isn't offered as a checkbox. Empty this list to bring them back.
  private readonly hiddenSlugs = new Set<string>(['app_assets']);

  loadPermissions(): void {
    this.api.get<{ grouped: PermissionGroup[] }>('/admin/permissions').subscribe({
      next: (r) =>
        (this.groups = (r.grouped ?? [])
          .map((g) => ({ ...g, permissions: g.permissions.filter((p) => !this.hiddenSlugs.has(p.slug)) }))
          .filter((g) => g.permissions.length > 0)),
      error: () => this.msg.add({ severity: 'error', summary: 'Failed to load permissions' }),
    });
  }

  loadRoles(reselectId?: number): void {
    this.api.get<{ data: RoleRow[] }>('/admin/manager-roles?with_permissions=1').subscribe({
      next: (r) => {
        this.roles = r.data ?? [];
        const target = reselectId
          ? this.roles.find((x) => x.id === reselectId)
          : (this.selected ? this.roles.find((x) => x.id === this.selected!.id) : this.roles[0]);
        this.selected = target || this.roles[0] || null;
      },
      error: () => this.msg.add({ severity: 'error', summary: 'Failed to load roles' }),
    });
  }

  selectRole(r: RoleRow): void { this.selected = r; }

  hasPermission(slug: string): boolean {
    return !!this.selected?.permission_slugs?.includes(slug);
  }

  formHasPermission(slug: string): boolean {
    return this.form.permission_slugs.includes(slug);
  }

  toggleFormPermission(slug: string, on: boolean): void {
    if (on) {
      if (!this.form.permission_slugs.includes(slug)) this.form.permission_slugs.push(slug);
    } else {
      this.form.permission_slugs = this.form.permission_slugs.filter((s) => s !== slug);
    }
  }

  selectAll(): void {
    this.form.permission_slugs = Array.from(new Set(this.modules.map((p) => p.slug)));
  }
  clearAll(): void { this.form.permission_slugs = []; }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.dialogOpen = true;
  }

  openEdit(r: RoleRow): void {
    this.editingId = r.id;
    this.form = {
      name: r.name,
      is_suspendable: r.is_suspendable,
      requires_fleet: r.requires_fleet,
      sort_order: r.sort_order,
      permission_slugs: [...(r.permission_slugs || [])],
    };
    this.dialogOpen = true;
  }

  submit(): void {
    if (!this.editingId && !this.form.name.trim()) { this.msg.add({ severity: 'warn', summary: 'Name is required' }); return; }
    if (!this.form.permission_slugs.length) { this.msg.add({ severity: 'warn', summary: 'Select at least one module for this role.' }); return; }
    const body: any = {
      is_suspendable: this.form.is_suspendable,
      requires_fleet: this.form.requires_fleet,
      sort_order: this.form.sort_order,
      permission_slugs: this.form.permission_slugs,
    };
    if (!this.editingId) {
      // Slug is derived from the name server-side.
      body.name = this.form.name.trim();
    }

    this.saving = true;
    const req$ = this.editingId
      ? this.api.patch<{ role: RoleRow }>(`/admin/manager-roles/${this.editingId}`, body)
      : this.api.post<{ role: RoleRow }>(`/admin/manager-roles`, body);

    req$.subscribe({
      next: (res) => {
        this.saving = false;
        this.dialogOpen = false;
        this.msg.add({ severity: 'success', summary: this.editingId ? 'Role updated' : 'Role created' });
        this.loadRoles(res.role?.id);
      },
      error: (e) => {
        this.saving = false;
        this.msg.add({ severity: 'error', summary: e?.error?.message || 'Save failed' });
      },
    });
  }

  remove(r: RoleRow): void {
    if (r.managers_count > 0) {
      this.msg.add({ severity: 'warn', summary: 'Reassign managers before deleting.' });
      return;
    }
    this.confirm.confirm({
      message: `Delete role "${r.name}"? This cannot be undone.`,
      accept: () => {
        this.api.delete(`/admin/manager-roles/${r.id}`).subscribe({
          next: () => {
            this.msg.add({ severity: 'success', summary: 'Role deleted' });
            this.selected = null;
            this.loadRoles();
          },
          error: (e) => this.msg.add({ severity: 'error', summary: e?.error?.message || 'Delete failed' }),
        });
      },
    });
  }
}

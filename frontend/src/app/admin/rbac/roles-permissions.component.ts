import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { InputSwitchModule } from 'primeng/inputswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ApiService } from '../../core/api.service';

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
  description: string | null;
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
    ButtonModule, DialogModule,
    InputTextModule, InputTextareaModule, InputSwitchModule, CheckboxModule,
    TagModule, ToastModule, ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <div class="page-head">
      <div>
        <h2 class="page-title">Roles & Permissions</h2>
        <p class="muted small">
          Bundle permissions into roles, then assign managers to roles. Super Admin sees everything and can't be edited.
        </p>
      </div>
      <button pButton type="button" icon="pi pi-plus" label="Add Role"
              class="p-button-sm" (click)="openCreate()"></button>
    </div>

    <div class="layout">
      <!-- ROLES LIST -->
      <aside class="roles">
        <div class="role"
             *ngFor="let r of roles"
             [class.role--active]="selected?.id === r.id"
             (click)="selectRole(r)">
          <div class="role__name">
            {{ r.name }}
            <span *ngIf="r.is_system" class="pill pill--sys">system</span>
            <span *ngIf="r.requires_fleet" class="pill pill--fleet">franchise</span>
          </div>
          <div class="role__meta">
            <span>{{ r.permission_slugs?.length || 0 }} permissions</span>
            <span>·</span>
            <span>{{ r.managers_count }} manager{{ r.managers_count === 1 ? '' : 's' }}</span>
          </div>
        </div>
        <div *ngIf="!roles.length" class="empty">No roles yet.</div>
      </aside>

      <!-- DETAIL -->
      <section class="detail" *ngIf="selected; else nothingSelected">
        <div class="detail__head">
          <div>
            <h3 class="detail__title">{{ selected.name }}</h3>
            <p class="muted small">{{ selected.description || 'No description.' }}</p>
          </div>
          <div class="detail__actions" *ngIf="!selected.is_system">
            <button pButton type="button" label="Edit" class="p-button-sm" icon="pi pi-pencil"
                    (click)="openEdit(selected)"></button>
            <button pButton type="button" label="Delete"
                    class="p-button-sm p-button-text p-button-danger"
                    [disabled]="selected.managers_count > 0"
                    icon="pi pi-trash"
                    (click)="remove(selected)"></button>
          </div>
          <div class="detail__actions" *ngIf="selected.is_system">
            <p-tag value="System role — read-only" severity="info"></p-tag>
          </div>
        </div>

        <div class="props">
          <div class="prop">
            <span class="prop__lbl">Slug</span>
            <code>{{ selected.slug }}</code>
          </div>
          <div class="prop">
            <span class="prop__lbl">Suspendable</span>
            <span>{{ selected.is_suspendable ? 'Yes' : 'No' }}</span>
          </div>
          <div class="prop">
            <span class="prop__lbl">Requires franchise</span>
            <span>{{ selected.requires_fleet ? 'Yes' : 'No' }}</span>
          </div>
        </div>

        <h4 class="section-title">Permissions ({{ selected.permission_slugs?.length || 0 }})</h4>

        <div class="groups">
          <div class="group-card" *ngFor="let g of groups">
            <div class="group-card__head">
              <span>{{ g.group }}</span>
              <span class="muted small">
                {{ countSelectedInGroup(g) }} / {{ g.permissions.length }}
              </span>
            </div>
            <ul class="perm-list">
              <li *ngFor="let p of g.permissions" class="perm">
                <p-checkbox
                  [binary]="true"
                  [ngModel]="hasPermission(p.slug)"
                  [disabled]="true"
                ></p-checkbox>
                <div class="perm__body">
                  <div class="perm__name">{{ p.name }}</div>
                  <div class="perm__desc" *ngIf="p.description">{{ p.description }}</div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <ng-template #nothingSelected>
        <section class="detail detail--empty">
          <p class="muted">Select a role on the left to see its permissions.</p>
        </section>
      </ng-template>
    </div>

    <!-- Add / Edit dialog -->
    <p-dialog
      [header]="editingId ? 'Edit Role' : 'Add Role'"
      [(visible)]="dialogOpen"
      [modal]="true"
      [style]="{ width: '880px' }"
      [draggable]="false"
    >
      <div class="form">
        <div class="form-grid">
          <div class="col">
            <label class="lbl">Name *</label>
            <input pInputText [(ngModel)]="form.name" placeholder="e.g. City Manager" />

            <label class="lbl">Slug * <span class="muted small">(letters, digits, underscore — locked after creation)</span></label>
            <input pInputText [(ngModel)]="form.slug" [disabled]="!!editingId"
                   placeholder="city_manager" (input)="normalizeSlug()" />
          </div>
          <div class="col">
            <label class="lbl">Description</label>
            <textarea pInputTextarea rows="3" [(ngModel)]="form.description"
                      placeholder="Short summary of what this role can do."></textarea>

            <div class="switch-row">
              <span>Allow suspending users with this role</span>
              <p-inputSwitch [(ngModel)]="form.is_suspendable"></p-inputSwitch>
            </div>
            <div class="switch-row">
              <span>Require a franchise (fleet) assignment</span>
              <p-inputSwitch [(ngModel)]="form.requires_fleet"></p-inputSwitch>
            </div>
          </div>
        </div>

        <h4 class="section-title">Permissions</h4>
        <div class="quick">
          <button pButton type="button" class="p-button-sm p-button-text" label="Select all" (click)="selectAll()"></button>
          <button pButton type="button" class="p-button-sm p-button-text p-button-secondary" label="Clear all" (click)="clearAll()"></button>
        </div>

        <div class="groups">
          <div class="group-card" *ngFor="let g of groups">
            <div class="group-card__head">
              <label class="all-toggle">
                <p-checkbox
                  [binary]="true"
                  [ngModel]="isGroupFullySelected(g)"
                  (ngModelChange)="toggleGroup(g, $event)"
                ></p-checkbox>
                {{ g.group }}
              </label>
              <span class="muted small">
                {{ countSelectedInForm(g) }} / {{ g.permissions.length }}
              </span>
            </div>
            <ul class="perm-list">
              <li *ngFor="let p of g.permissions" class="perm">
                <p-checkbox
                  [binary]="true"
                  [ngModel]="formHasPermission(p.slug)"
                  (ngModelChange)="toggleFormPermission(p.slug, $event)"
                ></p-checkbox>
                <div class="perm__body">
                  <div class="perm__name">{{ p.name }}</div>
                  <div class="perm__desc" *ngIf="p.description">{{ p.description }}</div>
                  <div class="perm__slug"><code>{{ p.slug }}</code></div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary" (click)="dialogOpen = false"></button>
        <button pButton type="button"
                [label]="editingId ? 'Update Role' : 'Create Role'"
                (click)="submit()" [loading]="saving"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .page-head {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 18px; gap: 16px;
    }
    .page-title { margin: 0; font-size: 22px; font-weight: 800; color: #0f172a; }
    .muted { color: #64748b; }
    .small { font-size: 12px; }

    .layout {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 18px;
      align-items: start;
    }
    .roles {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 8px;
      max-height: 75vh;
      overflow-y: auto;
    }
    .role {
      padding: 12px 14px;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .role:hover { background: #f1f5f9; }
    .role--active {
      background: #ecfeff;
      box-shadow: inset 0 0 0 1px #06b6d4;
    }
    .role__name {
      font-weight: 700;
      font-size: 14px;
      color: #0f172a;
      display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
    }
    .role__meta {
      margin-top: 4px;
      font-size: 12px;
      color: #64748b;
      display: flex; gap: 6px;
    }
    .pill {
      display: inline-block; padding: 1px 8px; border-radius: 999px;
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
    }
    .pill--sys { background: #ddd6fe; color: #5b21b6; }
    .pill--fleet { background: #fef3c7; color: #92400e; }
    .empty { padding: 24px; text-align: center; color: #94a3b8; font-size: 13px; }

    .detail {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 22px;
      min-height: 60vh;
    }
    .detail--empty { display: flex; align-items: center; justify-content: center; }
    .detail__head {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
    }
    .detail__title { margin: 0 0 4px; font-size: 18px; font-weight: 800; color: #0f172a; }
    .detail__actions { display: flex; gap: 8px; }

    .props {
      display: flex; flex-wrap: wrap; gap: 22px;
      padding: 12px 14px;
      background: #f8fafc;
      border-radius: 8px;
      margin: 14px 0 18px;
    }
    .prop { display: flex; flex-direction: column; gap: 2px; }
    .prop__lbl { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px; }
    .prop code, code { background: #eef2ff; padding: 1px 6px; border-radius: 4px; font-size: 12px; color: #4338ca; }

    .section-title {
      margin: 18px 0 12px;
      font-size: 13px;
      font-weight: 800;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .quick { display: flex; gap: 6px; margin-bottom: 10px; }

    .groups {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .group-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
    }
    .group-card__head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 8px;
      font-weight: 800;
      font-size: 13px;
      color: #0f172a;
    }
    .all-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
    .perm-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .perm { display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; }
    .perm__body { display: flex; flex-direction: column; gap: 1px; }
    .perm__name { font-size: 13px; font-weight: 700; color: #0f172a; }
    .perm__desc { font-size: 11.5px; color: #64748b; }
    .perm__slug { font-size: 11px; }

    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .col { display: flex; flex-direction: column; gap: 6px; }
    .lbl { font-size: 12px; font-weight: 700; color: #475569; margin-top: 6px; }
    .col input[pInputText], .col textarea { width: 100%; }
    .switch-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 12px; background: #f8fafc; border-radius: 8px; margin-top: 10px;
      font-size: 13px; font-weight: 600; color: #0f172a;
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

  blankForm() {
    return {
      slug: '',
      name: '',
      description: '',
      is_suspendable: true,
      requires_fleet: false,
      sort_order: 100,
      permission_slugs: [] as string[],
    };
  }

  loadPermissions(): void {
    this.api.get<{ grouped: PermissionGroup[] }>('/admin/permissions').subscribe({
      next: (r) => (this.groups = r.grouped ?? []),
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

  countSelectedInGroup(g: PermissionGroup): number {
    if (!this.selected?.permission_slugs) return 0;
    return g.permissions.filter((p) => this.selected!.permission_slugs!.includes(p.slug)).length;
  }

  countSelectedInForm(g: PermissionGroup): number {
    return g.permissions.filter((p) => this.form.permission_slugs.includes(p.slug)).length;
  }

  isGroupFullySelected(g: PermissionGroup): boolean {
    return g.permissions.length > 0 &&
      g.permissions.every((p) => this.form.permission_slugs.includes(p.slug));
  }

  toggleGroup(g: PermissionGroup, on: boolean): void {
    const slugs = g.permissions.map((p) => p.slug);
    if (on) {
      this.form.permission_slugs = Array.from(new Set([...this.form.permission_slugs, ...slugs]));
    } else {
      this.form.permission_slugs = this.form.permission_slugs.filter((s) => !slugs.includes(s));
    }
  }

  selectAll(): void {
    const all = this.groups.flatMap((g) => g.permissions.map((p) => p.slug));
    this.form.permission_slugs = Array.from(new Set(all));
  }
  clearAll(): void { this.form.permission_slugs = []; }

  normalizeSlug(): void {
    this.form.slug = (this.form.slug || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.dialogOpen = true;
  }

  openEdit(r: RoleRow): void {
    this.editingId = r.id;
    this.form = {
      slug: r.slug,
      name: r.name,
      description: r.description || '',
      is_suspendable: r.is_suspendable,
      requires_fleet: r.requires_fleet,
      sort_order: r.sort_order,
      permission_slugs: [...(r.permission_slugs || [])],
    };
    this.dialogOpen = true;
  }

  submit(): void {
    if (!this.form.name.trim()) { this.msg.add({ severity: 'warn', summary: 'Name is required' }); return; }
    if (!this.editingId && !this.form.slug.trim()) {
      this.msg.add({ severity: 'warn', summary: 'Slug is required' });
      return;
    }
    const body: any = {
      name: this.form.name.trim(),
      description: this.form.description?.trim() || null,
      is_suspendable: this.form.is_suspendable,
      requires_fleet: this.form.requires_fleet,
      sort_order: this.form.sort_order,
      permission_slugs: this.form.permission_slugs,
    };
    if (!this.editingId) body.slug = this.form.slug.trim();

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

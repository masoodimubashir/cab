import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent } from '../../ui';

interface RideMode {
  id: number;
  city_ride_scope_id: number;
  scope: 'local' | 'outstation';
  mode: 'private' | 'fixed' | 'shuttle';
  kind?: string;
  name: string;
  image_path: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
}

interface RideScope {
  id: number;
  city_id: number;
  scope: 'local' | 'outstation';
  name: string;
  is_active: boolean;
  sort_order: number;
  modes: RideMode[];
}

interface ModeForm {
  name: string;
  is_active: boolean;
  imageFile: File | null;
  preview: string | null;
}

/**
 * Ride Products — the catalogue as a two-step tree for the city chosen in the
 * topbar switcher: one panel per scope (Local / Outstation), each with a master
 * switch and the three mode toggles underneath (Private / Fixed / Shuttle).
 * Customers book in the same two steps. Fixed & Shuttle can be enabled during setup; customers only see them once a
 * matching active route is configured.
 */
@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent],
  template: `
    <p class="intro">
      Ride options offered in this city, grouped the way customers pick them:
      first <strong>Local</strong> or <strong>Outstation</strong>, then
      <strong>Private / Fixed / Shuttle</strong>. Turn a whole scope off with its master
      switch, or toggle one option. Fixed &amp; Shuttle can be enabled during setup; customers see them after a matching active route is configured.
    </p>

    <div class="cue" *ngIf="!cityId">
      <tm-icon name="map-marker" [size]="24" />
      <p class="cue__title">No city selected</p>
      <p class="cue__text">Pick a city from the switcher in the top bar to manage ride options.</p>
    </div>

    <div class="cue" *ngIf="cityId && loading">
      <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading ride options…</p>
    </div>

    <div class="panels" *ngIf="cityId && !loading && scopes.length">
      <section class="panel" *ngFor="let s of scopes" [class.panel--off]="!s.is_active">
        <header class="panel__head">
          <div class="panel__id">
            <tm-icon [name]="scopeIcon(s)" [size]="18" />
            <div class="panel__titles">
              <h3 class="panel__title">{{ scopeLabel(s.scope) }}</h3>
              <span class="panel__sub">{{ s.is_active ? 'Visible to customers' : 'Hidden from customers' }}</span>
            </div>
          </div>
          <label class="tgl" [title]="s.is_active ? 'Scope on' : 'Scope off'">
            <input type="checkbox" [(ngModel)]="s.is_active" [disabled]="savingScope[s.id] === true"
                   (change)="toggleScope(s)" />
            <span class="tgl__track"></span>
            <span class="tgl__text">{{ s.is_active ? 'On' : 'Off' }}</span>
          </label>
        </header>

        <div class="rows">
          <article class="row" *ngFor="let m of s.modes">
            <label class="thumb" [class.has-img]="modeForms[m.id].preview || m.image_url"
                   [title]="(modeForms[m.id].preview || m.image_url) ? 'Change banner' : 'Upload banner'">
              <img *ngIf="modeForms[m.id].preview || m.image_url" [src]="modeForms[m.id].preview || m.image_url" alt="" />
              <span *ngIf="!(modeForms[m.id].preview || m.image_url)" class="thumb__ph">
                <tm-icon name="upload" [size]="18" />
              </span>
              <span class="thumb__edit"><tm-icon name="upload" [size]="16" /></span>
              <input type="file" accept="image/*" (change)="onFileSelected($event, m.id)" hidden />
            </label>

            <div class="row__kind">
              <tm-icon [name]="modeIcon(m)" [size]="15" />
              <span>{{ modeLabel(m.mode) }}</span>
            </div>

            <label class="row__field">
              <span class="row__lbl">Display name</span>
              <input type="text" [(ngModel)]="modeForms[m.id].name" placeholder="Option name" />
            </label>

            <label class="tgl" [title]="modeForms[m.id].is_active ? 'Enabled' : 'Disabled'">
              <input type="checkbox" [(ngModel)]="modeForms[m.id].is_active" />
              <span class="tgl__track"></span>
              <span class="tgl__text">{{ modeForms[m.id].is_active ? 'Enabled' : 'Disabled' }}</span>
            </label>

            <div class="row__save">
              <tm-button variant="green" size="sm" icon="check"
                         [disabled]="savingMode[m.id] === true" (clicked)="saveMode(s, m)">
                {{ savingMode[m.id] ? 'Saving…' : 'Save' }}
              </tm-button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <div class="cue" *ngIf="cityId && !loading && !scopes.length">
      <tm-icon name="car" [size]="24" />
      <p class="cue__title">No ride options</p>
      <p class="cue__text">The catalogue is seeded per city — none found for this one.</p>
    </div>
  `,
  styles: [`
    .intro { margin: 0 0 14px; font-size: 13px; color: var(--tm-text-muted); }
    .intro strong { color: var(--tm-text); font-weight: 800; }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    .panels { display: flex; flex-direction: column; gap: 18px; }

    .panel {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      overflow: hidden;
      transition: opacity var(--tm-duration-fast) var(--tm-ease);
    }
    .panel--off .rows { opacity: 0.5; }

    .panel__head {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 14px 16px;
      background: var(--tm-canvas-2, var(--tm-canvas));
      border-bottom: 1px solid var(--tm-line);
    }
    .panel__id { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .panel__id tm-icon { color: var(--tm-green); flex: none; }
    .panel__titles { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .panel__title { margin: 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .panel__sub { font-size: 11px; font-weight: 700; color: var(--tm-text-muted); }

    .rows { }
    .row {
      display: grid;
      grid-template-columns: 56px 130px minmax(0, 1fr) auto auto;
      grid-template-areas: "thumb kind field tgl save";
      align-items: center;
      gap: 16px;
      padding: 14px 16px;
    }
    .row + .row { border-top: 1px solid var(--tm-line); }

    .thumb {
      grid-area: thumb;
      position: relative; flex: none;
      width: 56px; height: 56px; border-radius: 10px;
      border: 1px dashed var(--tm-line-2); background: var(--tm-canvas-2);
      display: flex; align-items: center; justify-content: center;
      overflow: hidden; cursor: pointer;
    }
    .thumb.has-img { border-style: solid; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .thumb__ph { color: var(--tm-text-soft); display: inline-flex; }
    .thumb__edit {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(15, 20, 25, 0.55); color: #fff;
      opacity: 0; transition: opacity var(--tm-duration-fast) var(--tm-ease);
    }
    .thumb:hover .thumb__edit { opacity: 1; }

    .row__kind {
      grid-area: kind;
      display: flex; align-items: center; gap: 8px; min-width: 0;
      font-size: 14px; font-weight: 800; color: var(--tm-text);
    }
    .row__kind tm-icon { color: var(--tm-green); flex: none; }

    .row__field { grid-area: field; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .row__lbl {
      font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .row__field input {
      width: 100%; padding: 8px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .row__field input:focus { border-color: var(--tm-green); }

    .row__save { grid-area: save; }

    .tgl { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .tgl input { display: none; }
    .tgl__track {
      width: 38px; height: 22px; border-radius: 999px; flex: none;
      background: var(--tm-line-2); position: relative;
      transition: background var(--tm-duration-fast) var(--tm-ease);
    }
    .tgl__track::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 18px; height: 18px; border-radius: 50%;
      background: #fff; box-shadow: var(--tm-shadow-sm);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .tgl input:checked + .tgl__track { background: var(--tm-green); }
    .tgl input:checked + .tgl__track::after { transform: translateX(16px); }
    .tgl input:disabled + .tgl__track { opacity: 0.5; }
    .tgl__text { font-size: 12px; font-weight: 700; color: var(--tm-text-muted); min-width: 40px; }
    .row .tgl { grid-area: tgl; }
    .row .tgl__text { min-width: 56px; }

    @media (max-width: 760px) {
      .row {
        grid-template-columns: 56px minmax(0, 1fr);
        grid-template-areas:
          "thumb kind"
          "field field"
          "tgl   save";
        align-items: start;
        row-gap: 12px;
      }
      .row__kind { align-self: center; }
      .row .tgl { align-self: center; }
      .row__save { justify-self: end; align-self: center; }
    }
  `],
})
export class GeneralSettingsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  scopes: RideScope[] = [];
  modeForms: Record<number, ModeForm> = {};
  loading = false;
  savingMode: Record<number, boolean> = {};
  savingScope: Record<number, boolean> = {};

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      this.scopes = [];
      this.modeForms = {};
      if (id != null) this.fetch();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  scopeLabel(s: string): string {
    return s === 'outstation' ? 'Outstation' : 'Local';
  }

  scopeIcon(s: RideScope): 'map-marker' | 'road' {
    return s.scope === 'outstation' ? 'road' : 'map-marker';
  }

  modeLabel(m: string): string {
    return m === 'fixed' ? 'Fixed' : m === 'shuttle' ? 'Shuttle' : 'Private';
  }

  modeIcon(m: RideMode): 'car' | 'road' | 'map' {
    return m.mode === 'fixed' ? 'road' : m.mode === 'shuttle' ? 'map' : 'car';
  }

  fetch(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.api
      .get<{ scopes: RideScope[] }>(`/admin/cities/${this.cityId}/ride-products`)
      .subscribe({
        next: (res) => {
          this.scopes = res.scopes ?? [];
          this.modeForms = {};
          for (const s of this.scopes) {
            for (const m of s.modes ?? []) {
              this.modeForms[m.id] = {
                name: m.name ?? '',
                is_active: !!m.is_active,
                imageFile: null,
                preview: null,
              };
            }
          }
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load ride options');
        },
      });
  }

  onFileSelected(e: Event, modeId: number): void {
    const file = (e.target as HTMLInputElement).files?.[0] ?? null;
    const f = this.modeForms[modeId];
    if (!f) return;
    f.imageFile = file;
    if (file) {
      const reader = new FileReader();
      reader.onload = () => (f.preview = reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  saveMode(scope: RideScope, m: RideMode): void {
    if (this.cityId == null) return;
    const f = this.modeForms[m.id];
    if (!f) return;

    this.savingMode[m.id] = true;
    const fd = new FormData();
    fd.append('_method', 'PATCH');
    fd.append('name', f.name);
    fd.append('is_active', f.is_active ? '1' : '0');
    if (f.imageFile) fd.append('image', f.imageFile);

    this.api
      .postMultipart<{ mode: RideMode }>(
        `/admin/cities/${this.cityId}/ride-modes/${m.id}`,
        fd,
      )
      .subscribe({
        next: (res) => {
          this.savingMode[m.id] = false;
          const idx = scope.modes.findIndex((x) => x.id === m.id);
          if (idx >= 0 && res.mode) scope.modes[idx] = res.mode;
          if (res.mode) {
            this.modeForms[m.id] = {
              name: res.mode.name ?? '',
              is_active: !!res.mode.is_active,
              imageFile: null,
              preview: null,
            };
          }
          this.toast.success(`${this.modeLabel(m.mode)} saved`);
        },
        error: (err) => {
          this.savingMode[m.id] = false;
          // Revert the toggle to the server's actual value so the UI never shows
          // a state the backend rejected (last bookable option).
          const idx = scope.modes.findIndex((x) => x.id === m.id);
          if (idx >= 0 && this.modeForms[m.id]) {
            this.modeForms[m.id].is_active = !!scope.modes[idx].is_active;
          }
          this.toast.error(
            err?.error?.message || `Failed to save ${this.modeLabel(m.mode)}`,
          );
        },
      });
  }

  toggleScope(s: RideScope): void {
    if (this.cityId == null) return;
    this.savingScope[s.id] = true;
    this.api
      .patch<{ scope: RideScope }>(
        `/admin/cities/${this.cityId}/ride-scopes/${s.id}`,
        { is_active: s.is_active },
      )
      .subscribe({
        next: (res) => {
          this.savingScope[s.id] = false;
          if (res.scope) s.is_active = !!res.scope.is_active;
          this.toast.success(`${this.scopeLabel(s.scope)} ${s.is_active ? 'enabled' : 'disabled'}`);
        },
        error: (err) => {
          this.savingScope[s.id] = false;
          s.is_active = !s.is_active; // revert
          this.toast.error(err?.error?.message || `Failed to update ${this.scopeLabel(s.scope)}`);
        },
      });
  }
}

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent } from '../../ui';

interface RideProduct {
  id: number;
  city_id: number;
  kind: 'local' | 'rental' | 'outstation';
  name: string;
  image_path: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
}

interface ProductForm {
  name: string;
  is_active: boolean;
  imageFile: File | null;
  preview: string | null;
}

/**
 * Ride Products — the local / rental / outstation products offered in the
 * city chosen in the topbar switcher. Each product is saved independently.
 */
@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent],
  template: `
    <p class="intro">
      Ride products offered in this city — Local, Rental and Outstation. Set a banner and
      display name for each, then save the row.
    </p>

    <div class="cue" *ngIf="!cityId">
      <tm-icon name="map-marker" [size]="24" />
      <p class="cue__title">No city selected</p>
      <p class="cue__text">Pick a city from the switcher in the top bar to manage ride products.</p>
    </div>

    <div class="cue" *ngIf="cityId && loading">
      <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading ride products…</p>
    </div>

    <div class="rows" *ngIf="cityId && !loading && products.length">
      <article class="row" *ngFor="let p of products">
        <label class="thumb" [class.has-img]="forms[p.id].preview || p.image_url"
               [title]="(forms[p.id].preview || p.image_url) ? 'Change banner' : 'Upload banner'">
          <img *ngIf="forms[p.id].preview || p.image_url" [src]="forms[p.id].preview || p.image_url" alt="" />
          <span *ngIf="!(forms[p.id].preview || p.image_url)" class="thumb__ph">
            <tm-icon name="upload" [size]="18" />
          </span>
          <span class="thumb__edit"><tm-icon name="upload" [size]="16" /></span>
          <input type="file" accept="image/*" (change)="onFileSelected($event, p.id)" hidden />
        </label>

        <div class="row__kind">
          <tm-icon [name]="kindIcon(p.kind)" [size]="15" />
          <span>{{ kindLabel(p.kind) }}</span>
        </div>

        <label class="row__field">
          <span class="row__lbl">Display name</span>
          <!-- Disabled for now — product names use the seeded defaults
               (Local / Shuttle / Outstation). -->
          <input type="text" [(ngModel)]="forms[p.id].name" placeholder="Product name" disabled />
        </label>

        <label class="tgl" [title]="forms[p.id].is_active ? 'Enabled' : 'Disabled'">
          <input type="checkbox" [(ngModel)]="forms[p.id].is_active" />
          <span class="tgl__track"></span>
          <span class="tgl__text">{{ forms[p.id].is_active ? 'Enabled' : 'Disabled' }}</span>
        </label>

        <div class="row__save">
          <tm-button variant="green" size="sm" icon="check"
                     [disabled]="saving[p.id] === true" (clicked)="save(p)">
            {{ saving[p.id] ? 'Saving…' : 'Save' }}
          </tm-button>
        </div>
      </article>
    </div>

    <div class="cue" *ngIf="cityId && !loading && !products.length">
      <tm-icon name="car" [size]="24" />
      <p class="cue__title">No ride products</p>
      <p class="cue__text">Ride products are seeded per city — none found for this one.</p>
    </div>
  `,
  styles: [`
    .intro { margin: 0 0 14px; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    /* compact list */
    .rows {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      overflow: hidden;
    }
    .row {
      display: grid;
      grid-template-columns: 56px 150px minmax(0, 1fr) auto auto;
      grid-template-areas: "thumb kind field tgl save";
      align-items: center;
      gap: 16px;
      padding: 14px 16px;
    }
    .row + .row { border-top: 1px solid var(--tm-line); }

    /* thumbnail / upload */
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

    /* kind identity */
    .row__kind {
      grid-area: kind;
      display: flex; align-items: center; gap: 8px; min-width: 0;
      font-size: 14px; font-weight: 800; color: var(--tm-text);
    }
    .row__kind tm-icon { color: var(--tm-green); flex: none; }

    /* name field */
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

    /* toggle */
    .tgl { grid-area: tgl; display: flex; align-items: center; gap: 8px; cursor: pointer; }
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
    .tgl__text { font-size: 12px; font-weight: 700; color: var(--tm-text-muted); min-width: 56px; }

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
      .tgl { align-self: center; }
      .row__save { justify-self: end; align-self: center; }
    }
  `],
})
export class GeneralSettingsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  products: RideProduct[] = [];
  forms: Record<number, ProductForm> = {};
  loading = false;
  saving: Record<number, boolean> = {};

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
      this.products = [];
      this.forms = {};
      if (id != null) this.fetch();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  kindLabel(k: string): string {
    if (k === 'rental') return 'Rental';
    if (k === 'outstation') return 'Outstation';
    return 'Local';
  }

  kindIcon(k: string): 'car' | 'road' | 'map' {
    if (k === 'rental') return 'map';
    if (k === 'outstation') return 'road';
    return 'car';
  }

  fetch(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.api
      .get<{ data: RideProduct[] }>(`/admin/cities/${this.cityId}/ride-products`)
      .subscribe({
        next: (res) => {
          this.products = res.data ?? [];
          this.forms = {};
          for (const p of this.products) {
            this.forms[p.id] = {
              name: p.name ?? '',
              is_active: !!p.is_active,
              imageFile: null,
              preview: null,
            };
          }
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load ride products');
        },
      });
  }

  onFileSelected(e: Event, productId: number): void {
    const file = (e.target as HTMLInputElement).files?.[0] ?? null;
    const f = this.forms[productId];
    if (!f) return;
    f.imageFile = file;
    if (file) {
      const reader = new FileReader();
      reader.onload = () => (f.preview = reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  save(p: RideProduct): void {
    if (this.cityId == null) return;
    const f = this.forms[p.id];
    if (!f) return;

    this.saving[p.id] = true;
    const fd = new FormData();
    fd.append('_method', 'PATCH');
    fd.append('name', f.name);
    fd.append('is_active', f.is_active ? '1' : '0');
    if (f.imageFile) fd.append('image', f.imageFile);

    this.api
      .postMultipart<{ product: RideProduct }>(
        `/admin/cities/${this.cityId}/ride-products/${p.id}`,
        fd,
      )
      .subscribe({
        next: (res) => {
          this.saving[p.id] = false;
          const idx = this.products.findIndex((x) => x.id === p.id);
          if (idx >= 0 && res.product) this.products[idx] = res.product;
          if (res.product) {
            this.forms[p.id] = {
              name: res.product.name ?? '',
              is_active: !!res.product.is_active,
              imageFile: null,
              preview: null,
            };
          }
          this.toast.success(`${this.kindLabel(p.kind)} product saved`);
        },
        error: (err) => {
          this.saving[p.id] = false;
          // Revert the toggle to the server's actual value so the UI never
          // shows a state the backend rejected (e.g. the last active product).
          const idx = this.products.findIndex((x) => x.id === p.id);
          if (idx >= 0 && this.forms[p.id]) {
            this.forms[p.id].is_active = !!this.products[idx].is_active;
          }
          this.toast.error(
            err?.error?.message || `Failed to save ${this.kindLabel(p.kind)} product`,
          );
        },
      });
  }
}

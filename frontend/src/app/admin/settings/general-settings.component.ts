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
      Configure the ride products offered in this city. Each can have its own banner —
      save them independently.
    </p>

    <div class="cue" *ngIf="!cityId">
      <tm-icon name="map-marker" [size]="24" />
      <p class="cue__title">No city selected</p>
      <p class="cue__text">Pick a city from the switcher in the top bar to manage ride products.</p>
    </div>

    <div class="cue" *ngIf="cityId && loading">
      <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading ride products…</p>
    </div>

    <div class="gs" *ngIf="cityId && !loading">
      <article class="pcard" *ngFor="let p of products">
        <header class="pcard__head">
          <span class="pcard__icon"><tm-icon [name]="kindIcon(p.kind)" [size]="16" /></span>
          <div class="pcard__id">
            <span class="pcard__kind">{{ kindLabel(p.kind) }}</span>
            <span class="pcard__name">{{ forms[p.id].name || p.name }}</span>
          </div>
          <label class="tgl" [title]="forms[p.id].is_active ? 'Enabled' : 'Disabled'">
            <input type="checkbox" [(ngModel)]="forms[p.id].is_active" />
            <span class="tgl__track"></span>
            <span class="tgl__text">{{ forms[p.id].is_active ? 'Enabled' : 'Disabled' }}</span>
          </label>
        </header>

        <div class="pcard__body">
          <div class="pcard__media">
            <div class="media__box" [class.has-img]="forms[p.id].preview || p.image_url">
              <img *ngIf="forms[p.id].preview || p.image_url" [src]="forms[p.id].preview || p.image_url" alt="" />
              <span *ngIf="!(forms[p.id].preview || p.image_url)" class="media__ph">
                <tm-icon name="upload" [size]="22" />
              </span>
            </div>
            <label class="media__btn">
              <tm-icon name="upload" [size]="13" /> Banner image
              <input type="file" accept="image/*" (change)="onFileSelected($event, p.id)" hidden />
            </label>
            <span class="media__hint">Recommended 420×240 px</span>
          </div>

          <div class="pcard__fields">
            <label class="field">
              <span class="field__lbl">Product name</span>
              <input type="text" [(ngModel)]="forms[p.id].name" />
            </label>
          </div>
        </div>

        <footer class="pcard__foot">
          <tm-button variant="green" size="sm" icon="check"
                     [disabled]="saving[p.id] === true" (clicked)="save(p)">
            {{ saving[p.id] ? 'Saving…' : 'Save ' + kindLabel(p.kind) }}
          </tm-button>
        </footer>
      </article>

      <div class="cue" *ngIf="!products.length">
        <tm-icon name="car" [size]="24" />
        <p class="cue__title">No ride products</p>
        <p class="cue__text">Ride products are seeded per city — none found for this one.</p>
      </div>
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

    .gs { display: flex; flex-direction: column; gap: 14px; }

    .pcard {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      overflow: hidden;
    }
    .pcard__head {
      display: flex; align-items: center; gap: 11px;
      padding: 13px 16px; border-bottom: 1px solid var(--tm-line);
    }
    .pcard__icon {
      width: 34px; height: 34px; border-radius: 9px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green);
    }
    .pcard__id { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .pcard__kind {
      font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;
      color: var(--tm-text-muted);
    }
    .pcard__name { font-size: 15px; font-weight: 800; color: var(--tm-text); }

    .pcard__body {
      display: grid; grid-template-columns: 220px 1fr; gap: 18px;
      padding: 16px;
    }
    .pcard__media { display: flex; flex-direction: column; gap: 7px; }
    .media__box {
      height: 124px; border-radius: 10px;
      border: 1px dashed var(--tm-line); background: var(--tm-canvas-2);
      display: flex; align-items: center; justify-content: center; overflow: hidden;
    }
    .media__box.has-img { border-style: solid; }
    .media__box img { width: 100%; height: 100%; object-fit: cover; }
    .media__ph { color: var(--tm-text-muted); }
    .media__btn {
      display: inline-flex; align-items: center; gap: 6px; justify-content: center;
      padding: 8px 10px; border-radius: 8px;
      background: var(--tm-canvas-2); color: var(--tm-text);
      font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .media__btn:hover { background: var(--tm-line); }
    .media__hint { font-size: 11px; color: var(--tm-text-muted); text-align: center; }

    .pcard__fields { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field input, .field textarea {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field textarea:focus { border-color: var(--tm-green); }
    .field textarea { resize: vertical; }

    .pcard__foot {
      display: flex; justify-content: flex-end;
      padding: 12px 16px; border-top: 1px solid var(--tm-line);
    }

    /* toggle */
    .tgl { display: flex; align-items: center; gap: 8px; cursor: pointer; flex: none; }
    .tgl input { display: none; }
    .tgl__track {
      width: 38px; height: 22px; border-radius: 999px;
      background: var(--tm-line); position: relative;
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
    .tgl__text { font-size: 12px; font-weight: 700; color: var(--tm-text-muted); }

    @media (max-width: 720px) {
      .pcard__body { grid-template-columns: 1fr; }
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
        error: () => {
          this.saving[p.id] = false;
          this.toast.error(`Failed to save ${this.kindLabel(p.kind)} product`);
        },
      });
  }
}

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { AccordionModule } from 'primeng/accordion';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';

interface RideProduct {
  id: number;
  city_id: number;
  kind: 'local' | 'rental' | 'outstation';
  name: string;
  description: string | null;
  info: string | null;
  image_path: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
}

interface ProductForm {
  name: string;
  description: string;
  info: string;
  is_active: boolean;
  imageFile: File | null;
}

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputTextareaModule,
    RadioButtonModule,
    AccordionModule,
    ToastModule,
  ],
  providers: [MessageService],
  template: `
    <p-toast />
    <p class="muted">
      Toggle the ride products available in the selected city. Each product can have its own
      banner, short description and longer info copy. Save each section independently.
    </p>

    <div *ngIf="!cityId" class="empty">
      Pick a city from the left rail to manage its ride products.
    </div>

    <div *ngIf="cityId && loading" class="empty">Loading…</div>

    <p-accordion *ngIf="cityId && !loading" [activeIndex]="[0, 1, 2]" [multiple]="true">
      <p-accordionTab *ngFor="let p of products; let i = index" [header]="headerFor(p)">
        <div class="grid">
          <div class="col">
            <label class="lbl">Status</label>
            <div class="status-row">
              <p-radioButton
                [name]="'status-' + p.id"
                [value]="true"
                [(ngModel)]="forms[p.id].is_active"
                inputId="enabled-{{ p.id }}"
              ></p-radioButton>
              <label [for]="'enabled-' + p.id">Enabled</label>
              <p-radioButton
                [name]="'status-' + p.id"
                [value]="false"
                [(ngModel)]="forms[p.id].is_active"
                inputId="disabled-{{ p.id }}"
              ></p-radioButton>
              <label [for]="'disabled-' + p.id">Disabled</label>
            </div>

            <label class="lbl">Name</label>
            <input pInputText [(ngModel)]="forms[p.id].name" />

            <label class="lbl">Image (banner)</label>
            <div class="file-row">
              <input
                type="file"
                accept="image/*"
                (change)="onFileSelected($event, p.id)"
              />
              <span class="hint">
                Recommended 420×240 px (aspect ratio 1.8:1).
              </span>
            </div>
            <div *ngIf="p.image_url" class="thumb">
              <img [src]="p.image_url" alt="" />
            </div>
          </div>

          <div class="col">
            <label class="lbl">Description</label>
            <input pInputText [(ngModel)]="forms[p.id].description" placeholder="Short msg" />

            <label class="lbl">Info</label>
            <textarea
              pInputTextarea
              rows="5"
              [(ngModel)]="forms[p.id].info"
              [placeholder]="placeholderFor(p.kind)"
            ></textarea>
          </div>
        </div>

        <div class="actions">
          <button
            pButton
            type="button"
            label="Update"
            icon="pi pi-save"
            [loading]="saving[p.id] === true"
            (click)="save(p)"
          ></button>
        </div>
      </p-accordionTab>
    </p-accordion>
  `,
  styles: [
    `
      .page-head { margin-bottom: 14px; }
      .page-head h2 { margin: 0 0 4px; }
      .muted { color: #64748b; font-size: 13px; margin: 0; }
      .empty { padding: 30px; text-align: center; color: #64748b; }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
      }
      .col { display: flex; flex-direction: column; gap: 6px; }
      .lbl {
        font-size: 12px;
        font-weight: 700;
        color: #475569;
        margin-top: 8px;
      }
      .status-row {
        display: flex;
        gap: 14px;
        align-items: center;
        margin-bottom: 4px;
      }
      .status-row label { font-weight: 600; font-size: 13px; }
      .file-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .hint { color: #94a3b8; font-size: 11px; }
      .thumb {
        margin-top: 8px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        overflow: hidden;
        max-width: 320px;
      }
      .thumb img { display: block; width: 100%; }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 14px;
      }
      @media (max-width: 720px) {
        .grid { grid-template-columns: 1fr; }
      }
    `,
  ],
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
    private msg: MessageService,
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
              description: p.description ?? '',
              info: p.info ?? '',
              is_active: !!p.is_active,
              imageFile: null,
            };
          }
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.msg.add({ severity: 'error', summary: 'Failed to load ride products' });
        },
      });
  }

  onFileSelected(e: Event, productId: number): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (this.forms[productId]) this.forms[productId].imageFile = file;
  }

  headerFor(p: RideProduct): string {
    const status = this.forms[p.id]?.is_active ? '✓' : '✕';
    return `${status}  ${p.name}`;
  }

  placeholderFor(kind: string): string {
    if (kind === 'rental') return 'Rentals here';
    if (kind === 'outstation') return 'Out Station here';
    return 'Quick rides inside the city';
  }

  save(p: RideProduct): void {
    if (this.cityId == null) return;
    const f = this.forms[p.id];
    if (!f) return;

    this.saving[p.id] = true;
    const fd = new FormData();
    fd.append('_method', 'PATCH');
    fd.append('name', f.name);
    fd.append('description', f.description ?? '');
    fd.append('info', f.info ?? '');
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
          // Replace product in list with the updated copy.
          const idx = this.products.findIndex((x) => x.id === p.id);
          if (idx >= 0 && res.product) this.products[idx] = res.product;
          if (res.product) {
            this.forms[p.id] = {
              name: res.product.name ?? '',
              description: res.product.description ?? '',
              info: res.product.info ?? '',
              is_active: !!res.product.is_active,
              imageFile: null,
            };
          }
          this.msg.add({ severity: 'success', summary: `${p.name} saved` });
        },
        error: () => {
          this.saving[p.id] = false;
          this.msg.add({ severity: 'error', summary: `Failed to save ${p.name}` });
        },
      });
  }
}

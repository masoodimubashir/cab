import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  DrawerComponent,
  IconComponent,
  ModalComponent,
} from '../../ui';

interface PromoCodeRow {
  id: number;
  code: string;
  max_number: number | null;
  start_date: string;
  end_date: string;
  validity_in_days: number | null;
  bonus_type: string;
  can_use_with_referral: boolean;
  amount: number;
  is_active: boolean;
}

/**
 * Promo Codes — code-based cash bonuses for the city chosen in the topbar
 * switcher. Create/edit uses the shared drawer; delete uses a confirm modal.
 */
@Component({
  selector: 'app-promo-codes',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, DrawerComponent, ModalComponent, IconComponent,
  ],
  template: `
    <div class="pc">
      <header class="pc__head">
        <div>
          <h1 class="pc__title">Promo Codes</h1>
          <p class="pc__sub">Code-based cash bonuses riders can redeem in this city.</p>
        </div>
        <tm-button variant="green" icon="plus" [disabled]="cityId == null" (clicked)="openCreate()">
          Add promo code
        </tm-button>
      </header>

      <!-- No city -->
      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage promo codes.</p>
      </div>

      <ng-container *ngIf="cityId != null">
        <div class="seg">
          <button class="seg__btn" [class.is-on]="tab === 'active'" (click)="setTab('active')">Active</button>
          <button class="seg__btn" [class.is-on]="tab === 'inactive'" (click)="setTab('inactive')">Inactive</button>
        </div>

        <div class="grid" *ngIf="rows.length; else empty">
          <article class="card" *ngFor="let r of rows">
            <div class="card__top">
              <span class="card__code">{{ r.code }}</span>
              <span class="card__status" [class.on]="r.is_active" [class.off]="!r.is_active">
                {{ r.is_active ? 'Active' : 'Inactive' }}
              </span>
            </div>
            <div class="card__amount">
              <span class="card__amount-v">{{ r.amount }}</span>
              <span class="card__amount-l">{{ r.bonus_type }} bonus</span>
            </div>
            <div class="card__meta">
              <div><tm-icon name="calendar" [size]="13" /> {{ r.start_date }} → {{ r.end_date }}</div>
              <div><tm-icon name="refresh" [size]="13" /> Valid {{ r.validity_in_days ?? '—' }} days</div>
              <div><tm-icon name="users" [size]="13" /> Max {{ r.max_number ?? 'unlimited' }} uses</div>
              <div *ngIf="r.can_use_with_referral"><tm-icon name="check" [size]="13" /> Stacks with referral</div>
            </div>
            <div class="card__foot">
              <button class="icon-btn" (click)="openEdit(r)" aria-label="Edit"><tm-icon name="edit" [size]="14" /></button>
              <button class="icon-btn icon-btn--danger" (click)="deleteTarget = r" aria-label="Delete"><tm-icon name="trash" [size]="14" /></button>
            </div>
          </article>
        </div>
        <ng-template #empty>
          <div class="cue">
            <tm-icon name="tag" [size]="24" />
            <p class="cue__title">No {{ tab }} promo codes</p>
            <p class="cue__text" *ngIf="tab === 'active'">Create a promo code to give riders a bonus.</p>
          </div>
        </ng-template>
      </ng-container>
    </div>

    <!-- Drawer -->
    <tm-drawer
      [open]="open"
      [title]="editingId ? 'Edit promo code' : 'Add promo code'"
      [width]="520"
      (closed)="open = false"
    >
      <div slot="body" class="form">
        <label class="field">
          <span class="field__lbl">Promo code <i>*</i></span>
          <input type="text" [(ngModel)]="form.code" (ngModelChange)="touched = true"
                 placeholder="WELCOME10" class="mono" />
          <span class="field__err" *ngIf="touched && !form.code.trim()">Code is required.</span>
        </label>
        <div class="row">
          <label class="field">
            <span class="field__lbl">Bonus amount <i>*</i></span>
            <input type="number" min="0" step="0.01" [(ngModel)]="form.amount" />
          </label>
          <label class="field">
            <span class="field__lbl">Bonus type</span>
            <select [(ngModel)]="form.bonus_type">
              <option value="cash">Cash</option>
            </select>
          </label>
        </div>
        <div class="row">
          <label class="field">
            <span class="field__lbl">Max uses</span>
            <input type="number" min="0" [(ngModel)]="form.max_number" />
          </label>
          <label class="field">
            <span class="field__lbl">Validity (days)</span>
            <input type="number" min="0" [(ngModel)]="form.validity_in_days" />
          </label>
        </div>
        <div class="row">
          <label class="field">
            <span class="field__lbl">Start date</span>
            <input type="date" [(ngModel)]="form.start_date" />
          </label>
          <label class="field">
            <span class="field__lbl">End date</span>
            <input type="date" [(ngModel)]="form.end_date" />
          </label>
        </div>
        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.can_use_with_referral" />
          <span>Can be used together with a referral</span>
        </label>
        <label class="toggle">
          <input type="checkbox" [(ngModel)]="form.is_active" />
          <span>Active</span>
        </label>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="open = false">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!form.code.trim() || saving" (clicked)="submit()">
          {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create' }}
        </tm-button>
      </div>
    </tm-drawer>

    <!-- Delete confirm -->
    <tm-modal [open]="!!deleteTarget" title="Delete promo code" (closed)="deleteTarget = null">
      <div slot="body"><p>Delete promo code <strong>{{ deleteTarget?.code }}</strong>? This cannot be undone.</p></div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .pc { display: flex; flex-direction: column; gap: 16px; }
    .pc__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .pc__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .pc__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface);
      border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg);
      color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    .seg {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px);
    }
    .seg__btn {
      padding: 7px 18px; border-radius: 8px;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      background: transparent; cursor: pointer;
    }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(264px, 1fr));
      gap: 12px;
    }
    .card {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      padding: 14px;
    }
    .card__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .card__code {
      font-family: var(--tm-font-mono, monospace);
      font-size: 16px; font-weight: 800; color: var(--tm-text);
      letter-spacing: 0.5px;
    }
    .card__status {
      font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px;
      padding: 3px 8px; border-radius: 999px;
    }
    .card__status.on { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .card__status.off { background: var(--tm-canvas-2); color: var(--tm-text-muted); }

    .card__amount { display: flex; align-items: baseline; gap: 7px; margin: 12px 0 10px; }
    .card__amount-v { font-size: 26px; font-weight: 800; color: var(--tm-text); line-height: 1; }
    .card__amount-l { font-size: 11px; font-weight: 700; text-transform: capitalize; color: var(--tm-text-muted); }

    .card__meta {
      display: flex; flex-direction: column; gap: 5px;
      border-top: 1px solid var(--tm-line); padding-top: 10px;
    }
    .card__meta > div {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: var(--tm-text-muted);
    }

    .card__foot {
      display: flex; justify-content: flex-end; gap: 6px;
      margin-top: 10px;
    }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer;
    }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }

    /* form */
    .form { display: flex; flex-direction: column; gap: 14px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field select {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none; font-family: inherit;
    }
    .field input:focus, .field select:focus { border-color: var(--tm-green); }
    .field input.mono { font-family: var(--tm-font-mono, monospace); text-transform: uppercase; }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
  `],
})
export class PromoCodesComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  tab: 'active' | 'inactive' = 'active';
  rows: PromoCodeRow[] = [];

  open = false;
  editingId: number | null = null;
  saving = false;
  touched = false;
  form = this.blankForm();
  deleteTarget: PromoCodeRow | null = null;

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
      if (id != null) this.fetch();
      else this.rows = [];
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  setTab(t: 'active' | 'inactive'): void {
    if (this.tab === t) return;
    this.tab = t;
    this.fetch();
  }

  fetch(): void {
    if (this.cityId == null) return;
    const active = this.tab === 'active' ? '1' : '0';
    this.api.get<{ data: PromoCodeRow[] }>(`/admin/cities/${this.cityId}/promo-codes?is_active=${active}`)
      .subscribe({
        next: (r) => (this.rows = r.data ?? []),
        error: () => this.toast.error('Failed to load promo codes'),
      });
  }

  blankForm() {
    const today = this.toIso(new Date());
    return {
      code: '',
      max_number: null as number | null,
      start_date: today,
      end_date: today,
      validity_in_days: 30 as number | null,
      bonus_type: 'cash',
      can_use_with_referral: false,
      amount: 0,
      is_active: true,
    };
  }

  openCreate(): void {
    this.editingId = null;
    this.touched = false;
    this.form = this.blankForm();
    this.open = true;
  }

  openEdit(r: PromoCodeRow): void {
    this.editingId = r.id;
    this.touched = false;
    this.form = {
      code: r.code,
      max_number: r.max_number,
      start_date: (r.start_date || '').slice(0, 10),
      end_date: (r.end_date || '').slice(0, 10),
      validity_in_days: r.validity_in_days,
      bonus_type: r.bonus_type,
      can_use_with_referral: r.can_use_with_referral,
      amount: r.amount,
      is_active: r.is_active,
    };
    this.open = true;
  }

  submit(): void {
    this.touched = true;
    if (this.cityId == null || !this.form.code.trim() || this.saving) return;
    this.saving = true;
    const body: any = { ...this.form, code: this.form.code.trim() };
    const path = this.editingId
      ? `/admin/cities/${this.cityId}/promo-codes/${this.editingId}`
      : `/admin/cities/${this.cityId}/promo-codes`;
    const req$ = this.editingId ? this.api.patch(path, body) : this.api.post(path, body);
    req$.subscribe({
      next: () => {
        this.saving = false;
        this.open = false;
        this.toast.success(this.editingId ? 'Promo code updated' : 'Promo code created');
        this.fetch();
      },
      error: (e) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Save failed');
      },
    });
  }

  confirmDelete(): void {
    const r = this.deleteTarget;
    if (!r || this.cityId == null || this.saving) return;
    this.saving = true;
    this.api.delete(`/admin/cities/${this.cityId}/promo-codes/${r.id}`).subscribe({
      next: () => {
        this.saving = false;
        this.deleteTarget = null;
        this.toast.success('Promo code deleted');
        this.fetch();
      },
      error: (e) => {
        this.saving = false;
        this.toast.error(e?.error?.message || 'Delete failed');
      },
    });
  }

  private toIso(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

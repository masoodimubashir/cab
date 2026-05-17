import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { DropdownModule } from 'primeng/dropdown';
import { CalendarModule } from 'primeng/calendar';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';

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

@Component({
  selector: 'app-promo-codes',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonModule, TableModule, DialogModule,
    InputTextModule, InputNumberModule, InputSwitchModule, CheckboxModule,
    DropdownModule, CalendarModule,
    ToastModule, ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast />
    <p-confirmDialog />

    <h2 class="page-title">Promo Code</h2>

    <div class="bar">
      <button pButton type="button" label="Add Promo" icon="pi pi-plus"
              class="p-button-sm" (click)="openCreate()" [disabled]="!cityId"></button>
    </div>

    <div class="tabs">
      <button class="tab" [class.active]="tab === 'active'" (click)="setTab('active')">Active</button>
      <button class="tab" [class.active]="tab === 'inactive'" (click)="setTab('inactive')">Inactive</button>
    </div>

    <p-table [value]="rows" styleClass="p-datatable-sm" [rowHover]="true" [paginator]="rows.length > 20" [rows]="20">
      <ng-template pTemplate="header">
        <tr>
          <th>S.No</th>
          <th>Promo Code</th>
          <th>Max Number</th>
          <th>Start Date</th>
          <th>End Date</th>
          <th>Validity (days)</th>
          <th>Type</th>
          <th>Amount</th>
          <th>Status</th>
          <th style="width: 160px;">Action</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-r let-i="rowIndex">
        <tr>
          <td>{{ i + 1 }}</td>
          <td><strong>{{ r.code }}</strong></td>
          <td>{{ r.max_number ?? '—' }}</td>
          <td>{{ r.start_date }}</td>
          <td>{{ r.end_date }}</td>
          <td>{{ r.validity_in_days ?? '—' }}</td>
          <td>{{ r.bonus_type }}</td>
          <td>{{ r.amount }}</td>
          <td>
            <span class="pill" [class.on]="r.is_active" [class.off]="!r.is_active">
              {{ r.is_active ? 'Active' : 'Inactive' }}
            </span>
          </td>
          <td class="actions-col">
            <button pButton type="button" label="Edit" class="p-button-sm" (click)="openEdit(r)"></button>
            <button pButton type="button" label="Delete"
                    class="p-button-sm p-button-text p-button-danger" (click)="remove(r)"></button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="10" class="empty">No promo codes in this list.</td></tr>
      </ng-template>
    </p-table>

    <p-dialog
      [header]="editingId ? 'Edit Promo Code' : 'Promo Code'"
      [(visible)]="open"
      [modal]="true"
      [style]="{ width: '720px' }"
      [draggable]="false"
    >
      <div class="grid">
        <div class="col">
          <label class="lbl">Promo Code *</label>
          <input pInputText [(ngModel)]="form.code" placeholder="WELCOME10" />

          <label class="lbl">Start Date *</label>
          <p-calendar [(ngModel)]="form.start_date" dateFormat="yy-mm-dd" appendTo="body"></p-calendar>

          <label class="lbl">Validity (in days) *</label>
          <p-inputNumber [(ngModel)]="form.validity_in_days" [min]="0"></p-inputNumber>

          <div class="check-row">
            <p-checkbox [(ngModel)]="form.can_use_with_referral" [binary]="true" inputId="cur"></p-checkbox>
            <label for="cur" class="lbl-inline">Can use with referral</label>
          </div>

          <label class="lbl">Amount *</label>
          <p-inputNumber [(ngModel)]="form.amount" [min]="0" [maxFractionDigits]="2"></p-inputNumber>
        </div>

        <div class="col">
          <label class="lbl">Max Number *</label>
          <p-inputNumber [(ngModel)]="form.max_number" [min]="0"></p-inputNumber>

          <label class="lbl">End Date *</label>
          <p-calendar [(ngModel)]="form.end_date" dateFormat="yy-mm-dd" appendTo="body"></p-calendar>

          <label class="lbl">Bonus Type *</label>
          <p-dropdown [options]="bonusTypes" [(ngModel)]="form.bonus_type"
                      optionLabel="label" optionValue="value" appendTo="body"></p-dropdown>

          <div class="switch-row">
            <span class="lbl">Active</span>
            <p-inputSwitch [(ngModel)]="form.is_active"></p-inputSwitch>
          </div>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-secondary" (click)="open = false"></button>
        <button pButton type="button"
                [label]="editingId ? 'Update' : 'Add'"
                (click)="submit()" [loading]="saving"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .page-title { margin: 0 0 14px; font-size: 22px; font-weight: 800; color: #0f172a; }
    .bar { display: flex; justify-content: flex-start; margin: 0 0 12px; }
    .tabs {
      display: flex; gap: 0; background: #f1f5f9; border-radius: 10px;
      padding: 4px; margin: 0 0 18px; max-width: 380px;
    }
    .tab {
      flex: 1; padding: 10px 16px; background: transparent; border: 0;
      border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 13px;
      color: #475569;
    }
    .tab.active { background: #06b6d4; color: #fff; }

    .empty { padding: 28px; text-align: center; color: #64748b; }
    .pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
    }
    .pill.on { background: #dcfce7; color: #166534; }
    .pill.off { background: #f1f5f9; color: #94a3b8; }
    .actions-col { display: flex; gap: 6px; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .col { display: flex; flex-direction: column; gap: 6px; }
    .lbl { font-size: 12px; font-weight: 700; color: #475569; margin-top: 6px; }
    .lbl-inline { font-size: 13px; color: #0f172a; }
    .check-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
    :host ::ng-deep .col .p-inputnumber,
    :host ::ng-deep .col .p-dropdown,
    :host ::ng-deep .col .p-calendar { width: 100%; }
    .col input[pInputText] { width: 100%; }
    .switch-row {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 10px; padding: 8px 10px; background: #f8fafc; border-radius: 8px;
    }
    .switch-row .lbl { margin: 0; }
  `],
})
export class PromoCodesComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  tab: 'active' | 'inactive' = 'active';
  rows: PromoCodeRow[] = [];

  open = false;
  editingId: number | null = null;
  saving = false;
  form = this.blankForm();

  bonusTypes = [{ label: 'Cash', value: 'cash' }];

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private msg: MessageService,
    private confirm: ConfirmationService,
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
        error: () => this.msg.add({ severity: 'error', summary: 'Failed to load promo codes' }),
      });
  }

  blankForm() {
    const today = new Date();
    return {
      code: '',
      max_number: null as number | null,
      start_date: today as Date | null,
      end_date: today as Date | null,
      validity_in_days: 30 as number | null,
      bonus_type: 'cash',
      can_use_with_referral: false,
      amount: 0,
      is_active: true,
    };
  }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.open = true;
  }

  openEdit(r: PromoCodeRow): void {
    this.editingId = r.id;
    this.form = {
      code: r.code,
      max_number: r.max_number,
      start_date: r.start_date ? new Date(r.start_date) : null,
      end_date: r.end_date ? new Date(r.end_date) : null,
      validity_in_days: r.validity_in_days,
      bonus_type: r.bonus_type,
      can_use_with_referral: r.can_use_with_referral,
      amount: r.amount,
      is_active: r.is_active,
    };
    this.open = true;
  }

  submit(): void {
    if (this.cityId == null) return;
    if (!this.form.code.trim()) {
      this.msg.add({ severity: 'warn', summary: 'Promo code is required' });
      return;
    }
    const body: any = {
      ...this.form,
      code: this.form.code.trim(),
      start_date: this.toIso(this.form.start_date),
      end_date: this.toIso(this.form.end_date),
    };
    this.saving = true;
    const path = this.editingId
      ? `/admin/cities/${this.cityId}/promo-codes/${this.editingId}`
      : `/admin/cities/${this.cityId}/promo-codes`;
    const req$ = this.editingId ? this.api.patch(path, body) : this.api.post(path, body);
    req$.subscribe({
      next: () => {
        this.saving = false;
        this.open = false;
        this.msg.add({ severity: 'success', summary: this.editingId ? 'Updated' : 'Created' });
        this.fetch();
      },
      error: (e) => {
        this.saving = false;
        this.msg.add({ severity: 'error', summary: e?.error?.message || 'Save failed' });
      },
    });
  }

  remove(r: PromoCodeRow): void {
    this.confirm.confirm({
      message: `Delete promo code "${r.code}"?`,
      accept: () => {
        if (this.cityId == null) return;
        this.api.delete(`/admin/cities/${this.cityId}/promo-codes/${r.id}`).subscribe({
          next: () => { this.msg.add({ severity: 'success', summary: 'Deleted' }); this.fetch(); },
          error: (e) => this.msg.add({ severity: 'error', summary: e?.error?.message || 'Delete failed' }),
        });
      },
    });
  }

  private toIso(d: Date | string | null): string | null {
    if (!d) return null;
    if (typeof d === 'string') return d;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

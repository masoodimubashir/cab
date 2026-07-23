import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';

interface Txn {
  id: number;
  type: string;
  amount: number;
  reason: string | null;
  created_at: string | null;
}

interface WalletResponse {
  balance: number;
  currency: string;
  transactions: Txn[];
}

type Filter = 'all' | 'credit' | 'debit';

/**
 * Wallet activity — the full transaction ledger, opened as a modal from the
 * Earnings & Wallet page so the main screen stays clean. A simple segment
 * filters credits vs debits.
 */
@Component({
  selector: 'app-wallet-activity',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar class="pg-toolbar">
        <ion-title class="pg-brandtitle"><span class="b-white">Wallet</span> <span class="b-green">activity</span></ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()" aria-label="Close">
            <ion-icon name="close-outline" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="pg-content">
      <div class="pg-body">
        <div class="dc-pills act-pills">
          <button class="dc-pill dc-press" [class.is-active]="filter === 'all'" (click)="filter = 'all'">All</button>
          <button class="dc-pill dc-press" [class.is-active]="filter === 'credit'" (click)="filter = 'credit'">Credits</button>
          <button class="dc-pill dc-press" [class.is-active]="filter === 'debit'" (click)="filter = 'debit'">Debits</button>
        </div>

        <div class="pg-card">
          <div *ngIf="loading" class="act-skel">
            <div class="dc-skeleton" style="height:56px"></div>
            <div class="dc-skeleton" style="height:56px"></div>
            <div class="dc-skeleton" style="height:56px"></div>
          </div>

          <div *ngIf="error && !loading" class="dc-empty">
            <div class="dc-empty__icon"><ion-icon name="alert-circle-outline"></ion-icon></div>
            <strong>Couldn't load activity</strong>
            <span>{{ error }}</span>
          </div>

          <div *ngIf="!loading && !error && !filtered.length" class="dc-empty">
            <div class="dc-empty__icon"><ion-icon name="receipt-outline"></ion-icon></div>
            <strong>Nothing here</strong>
            <span>No {{ filter === 'all' ? '' : filter }} transactions to show.</span>
          </div>

          <div *ngIf="!loading && filtered.length" class="dc-list">
            <div class="dc-row" *ngFor="let t of filtered">
              <span class="dc-row__icon" [class.dc-row__icon--danger]="!isCredit(t)">
                <ion-icon [name]="isCredit(t) ? 'arrow-down-outline' : 'arrow-up-outline'"></ion-icon>
              </span>
              <span class="dc-row__text">
                <strong>{{ txnLabel(t) }}</strong>
                <small>{{ txnDate(t) }}</small>
              </span>
              <span
                class="dc-row__value"
                [style.color]="isCredit(t) ? 'var(--dc-green, #16a34a)' : '#ef4444'"
              >
                {{ isCredit(t) ? '+' : '−' }}₹{{ t.amount | number: '1.0-2' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .act-pills { margin-bottom: 14px; }
    .act-skel { display: flex; flex-direction: column; gap: 10px; }
  `],
})
export class WalletActivityModalComponent implements OnInit {
  loading = false;
  error: string | null = null;
  transactions: Txn[] = [];
  filter: Filter = 'all';

  constructor(private api: ApiService, private modalCtrl: ModalController) {}

  ngOnInit(): void {
    this.loading = true;
    this.api.get<WalletResponse>('/drivers/me/wallet').subscribe({
      next: (res) => {
        this.transactions = res.transactions ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load your wallet activity.';
        this.loading = false;
      },
    });
  }

  get filtered(): Txn[] {
    if (this.filter === 'all') return this.transactions;
    if (this.filter === 'debit') return this.transactions.filter((t) => t.type === 'debit');
    return this.transactions.filter((t) => t.type !== 'debit');
  }

  isCredit(t: Txn): boolean {
    return t.type !== 'debit';
  }

  txnLabel(t: Txn): string {
    if (t.reason) return t.reason;
    switch (t.type) {
      case 'credit': return 'Credit';
      case 'debit': return 'Debit';
      case 'cashback': return 'Cashback';
      case 'driver_added_cash': return 'Cash added';
      default: return t.type;
    }
  }

  txnDate(t: Txn): string {
    if (!t.created_at) return '';
    try {
      const d = new Date(t.created_at);
      return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return ''; }
  }

  dismiss(): void {
    void this.modalCtrl.dismiss();
  }
}

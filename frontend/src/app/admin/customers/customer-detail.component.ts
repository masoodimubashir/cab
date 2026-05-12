import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { DropdownModule } from 'primeng/dropdown';
import { CheckboxModule } from 'primeng/checkbox';
import { RadioButtonModule } from 'primeng/radiobutton';
import { TabViewModule } from 'primeng/tabview';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';
import { ApiService } from '../../core/api.service';

interface CustomerProfile {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  dob: string | null;
  city: string | null;
  date_registered: string;
  last_login_at: string | null;
  app_version: string | null;
  os_version: string | null;
  device_type: string | null;
  is_suspended: boolean;
  suspended_reason: string | null;
  duplicate_registration: boolean;
  email_unsubscribed: boolean;
  sms_unsubscribed: boolean;
  push_unsubscribed: boolean;
  referral_code: string | null;
  referrer: { id: number; name: string; referral_code: string } | null;
  wallet_balance: number;
  remaining_coupons: number;
  used_subscribed: boolean;
  cancellation_charge_policy: string;
}

@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DatePipe,
    CardModule, TableModule, ButtonModule,
    InputTextModule, InputNumberModule, InputTextareaModule,
    DropdownModule, CheckboxModule, RadioButtonModule,
    TabViewModule, DialogModule, ToastModule, TagModule,
  ],
  providers: [MessageService],
  template: `
    <p-toast />

    <h2 class="page-head">Dashboard</h2>

    <!-- ───────── 3 lookup cards (User / Driver / Ride) ───────── -->
    <div class="lookup-grid">
      <div class="lookup-card">
        <h3>User Details</h3>
        <input pInputText [(ngModel)]="userLookupQ" placeholder="User ID / Phone / Email" />
        <div class="radios">
          <label><input type="radio" [(ngModel)]="userLookupBy" value="id" /> User ID</label>
          <label><input type="radio" [(ngModel)]="userLookupBy" value="email" /> Email</label>
          <label><input type="radio" [(ngModel)]="userLookupBy" value="phone" /> Phone</label>
        </div>
        <button pButton label="User Details" (click)="lookupUser()"></button>
      </div>

      <div class="lookup-card">
        <h3>Driver Details</h3>
        <input pInputText [(ngModel)]="driverLookupQ" placeholder="Enter User ID/Phone/Email" />
        <div class="radios">
          <label><input type="radio" [(ngModel)]="driverLookupBy" value="id" /> ID Driver</label>
          <label><input type="radio" [(ngModel)]="driverLookupBy" value="phone" /> Phone</label>
          <label><input type="radio" [(ngModel)]="driverLookupBy" value="vehicle_no" /> Vehicle No</label>
        </div>
        <button pButton label="Details Driver" (click)="lookupDriver()"></button>
      </div>

      <div class="lookup-card">
        <h3>Ride Details</h3>
        <input pInputText [(ngModel)]="rideLookupQ" placeholder="Enter Engagement / Ride ID" />
        <div class="radios">
          <label><input type="radio" [(ngModel)]="rideLookupBy" value="id" /> Ride ID</label>
        </div>
        <button pButton label="Ride Details" (click)="lookupRide()"></button>
      </div>
    </div>

    <!-- ───────── Profile card ───────── -->
    <div class="profile-card" *ngIf="profile; else profileLoading">
      <h3 class="card-title">User Details</h3>

      <div class="profile-grid">
        <div class="col">
          <div class="row"><span class="k">User ID</span><span class="v">{{ profile.id }}</span></div>
          <div class="row"><span class="k">User Name</span><span class="v">{{ profile.name || '—' }}</span></div>
          <div class="row"><span class="k">User Phone</span><span class="v">{{ profile.phone || '—' }}</span></div>
          <div class="row"><span class="k">User Email</span><span class="v">{{ profile.email || '—' }}</span></div>
          <div class="row"><span class="k">DOB</span><span class="v">{{ profile.dob || '—' }}</span></div>
          <div class="row"><span class="k">City</span><span class="v">{{ profile.city || '—' }}</span></div>
          <div class="row"><span class="k">Date Registered</span>
            <span class="v">{{ profile.date_registered | date:'dd/MM/yyyy' }}</span></div>
        </div>

        <div class="col">
          <div class="row"><span class="k">App Version</span><span class="v">{{ profile.app_version || '—' }}</span></div>
          <div class="row"><span class="k">Blocked</span>
            <span class="v" [class.bad]="profile.is_suspended" [class.good]="!profile.is_suspended">
              {{ profile.is_suspended ? 'Yes' : 'No' }}
            </span></div>
          <div class="row"><span class="k">Internal Wallet balance</span>
            <span class="v">{{ profile.wallet_balance ?? 0 }}</span></div>
          <div class="row"><span class="k">Remaining Coupons</span><span class="v">{{ profile.remaining_coupons }}</span></div>
          <div class="row"><span class="k">Used Subscribed</span>
            <span class="v">{{ profile.used_subscribed ? 'Yes' : 'No' }}</span></div>
        </div>

        <div class="col">
          <div class="row"><span class="k">OS version</span><span class="v">{{ profile.os_version || '—' }}</span></div>
          <div class="row"><span class="k">Device Type</span><span class="v">{{ profile.device_type || '—' }}</span></div>
          <div class="row"><span class="k">User Referral Code</span><span class="v">{{ profile.referral_code || '—' }}</span></div>
          <div class="row"><span class="k">Referrer Referral Code</span>
            <span class="v">{{ profile.referrer?.referral_code || '—' }}</span></div>
          <div class="row"><span class="k">Duplicate Registration</span>
            <span class="v">{{ profile.duplicate_registration ? 'YES' : 'NO' }}</span></div>
          <div class="row"><span class="k">Cancellation Charge</span>
            <span class="v">{{ profile.cancellation_charge_policy }}</span></div>
          <div class="row"><span class="k">Email Status</span>
            <span class="v">{{ profile.email_unsubscribed ? 'Unsubscribed' : 'Subscribed' }}</span></div>
        </div>
      </div>
    </div>
    <ng-template #profileLoading><div class="empty">Loading customer…</div></ng-template>

    <!-- ───────── Action buttons ───────── -->
    <div class="action-row" *ngIf="profile">
      <button pButton label="Block/Delete User" class="p-button-info"
              (click)="openBlockDelete()"></button>
      <button pButton label="Unsubscribe User" class="p-button-info"
              (click)="openUnsub()"></button>
      <button pButton label="Credit/Debit" class="p-button-info"
              (click)="openWallet()"></button>
    </div>

    <!-- ───────── Tabs ───────── -->
    <p-tabView [(activeIndex)]="activeTab" (onChange)="onTabChange($event)" *ngIf="profile">
      <p-tabPanel header="Rides">
        <p-table [value]="rides" [loading]="loadingTab" responsiveLayout="scroll">
          <ng-template pTemplate="header">
            <tr>
              <th>S.No</th>
              <th>Date</th>
              <th>Driver Name</th>
              <th>Driver ID</th>
              <th>Engagement ID</th>
              <th>Ride Distance</th>
              <th>Ride Time</th>
              <th>User Fare</th>
              <th>Preferred Mode</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row let-i="rowIndex">
            <tr>
              <td>{{ i + 1 }}</td>
              <td>{{ row.created_at | date:'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ row.driver?.name || '—' }}</td>
              <td>{{ row.driver_id || '—' }}</td>
              <td>{{ row.id }}</td>
              <td>{{ row.distance_km || '—' }}</td>
              <td>{{ row.duration_min || '—' }}</td>
              <td>{{ row.final_fare ?? row.estimated_fare }}</td>
              <td>{{ row.payment_method || '—' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="9" class="empty">No rides.</td></tr>
          </ng-template>
        </p-table>
      </p-tabPanel>

      <p-tabPanel header="Wallet Transactions">
        <p-table [value]="walletTxns" [loading]="loadingTab" responsiveLayout="scroll">
          <ng-template pTemplate="header">
            <tr>
              <th>Transaction Time</th>
              <th>Engagement ID</th>
              <th>Amount</th>
              <th>D/C/CB/DAC</th>
              <th>Comments</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.created_at | date:'yyyy-MM-dd HH:mm:ss' }}</td>
              <td>{{ row.engagement_id || '—' }}</td>
              <td>{{ row.amount }}</td>
              <td>{{ shortType(row.type) }}</td>
              <td>{{ row.reason || '—' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="5" class="empty">No data available in table.</td></tr>
          </ng-template>
        </p-table>
      </p-tabPanel>

      <p-tabPanel header="Cancelled Rides">
        <p-table [value]="cancelledRides" [loading]="loadingTab" responsiveLayout="scroll">
          <ng-template pTemplate="header">
            <tr>
              <th>S.No</th>
              <th>Date</th>
              <th>Engagement ID</th>
              <th>Cancelled Reason</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row let-i="rowIndex">
            <tr>
              <td>{{ i + 1 }}</td>
              <td>{{ row.created_at | date:'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ row.id }}</td>
              <td>{{ row.cancelled_reason || '—' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="4" class="empty">No cancelled rides.</td></tr>
          </ng-template>
        </p-table>
      </p-tabPanel>

      <p-tabPanel header="Referrals">
        <p-table [value]="referrals" [loading]="loadingTab" responsiveLayout="scroll">
          <ng-template pTemplate="header">
            <tr>
              <th>S.No</th>
              <th>Referred User ID</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Registered On</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row let-i="rowIndex">
            <tr>
              <td>{{ i + 1 }}</td>
              <td>{{ row.id }}</td>
              <td>{{ row.name || '—' }}</td>
              <td>{{ row.phone || '—' }}</td>
              <td>{{ row.email || '—' }}</td>
              <td>{{ row.created_at | date:'dd/MM/yyyy' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="6" class="empty">No referrals.</td></tr>
          </ng-template>
        </p-table>
      </p-tabPanel>
    </p-tabView>

    <!-- ─── Block/Delete dialog (matches Screenshot #9) ─── -->
    <p-dialog header="Delete User" [(visible)]="blockDeleteOpen"
              [modal]="true" [style]="{ width: '760px' }" [draggable]="false">
      <div class="bd-grid">
        <div class="bd-pane">
          <div class="bd-pane-head">Block Users</div>
          <div class="form-block">
            <label class="lbl">User Email</label>
            <input pInputText [value]="profile?.email || ''" disabled />

            <label class="lbl"><span class="req">*</span>Reason</label>
            <select [(ngModel)]="blockReason" class="select">
              <option value="">Select</option>
              <option value="Spam / fraud">Spam / fraud</option>
              <option value="Abusive behaviour">Abusive behaviour</option>
              <option value="Payment dispute">Payment dispute</option>
              <option value="Other">Other</option>
            </select>

            <button pButton label="Submit" class="p-button-success" [loading]="blockSaving"
                    [disabled]="!blockReason"
                    (click)="submitBlock()"></button>
          </div>
        </div>

        <div class="bd-pane">
          <div class="bd-pane-head">Delete User</div>
          <div class="form-block">
            <label class="lbl">User ID</label>
            <input pInputText [value]="profile?.id || ''" disabled />

            <label class="lbl"><span class="req">*</span>Reason <span class="hint">Char Limit: 50</span></label>
            <textarea pInputTextarea rows="3" maxlength="50"
                      [(ngModel)]="deleteReason"></textarea>

            <button pButton label="Submit" class="p-button-danger" [loading]="deleteSaving"
                    [disabled]="!deleteReason"
                    (click)="submitDelete()"></button>
          </div>
        </div>
      </div>
    </p-dialog>

    <!-- ─── Unsubscribe dialog ─── -->
    <p-dialog header="Unsubscribe User" [(visible)]="unsubOpen"
              [modal]="true" [style]="{ width: '440px' }" [draggable]="false">
      <div class="form">
        <label class="lbl">User ID</label>
        <input pInputText [value]="profile?.id || ''" disabled />

        <h4>Status</h4>
        <label class="cb"><input type="checkbox" [(ngModel)]="unsubEmail" /> Unsubscribe Email</label>
        <label class="cb"><input type="checkbox" [(ngModel)]="unsubSms" /> Unsubscribe SMS</label>
        <label class="cb"><input type="checkbox" [(ngModel)]="unsubPush" /> Unsubscribe Notifications</label>
      </div>
      <ng-template pTemplate="footer">
        <button pButton label="Cancel" class="p-button-secondary" (click)="unsubOpen = false"></button>
        <button pButton label="Submit" [loading]="unsubSaving" (click)="submitUnsub()"></button>
      </ng-template>
    </p-dialog>

    <!-- ─── Credit/Debit dialog ─── -->
    <p-dialog header="Manage Wallet Transactions" [(visible)]="walletOpen"
              [modal]="true" [style]="{ width: '520px' }" [draggable]="false">
      <div class="form">
        <label class="lbl">Type:</label>
        <select [(ngModel)]="walletType" class="select">
          <option value="credit">Credit</option>
          <option value="debit">Debit</option>
          <option value="cashback">Cashback</option>
          <option value="driver_added_cash">Driver Added Cash</option>
        </select>

        <label class="lbl">Amount:</label>
        <input pInputText type="number" [(ngModel)]="walletAmount" min="1" />

        <label class="lbl">Reason:</label>
        <textarea pInputTextarea rows="3" [(ngModel)]="walletReason"></textarea>
      </div>
      <ng-template pTemplate="footer">
        <button pButton label="Cancel" class="p-button-secondary" (click)="walletOpen = false"></button>
        <button pButton label="Submit" [loading]="walletSaving"
                [disabled]="!walletAmount || walletAmount <= 0"
                (click)="submitWallet()"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .page-head { text-align: center; margin: 12px 0 20px; }
    .lookup-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .lookup-card { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 16px;
                   display: flex; flex-direction: column; gap: 8px; }
    .lookup-card h3 { margin: 0 0 4px; text-align: center; font-size: 1.05rem; }
    .lookup-card .radios { display: flex; gap: 12px; justify-content: center; font-size: 0.9rem; }
    .profile-card { background: #fff; border: 1px solid #eee; border-radius: 8px;
                    padding: 16px; margin-bottom: 16px; }
    .card-title { text-align: center; text-decoration: underline; margin: 0 0 16px; font-size: 1.05rem; }
    .profile-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px 24px; }
    .row { display: grid; grid-template-columns: 160px 1fr; gap: 8px; padding: 4px 0; }
    .k { color: #555; }
    .v { color: #111; }
    .v.good { color: #2e7d32; }
    .v.bad { color: #b71c1c; }
    .action-row { display: flex; gap: 12px; justify-content: center; margin: 16px 0 24px; }
    .empty { text-align: center; padding: 16px; color: #888; }
    .form { display: flex; flex-direction: column; gap: 8px; }
    .form .lbl { font-weight: 500; margin-top: 6px; }
    .select { padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; background: #fff; }
    .cb { display: block; padding: 4px 0; }
    .bd-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .bd-pane { border: 1px solid #eee; border-radius: 6px; }
    .bd-pane-head { background: #29bff0; color: #fff; text-align: center;
                    padding: 10px; font-weight: 600; }
    .form-block { padding: 16px; display: flex; flex-direction: column; gap: 6px; }
    .req { color: #d32f2f; margin-right: 2px; }
    .hint { float: right; font-weight: normal; color: #888; }
  `],
})
export class CustomerDetailComponent implements OnInit {
  customerId!: number;
  profile: CustomerProfile | null = null;

  // Lookup forms (top of the page)
  userLookupQ = ''; userLookupBy = 'phone';
  driverLookupQ = ''; driverLookupBy = 'id';
  rideLookupQ = ''; rideLookupBy = 'id';

  // Tabs
  activeTab = 0;
  loadingTab = false;
  rides: any[] = [];
  walletTxns: any[] = [];
  cancelledRides: any[] = [];
  referrals: any[] = [];

  // Block/Delete dialog
  blockDeleteOpen = false;
  blockReason = '';
  deleteReason = '';
  blockSaving = false;
  deleteSaving = false;

  // Unsubscribe dialog
  unsubOpen = false;
  unsubEmail = false;
  unsubSms = false;
  unsubPush = false;
  unsubSaving = false;

  // Wallet dialog
  walletOpen = false;
  walletType = 'credit';
  walletAmount: number | null = null;
  walletReason = '';
  walletSaving = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private toast: MessageService,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      this.customerId = parseInt(p.get('id') || '0', 10);
      this.loadProfile();
      this.loadTab(0);
    });
  }

  loadProfile(): void {
    this.api.get<any>(`/admin/customers/${this.customerId}`).subscribe({
      next: (res) => {
        this.profile = res.customer;
        // Sync unsubscribe checkboxes with current state.
        this.unsubEmail = this.profile?.email_unsubscribed ?? false;
        this.unsubSms = this.profile?.sms_unsubscribed ?? false;
        this.unsubPush = this.profile?.push_unsubscribed ?? false;
      },
      error: (err) => this.toast.add({
        severity: 'error', summary: 'Load failed',
        detail: err?.error?.message || 'Could not load customer',
      }),
    });
  }

  onTabChange(event: any): void { this.loadTab(event.index); }

  loadTab(idx: number): void {
    if (!this.customerId) return;
    this.loadingTab = true;
    let path = '';
    if (idx === 0) path = `/admin/customers/${this.customerId}/rides`;
    else if (idx === 1) path = `/admin/customers/${this.customerId}/wallet/transactions`;
    else if (idx === 2) path = `/admin/customers/${this.customerId}/cancelled-rides`;
    else if (idx === 3) path = `/admin/customers/${this.customerId}/referrals`;

    this.api.get<any>(path).subscribe({
      next: (res) => {
        const data = res?.data?.data ?? [];
        if (idx === 0) this.rides = data;
        else if (idx === 1) this.walletTxns = data;
        else if (idx === 2) this.cancelledRides = data;
        else if (idx === 3) this.referrals = data;
        this.loadingTab = false;
      },
      error: () => { this.loadingTab = false; },
    });
  }

  // ── Lookup cards ───────────────────────────────────────────────────
  lookupUser(): void {
    const q = this.userLookupQ.trim();
    if (!q) return;
    // If the query is a numeric ID, navigate directly. Otherwise search via list.
    if (this.userLookupBy === 'id' && /^\d+$/.test(q)) {
      this.router.navigate(['/customers', q]);
    } else {
      this.router.navigate(['/customers'], { queryParams: { search: q } });
    }
  }
  lookupDriver(): void {
    const q = this.driverLookupQ.trim();
    if (!q) return;
    this.api.get<any>(`/admin/customers/lookup/driver?q=${encodeURIComponent(q)}&by=${this.driverLookupBy}`)
      .subscribe({
        next: (res) => {
          if (res?.driver) {
            this.toast.add({
              severity: 'success', summary: 'Driver found',
              detail: `${res.driver.name} (#${res.driver.id})`,
            });
            this.router.navigate(['/drivers/approvals', res.driver.id]);
          } else {
            this.toast.add({ severity: 'warn', summary: 'No driver found' });
          }
        },
        error: () => this.toast.add({ severity: 'warn', summary: 'No driver found' }),
      });
  }
  lookupRide(): void {
    const q = this.rideLookupQ.trim();
    if (!q) return;
    this.api.get<any>(`/admin/customers/lookup/ride?q=${encodeURIComponent(q)}`).subscribe({
      next: (res) => {
        if (res?.ride?.customer) {
          this.router.navigate(['/customers', res.ride.customer.id]);
        } else {
          this.toast.add({ severity: 'warn', summary: 'No ride found' });
        }
      },
      error: () => this.toast.add({ severity: 'warn', summary: 'No ride found' }),
    });
  }

  // ── Block/Delete dialog ────────────────────────────────────────────
  openBlockDelete(): void {
    this.blockReason = '';
    this.deleteReason = '';
    this.blockDeleteOpen = true;
  }
  submitBlock(): void {
    this.blockSaving = true;
    const path = this.profile?.is_suspended ? 'unblock' : 'block';
    const body = this.profile?.is_suspended ? {} : { reason: this.blockReason };
    this.api.post(`/admin/customers/${this.customerId}/${path}`, body).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: this.profile?.is_suspended ? 'Unblocked' : 'Blocked' });
        this.blockSaving = false;
        this.blockDeleteOpen = false;
        this.loadProfile();
      },
      error: (err) => {
        this.toast.add({ severity: 'error', summary: 'Failed', detail: err?.error?.message });
        this.blockSaving = false;
      },
    });
  }
  submitDelete(): void {
    this.deleteSaving = true;
    this.api.delete(`/admin/customers/${this.customerId}?reason=${encodeURIComponent(this.deleteReason)}`)
      .subscribe({
        next: () => {
          this.toast.add({ severity: 'success', summary: 'Deleted' });
          this.deleteSaving = false;
          this.blockDeleteOpen = false;
          this.router.navigate(['/customers']);
        },
        error: (err) => {
          this.toast.add({ severity: 'error', summary: 'Failed', detail: err?.error?.message });
          this.deleteSaving = false;
        },
      });
  }

  // ── Unsubscribe dialog ─────────────────────────────────────────────
  openUnsub(): void { this.unsubOpen = true; }
  submitUnsub(): void {
    this.unsubSaving = true;
    this.api.post(`/admin/customers/${this.customerId}/unsubscribe`, {
      email: this.unsubEmail,
      sms: this.unsubSms,
      push: this.unsubPush,
    }).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Preferences updated' });
        this.unsubSaving = false;
        this.unsubOpen = false;
        this.loadProfile();
      },
      error: (err) => {
        this.toast.add({ severity: 'error', summary: 'Failed', detail: err?.error?.message });
        this.unsubSaving = false;
      },
    });
  }

  // ── Wallet credit/debit dialog ─────────────────────────────────────
  openWallet(): void {
    this.walletType = 'credit';
    this.walletAmount = null;
    this.walletReason = '';
    this.walletOpen = true;
  }
  submitWallet(): void {
    this.walletSaving = true;
    this.api.post(`/admin/customers/${this.customerId}/wallet/transactions`, {
      type: this.walletType,
      amount: this.walletAmount,
      reason: this.walletReason || null,
    }).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Transaction recorded' });
        this.walletSaving = false;
        this.walletOpen = false;
        this.loadProfile();
        if (this.activeTab === 1) this.loadTab(1);
      },
      error: (err) => {
        this.toast.add({ severity: 'error', summary: 'Failed', detail: err?.error?.message });
        this.walletSaving = false;
      },
    });
  }

  // Short label for the wallet-transaction type column.
  shortType(t: string): string {
    return ({
      credit: 'C',
      debit: 'D',
      cashback: 'CB',
      driver_added_cash: 'DAC',
    } as any)[t] || t;
  }
}

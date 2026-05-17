import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { ApiService } from '../../core/api.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';

type MessageType = 'push' | 'sms' | 'both';
type AudienceKey =
  | 'active'
  | 'free'
  | 'engaged'
  | 'live'
  | 'offline'
  | 'deactivated'
  | 'custom_csv';

interface AudienceRow {
  driver_id: number;
  name: string | null;
  phone: string | null;
  vehicle_type: string | null;
  is_online: boolean;
}

@Component({
  selector: 'app-contact-drivers',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    DropdownModule,
    InputTextareaModule,
    RadioButtonModule,
  ],
  template: `
    <p-card header="Contact Drivers">
      <div class="layout">
        <section class="form">
          <h3 class="section-title">Message Type</h3>
          <div class="radio-group">
            <div class="radio">
              <p-radioButton name="messageType" value="push" [(ngModel)]="messageType" inputId="mt-push"></p-radioButton>
              <label for="mt-push">Push</label>
            </div>
            <div class="radio">
              <p-radioButton name="messageType" value="sms" [(ngModel)]="messageType" inputId="mt-sms"></p-radioButton>
              <label for="mt-sms">SMS</label>
            </div>
            <div class="radio">
              <p-radioButton name="messageType" value="both" [(ngModel)]="messageType" inputId="mt-both"></p-radioButton>
              <label for="mt-both">SMS and Push</label>
            </div>
          </div>

          <h3 class="section-title">Send {{ sendVerb }}</h3>

          <label class="field-label">To</label>
          <p-dropdown
            [options]="audienceOptions"
            [(ngModel)]="audience"
            optionLabel="label"
            optionValue="value"
            (onChange)="onAudienceChange()"
          ></p-dropdown>

          <ng-container *ngIf="audience !== 'custom_csv'">
            <label class="field-label">Vehicle Type</label>
            <p-dropdown
              [options]="vehicleOptions"
              [(ngModel)]="vehicleType"
              optionLabel="label"
              optionValue="value"
              [showClear]="true"
              (onChange)="refreshAudience()"
              placeholder="All"
            ></p-dropdown>
          </ng-container>

          <ng-container *ngIf="audience === 'custom_csv'">
            <div class="csv-block">
              <input
                type="file"
                accept=".csv,text/csv"
                #csvInput
                (change)="onCsvSelected($event)"
                style="display: none"
              />
              <button
                pButton
                type="button"
                label="Choose CSV"
                icon="pi pi-upload"
                class="p-button-outlined"
                (click)="csvInput.click()"
              ></button>
              <a [href]="sampleCsvUrl" download class="sample-link">
                <i class="pi pi-download"></i> Download Sample CSV
              </a>
              <div *ngIf="csvFileName" class="muted">Loaded: {{ csvFileName }} ({{ rows.length }} drivers)</div>
              <div *ngIf="csvError" class="error">{{ csvError }}</div>
            </div>
          </ng-container>

          <label class="field-label">
            Message
            <span class="count">Count: {{ message.length }}</span>
          </label>
          <textarea
            pInputTextarea
            [(ngModel)]="message"
            rows="5"
            placeholder="Type your message..."
            maxlength="1000"
          ></textarea>

          <button
            pButton
            type="button"
            [label]="sendButtonLabel"
            class="send-btn"
            [disabled]="!canSend || sending"
            (click)="send()"
          ></button>

          <div *ngIf="sendResult" class="ok">
            Sent to {{ sendResult.recipients }} drivers
            (push: {{ sendResult.sent_push }}, sms: {{ sendResult.sent_sms }}, skipped: {{ sendResult.skipped }})
          </div>
          <div *ngIf="sendError" class="error">{{ sendError }}</div>
        </section>

        <section class="preview">
          <div class="preview-toolbar">
            <input
              type="search"
              [(ngModel)]="search"
              placeholder="Search..."
              class="search"
            />
          </div>
          <p-table [value]="filteredRows" [loading]="loading" responsiveLayout="scroll">
            <ng-template pTemplate="header">
              <tr>
                <th style="width:3rem"></th>
                <th>Driver ID</th>
                <th>Driver Name</th>
                <th>Driver Phone NO</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr>
                <td>
                  <input type="checkbox" checked disabled aria-label="Selected" />
                </td>
                <td>#{{ row.driver_id }}</td>
                <td>{{ row.name || '-' }}</td>
                <td>{{ row.phone || '-' }}</td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="4" class="empty">No data available in table</td>
              </tr>
            </ng-template>
          </p-table>
          <div class="muted summary">
            Showing {{ filteredRows.length }} of {{ rows.length }} drivers
          </div>
        </section>
      </div>
    </p-card>
  `,
  styles: [
    `
      .layout {
        display: grid;
        grid-template-columns: minmax(360px, 1fr) 1.4fr;
        gap: 18px;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: rgba(248, 250, 252, 0.7);
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 12px;
        padding: 16px;
      }
      .section-title {
        margin: 12px 0 6px;
        font-size: 14px;
        font-weight: 800;
        color: #0f172a;
      }
      .field-label {
        margin-top: 8px;
        font-size: 12px;
        font-weight: 700;
        color: rgba(15, 23, 42, 0.7);
        display: flex;
        justify-content: space-between;
      }
      .count {
        font-weight: 600;
        color: rgba(15, 23, 42, 0.55);
      }
      .radio-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .radio {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .csv-block {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        border: 1px dashed rgba(59, 130, 246, 0.4);
        background: rgba(59, 130, 246, 0.05);
        border-radius: 8px;
      }
      .sample-link {
        color: #3b82f6;
        font-weight: 700;
        font-size: 13px;
        text-decoration: none;
      }
      .sample-link i {
        margin-right: 4px;
      }
      .send-btn {
        margin-top: 14px;
      }
      .preview-toolbar {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 8px;
      }
      .search {
        padding: 6px 10px;
        border: 1px solid rgba(15, 23, 42, 0.16);
        border-radius: 6px;
        font-size: 13px;
      }
      .empty {
        text-align: center;
        padding: 24px;
        color: rgba(15, 23, 42, 0.55);
      }
      .summary {
        margin-top: 8px;
        font-size: 12px;
        text-align: right;
      }
      .muted {
        color: rgba(15, 23, 42, 0.6);
        font-size: 12px;
      }
      .error {
        margin-top: 8px;
        color: #b00020;
        font-weight: 700;
      }
      .ok {
        margin-top: 8px;
        color: #1f8b4c;
        font-weight: 700;
      }
      @media (max-width: 980px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class ContactDriversComponent implements OnInit {
  messageType: MessageType = 'both';
  audience: AudienceKey = 'active';
  vehicleType: string | null = null;
  message = '';
  search = '';

  rows: AudienceRow[] = [];
  loading = false;
  sending = false;
  sendError: string | null = null;
  sendResult: { recipients: number; sent_push: number; sent_sms: number; skipped: number } | null =
    null;

  csvFileName: string | null = null;
  csvDriverIds: number[] = [];
  csvError: string | null = null;

  audienceOptions = [
    { label: 'Active Drivers', value: 'active' },
    { label: 'Free Drivers (online & idle)', value: 'free' },
    { label: 'Engaged Drivers (on a trip)', value: 'engaged' },
    { label: 'Live Drivers (online)', value: 'live' },
    { label: 'Offline Drivers', value: 'offline' },
    { label: 'Deactivated Drivers', value: 'deactivated' },
    { label: 'Custom CSV', value: 'custom_csv' },
  ];

  vehicleOptions: { label: string; value: string | null }[] = [
    { label: 'All', value: null },
  ];

  constructor(private api: ApiService, private http: HttpClient) {}

  ngOnInit(): void {
    this.loadVehicleTypes();
    this.refreshAudience();
  }

  get sampleCsvUrl(): string {
    const apiBase = localStorage.getItem('dreamcabs_api_base')?.trim() || 'http://localhost:8000/api';
    return apiBase.replace(/\/api\/?$/, '') + '/samples/contact_drivers_sample.csv';
  }

  get sendVerb(): string {
    if (this.messageType === 'push') return 'Push';
    if (this.messageType === 'sms') return 'SMS';
    return 'SMS and Push';
  }

  get sendButtonLabel(): string {
    if (this.messageType === 'push') return 'Send Push';
    if (this.messageType === 'sms') return 'Send SMS';
    return 'Send SMS And Push';
  }

  get canSend(): boolean {
    return this.message.trim().length > 0 && this.rows.length > 0;
  }

  get filteredRows(): AudienceRow[] {
    const term = this.search.trim().toLowerCase();
    if (!term) return this.rows;
    return this.rows.filter(
      (r) =>
        String(r.driver_id).includes(term) ||
        (r.name || '').toLowerCase().includes(term) ||
        (r.phone || '').toLowerCase().includes(term),
    );
  }

  onAudienceChange(): void {
    this.csvFileName = null;
    this.csvDriverIds = [];
    this.csvError = null;
    this.rows = [];
    if (this.audience !== 'custom_csv') {
      this.refreshAudience();
    }
  }

  refreshAudience(): void {
    if (this.audience === 'custom_csv') {
      return;
    }
    this.loading = true;
    const params: string[] = [`to=${this.audience}`];
    if (this.vehicleType) params.push(`vehicle_type=${encodeURIComponent(this.vehicleType)}`);
    this.api.get<{ data: AudienceRow[] }>(`/admin/contact-drivers/audience?${params.join('&')}`).subscribe({
      next: (res) => {
        this.rows = res?.data ?? [];
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.loading = false;
      },
    });
  }

  onCsvSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.csvError = null;
    this.csvFileName = file.name;
    this.loading = true;

    const form = new FormData();
    form.append('file', file);

    const apiBase = localStorage.getItem('dreamcabs_api_base')?.trim() || 'http://localhost:8000/api';
    const token = localStorage.getItem('dreamcabs_token');
    const headers = new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});

    this.http
      .post<{ data: AudienceRow[]; driver_ids: number[]; message?: string }>(
        `${apiBase}/admin/contact-drivers/upload-csv`,
        form,
        { headers },
      )
      .subscribe({
        next: (res) => {
          this.rows = res?.data ?? [];
          this.csvDriverIds = res?.driver_ids ?? [];
          if (res?.message) this.csvError = res.message;
          this.loading = false;
        },
        error: (err) => {
          this.csvError = err?.error?.message || 'CSV upload failed';
          this.rows = [];
          this.csvDriverIds = [];
          this.loading = false;
        },
      });

    input.value = '';
  }

  send(): void {
    this.sending = true;
    this.sendError = null;
    this.sendResult = null;

    const body: Record<string, unknown> = {
      message_type: this.messageType,
      to: this.audience,
      message: this.message,
    };
    if (this.vehicleType) body['vehicle_type'] = this.vehicleType;
    if (this.audience === 'custom_csv') body['driver_ids'] = this.csvDriverIds;

    this.api
      .post<{ recipients: number; sent_push: number; sent_sms: number; skipped: number }>(
        '/admin/contact-drivers/send',
        body,
      )
      .subscribe({
        next: (res) => {
          this.sendResult = res;
          this.message = '';
        },
        error: (err) => {
          this.sendError = err?.error?.message || 'Send failed';
        },
        complete: () => (this.sending = false),
      });
  }

  private loadVehicleTypes(): void {
    this.api.get<{ data: { name: string }[] }>('/admin/ride-types').subscribe({
      next: (res) => {
        const items = res?.data || [];
        this.vehicleOptions = [
          { label: 'All', value: null },
          ...items.map((rt) => ({ label: rt.name, value: rt.name })),
        ];
      },
      error: () => {
        // Silent — keep "All".
      },
    });
  }
}

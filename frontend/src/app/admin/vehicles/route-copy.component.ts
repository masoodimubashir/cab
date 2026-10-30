import { Component, DestroyRef, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, ModalComponent } from '../../ui';
import { MasterRoute } from './master-explorer.component';

@Component({
  selector: 'app-route-copy', standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ModalComponent],
  template: `
    <tm-modal [open]="true" [title]="reverse ? 'Copy as reverse' : 'Copy route'" [dismissible]="!saving" [showClose]="!saving" (closed)="close()">
      <form slot="body" (ngSubmit)="save()">
        <p class="direction">{{ reverse ? route.dest_name : route.origin_name }} → {{ reverse ? route.origin_name : route.dest_name }}</p>
        <label for="copied-route-name">New route name</label>
        <input id="copied-route-name" name="routeName" [(ngModel)]="name" required maxlength="120" [disabled]="saving" />
        <p>The copy keeps the vehicle, fares and settings. It starts inactive, with no stand assignments. Review it, then activate and assign it to a stand.</p>
        <p *ngIf="reverse">Stops and pickup/drop permissions are reversed. Review the return-direction map before activation.</p>
        <p class="error" role="alert" *ngIf="error">{{ error }}</p>
      </form>
      <div slot="footer" class="actions"><tm-button variant="ghost" [disabled]="saving" (clicked)="close()">Cancel</tm-button><tm-button variant="green" [disabled]="saving" (clicked)="save()">{{ saving ? 'Copying…' : 'Create copy' }}</tm-button></div>
    </tm-modal>
  `,
  styles: [`
    label { display: block; font-weight: 700; margin-bottom: 8px; }
    input { box-sizing: border-box; width: 100%; padding: 11px 13px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-surface); color: var(--tm-text); font: inherit; }
    p { font-size: 13px; line-height: 1.6; color: var(--tm-text-muted); }
    .direction { font-weight: 700; color: var(--tm-text); margin-top: 0; }.error { color: var(--tm-danger-fg); }
    .actions { display: flex; justify-content: flex-end; gap: 8px; width: 100%; }
  `],
})
export class RouteCopyComponent implements OnInit {
  @Input() cityId!: number;
  @Input() route!: MasterRoute;
  @Input() reverse = false;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<{ id: number; name: string }>();
  name = ''; saving = false; error = '';
  constructor(private api: ApiService, private toast: ToastService, private destroyRef: DestroyRef) {}
  ngOnInit(): void {
    this.name = this.reverse ? `${this.route.dest_name.slice(0, 58)} → ${this.route.origin_name.slice(0, 58)}` : `${this.route.name.slice(0, 113)} (copy)`;
  }
  close(): void { if (!this.saving) this.closed.emit(); }
  save(): void {
    if (this.saving) return;
    const name = this.name.trim();
    if (!name || name.length > 120) { this.error = 'Enter a route name, up to 120 characters.'; return; }
    this.saving = true; this.error = '';
    this.api.post<{ route: { id: number; name: string } }>(`/admin/cities/${this.cityId}/fixed-routes/${this.route.id}/copy`, { name, reverse: this.reverse })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: result => { this.saving = false; this.toast.success('Route copied. Review and activate it when ready.'); this.saved.emit(result.route); this.closed.emit(); },
        error: err => { this.saving = false; this.error = err?.status === 422 && err?.error?.errors?.name ? 'Choose a unique route name, up to 120 characters, for this city.' : err?.error?.message || 'Could not copy route. Try again.'; },
      });
  }
}

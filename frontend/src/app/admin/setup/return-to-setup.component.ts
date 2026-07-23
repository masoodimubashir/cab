import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { IconComponent } from '../../ui';

/**
 * Tiny banner that renders only when the current route has ?from=setup. Gives
 * admins a one-click way back to the wizard so they don't get stranded when
 * the wizard step opens a full page instead of an in-place drawer.
 */
@Component({
  selector: 'app-return-to-setup',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <a *ngIf="show" class="rts" (click)="back($event)" [attr.href]="targetUrl">
      <tm-icon name="chevron-left" [size]="14" />
      <span>{{ label }}</span>
    </a>
  `,
  styles: [`
    .rts { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; margin-bottom: 12px; border-radius: 8px; background: var(--tm-green-tint, #ecfdf5); color: var(--tm-green, #16a34a); font-size: 12.5px; font-weight: 700; text-decoration: none; cursor: pointer; border: 1px solid var(--tm-green, #16a34a); width: fit-content; }
    .rts:hover { background: var(--tm-green, #16a34a); color: #fff; }
  `],
})
export class ReturnToSetupComponent implements OnInit, OnDestroy {
  show = false;
  targetUrl = '/setup';
  label = 'Back to Setup Wizard';
  private sub?: Subscription;

  constructor(private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    this.sub = this.route.queryParamMap.subscribe((p) => {
      const from = p.get('from');
      if (from === 'fleet') {
        this.show = true;
        this.targetUrl = '/fleet';
        this.label = 'Back to Fleet Setup';
      } else if (from === 'setup') {
        this.show = true;
        this.targetUrl = '/setup';
        this.label = 'Back to Setup Wizard';
      } else {
        this.show = false;
      }
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  back(ev: MouseEvent): void {
    ev.preventDefault();
    this.router.navigateByUrl(this.targetUrl);
  }
}

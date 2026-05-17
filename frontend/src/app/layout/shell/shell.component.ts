import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { NavSection } from '../nav.types';

/**
 * Top-level frame that composes Sidebar + main content area.
 * Manages mobile drawer state. Topbar/content are projected as children:
 *
 *   <tm-shell [sections]="nav">
 *     <tm-topbar title="Dashboard" (menuClick)="shell.openMobile()">...</tm-topbar>
 *     <router-outlet />
 *   </tm-shell>
 *
 * Or use the [openMobile] two-way pattern if the topbar lives outside the shell.
 */
@Component({
  selector: 'tm-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, SidebarComponent],
  template: `
    <div class="shell">
      <tm-sidebar
        [sections]="sections"
        [scopeLabel]="scopeLabel"
        [scopeValue]="scopeValue"
        [mobileOpen]="mobileOpen"
        (closeMobile)="closeMobile()"
      />
      <div class="shell__main">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .shell {
      display: grid;
      grid-template-columns: var(--tm-sidebar-w) 1fr;
      min-height: 100vh;
      background: var(--tm-canvas);
    }
    .shell__main {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 100vh;
    }
    @media (max-width: 1199px) and (min-width: 881px) {
      .shell { grid-template-columns: 240px 1fr; }
    }
    @media (max-width: 880px) {
      .shell { grid-template-columns: 1fr; }
    }
  `],
})
export class ShellComponent {
  @Input() sections: NavSection[] = [];
  @Input() scopeLabel?: string;
  @Input() scopeValue?: string | null;

  mobileOpen = false;

  constructor(router: Router) {
    // Close drawer on navigation
    router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      if (this.mobileOpen) this.mobileOpen = false;
    });
  }

  openMobile() { this.mobileOpen = true; }
  closeMobile() { this.mobileOpen = false; }
}

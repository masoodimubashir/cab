import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  Output,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { IconComponent, BrandMarkComponent } from '../../ui';
import { NavItem, NavSection } from '../nav.types';

/**
 *   <tm-sidebar
 *     [sections]="navSections"
 *     [scopeLabel]="'Scoped to'"
 *     [scopeValue]="cityName"
 *   />
 *
 * Groups are collapsed by default. The group containing the active route
 * auto-expands on navigation so the user always sees their context.
 */
@Component({
  selector: 'tm-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, RouterLinkActive, IconComponent, BrandMarkComponent],
  template: `
    <aside class="sb" [class.is-mobile-open]="mobileOpen">
      <header class="sb__head">
        <tm-brand-mark />
        <button
          *ngIf="mobileOpen"
          class="sb__close"
          type="button"
          (click)="closeMobile.emit()"
          aria-label="Close menu"
        >
          <tm-icon name="x" [size]="18" />
        </button>
      </header>

      <div class="sb__scope" *ngIf="scopeValue">
        <tm-icon name="map-marker" [size]="16" />
        <div>
          <div class="sb__scope-lbl">{{ scopeLabel || 'Scoped to' }}</div>
          <div class="sb__scope-val">{{ scopeValue }}</div>
        </div>
      </div>

      <nav class="sb__nav" aria-label="Primary">
        <div class="sb__section" *ngFor="let section of sections; trackBy: trackSection">
          <div *ngIf="section.label" class="tm-overline sb__section-lbl">{{ section.label }}</div>

          <ng-container *ngFor="let item of section.items; let i = index; trackBy: trackItem">
            <!-- Leaf link -->
            <a
              *ngIf="!item.children?.length"
              [routerLink]="item.route"
              [queryParams]="item.queryParams || null"
              routerLinkActive
              #rla="routerLinkActive"
              class="sb__item"
              [class.is-active]="rla.isActive"
            >
              <tm-icon class="sb__item-icon" [name]="item.icon" [size]="18" />
              <span class="sb__item-lbl">{{ item.label }}</span>
              <span class="sb__badge" *ngIf="item.badge != null">{{ item.badge }}</span>
            </a>

            <!-- Group -->
            <ng-container *ngIf="item.children?.length">
              <button
                type="button"
                class="sb__item sb__group-toggle"
                [class.is-open]="isOpen(section, i, item)"
                [class.has-active-child]="hasActiveChild(item)"
                [attr.aria-expanded]="isOpen(section, i, item)"
                (click)="toggle(section, i)"
              >
                <tm-icon class="sb__item-icon" [name]="item.icon" [size]="18" />
                <span class="sb__item-lbl">{{ item.label }}</span>
                <tm-icon
                  class="sb__caret"
                  [class.is-rotated]="isOpen(section, i, item)"
                  name="chevron-right"
                  [size]="14"
                />
              </button>
              <div class="sb__children" *ngIf="isOpen(section, i, item)">
                <a
                  *ngFor="let child of item.children; trackBy: trackItem"
                  [routerLink]="child.route"
                  [queryParams]="child.queryParams || null"
                  routerLinkActive="is-active"
                  [routerLinkActiveOptions]="{ paths: 'exact', queryParams: 'exact', matrixParams: 'ignored', fragment: 'ignored' }"
                  class="sb__child"
                >
                  <span class="sb__child-lbl">{{ child.label }}</span>
                  <span class="sb__badge" *ngIf="child.badge != null">{{ child.badge }}</span>
                </a>
              </div>
            </ng-container>
          </ng-container>
        </div>
      </nav>
    </aside>

    <div class="sb-scrim" *ngIf="mobileOpen" (click)="closeMobile.emit()" aria-hidden="true"></div>
  `,
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent implements OnDestroy {
  @Input() sections: NavSection[] = [];
  @Input() scopeLabel?: string;
  @Input() scopeValue?: string | null;
  @Input() mobileOpen = false;

  @Output() closeMobile = new EventEmitter<void>();

  /** Explicit user toggle state. Null means "follow active-route". */
  private openMap = new Map<string, boolean>();
  private currentUrl: string;
  private sub: Subscription;

  constructor(private router: Router, private cdr: ChangeDetectorRef) {
    this.currentUrl = router.url;
    this.sub = router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.currentUrl = (e as NavigationEnd).urlAfterRedirects;
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  isOpen(section: NavSection, idx: number, item: NavItem): boolean {
    const key = this.keyFor(section, idx);
    if (this.openMap.has(key)) return !!this.openMap.get(key);
    if (this.hasActiveChild(item)) return true;
    return item.initiallyOpen ?? false;
  }

  toggle(section: NavSection, idx: number): void {
    const key = this.keyFor(section, idx);
    const item = section.items[idx];
    const current = this.openMap.has(key)
      ? !!this.openMap.get(key)
      : this.hasActiveChild(item) || (item.initiallyOpen ?? false);
    this.openMap.set(key, !current);
  }

  hasActiveChild(item: NavItem): boolean {
    if (!item.children?.length) return false;
    return item.children.some((c) => !!c.route && this.isRouteActive(c.route));
  }

  private isRouteActive(route: string): boolean {
    if (!route) return false;
    // currentUrl includes query string + fragment; the configured `route` does
    // not (queryParams come from NavItem.queryParams). Compare path-only so a
    // child link like `/drivers` with `?tab=…` still matches when we're on
    // `/drivers?tab=documents`.
    const path = this.currentUrl.split('?')[0].split('#')[0];
    return path === route || path.startsWith(route + '/');
  }

  private keyFor(section: NavSection, idx: number): string {
    const sectionId = this.sections.indexOf(section);
    return `${sectionId}:${idx}`;
  }

  trackSection = (_: number, s: NavSection) => s.label ?? _;
  trackItem = (_: number, i: NavItem) => i.route ?? i.label;
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IconComponent,
  IconTileComponent,
  AvatarComponent,
} from '../../ui';

/**
 *   <tm-topbar
 *     [title]="'Dashboard'"
 *     [subtitle]="'Today at a glance'"
 *     [user]="{ name: 'Admin', initials: 'AD' }"
 *     (menuClick)="openMobileNav()"
 *     (profile)="goProfile()"
 *     (logout)="logout()"
 *   >
 *     <tm-button variant="green">New Trip</tm-button>
 *   </tm-topbar>
 *
 * Slots:
 *   default     — primary action buttons on the right
 *   [slot=lead] — extra content next to the title (breadcrumbs, tabs, etc.)
 */
@Component({
  selector: 'tm-topbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent, IconTileComponent, AvatarComponent],
  template: `
    <header class="tb">
      <button class="tb__burger" type="button" (click)="menuClick.emit()" aria-label="Open menu">
        <tm-icon name="menu" [size]="20" />
      </button>

      <div class="tb__title-block">
        <h1 class="tm-h2 tb__title">{{ title }}</h1>
        <p class="tb__subtitle" *ngIf="subtitle">{{ subtitle }}</p>
        <ng-content select="[slot=lead]"></ng-content>
      </div>

      <div class="tb__actions">
        <ng-content></ng-content>
        <tm-icon-tile
          *ngIf="showNotifications"
          icon="bell"
          tone="surface"
          size="md"
          class="tb__bell"
        />

        <div class="tb__user-wrap" *ngIf="user">
          <button
            type="button"
            class="tb__user"
            [class.is-open]="menuOpen"
            [attr.aria-expanded]="menuOpen"
            aria-haspopup="menu"
            (click)="toggleMenu($event)"
          >
            <div class="tb__user-meta">
              <div class="tb__user-name">{{ user.name }}</div>
              <div class="tb__user-role" *ngIf="user.role">{{ user.role }}</div>
            </div>
            <tm-avatar
              [src]="user.photo"
              [initials]="user.initials"
              size="md"
              [online]="user.online ?? false"
            />
          </button>

          <div class="tb__menu" *ngIf="menuOpen" role="menu">
            <div class="tb__menu-head">
              <tm-avatar
                [src]="user.photo"
                [initials]="user.initials"
                size="md"
                [online]="user.online ?? false"
              />
              <div class="tb__menu-meta">
                <div class="tb__menu-name">{{ user.name }}</div>
                <div class="tb__menu-role" *ngIf="user.role">{{ user.role }}</div>
              </div>
            </div>
            <button type="button" class="tb__menu-item" role="menuitem" (click)="onProfile()">
              <tm-icon name="user" [size]="16" />
              <span>Profile</span>
            </button>
            <button type="button" class="tb__menu-item tb__menu-item--danger" role="menuitem" (click)="onLogout()">
              <tm-icon name="sign-out" [size]="16" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  `,
  styleUrls: ['./topbar.component.scss'],
})
export class TopbarComponent {
  @Input({ required: true }) title!: string;
  @Input() subtitle?: string;
  @Input() showNotifications = true;
  @Input() user?: {
    name: string;
    role?: string;
    initials?: string;
    photo?: string | null;
    online?: boolean;
  };

  @Output() menuClick = new EventEmitter<void>();
  @Output() profile = new EventEmitter<void>();
  @Output() logout = new EventEmitter<void>();

  menuOpen = false;

  constructor(private host: ElementRef<HTMLElement>) {}

  toggleMenu(e: Event): void {
    e.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  onProfile(): void {
    this.menuOpen = false;
    this.profile.emit();
  }

  onLogout(): void {
    this.menuOpen = false;
    this.logout.emit();
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (!this.menuOpen) return;
    if (!this.host.nativeElement.contains(e.target as Node)) this.menuOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.menuOpen) this.menuOpen = false;
  }
}

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { IconComponent } from '../../ui';
import { CityContextService, CityOption } from '../../core/city-context.service';

/**
 * Global city switcher — the single control that scopes the whole admin.
 * Lives in the topbar. Every city-scoped page observes CityContextService;
 * changing the city here re-scopes them all.
 *
 * Scoped managers (CityContextService.isLocked) see a read-only label.
 */
@Component({
  selector: 'tm-city-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <!-- Locked: scoped managers can't switch -->
    <div class="cs cs--locked" *ngIf="locked">
      <tm-icon name="pin" [size]="15" />
      <span class="cs__name">{{ currentName || 'No city' }}</span>
      <span class="cs__lock-tag">Scoped</span>
    </div>

    <!-- Switchable: super admin -->
    <div class="cs" *ngIf="!locked">
      <button
        type="button"
        class="cs__btn"
        [class.is-open]="open"
        [attr.aria-expanded]="open"
        aria-haspopup="listbox"
        (click)="toggle($event)"
      >
        <tm-icon name="pin" [size]="15" />
        <span class="cs__name">{{ currentName || 'Select city' }}</span>
        <tm-icon class="cs__caret" name="chevron-down" [size]="14" />
      </button>

      <div class="cs__pop" *ngIf="open" role="listbox">
        <div class="cs__search">
          <tm-icon name="search" [size]="14" />
          <input
            #searchBox
            type="text"
            [(ngModel)]="filter"
            placeholder="Search city…"
            autocomplete="off"
          />
        </div>
        <ul class="cs__list">
          <li
            *ngFor="let c of filtered()"
            class="cs__item"
            [class.is-active]="c.id === currentId"
            role="option"
            [attr.aria-selected]="c.id === currentId"
            (click)="pick(c)"
          >
            <span class="cs__dot" [class.on]="c.id === currentId"></span>
            <span class="cs__item-name">{{ c.name }}</span>
            <span class="cs__inactive" *ngIf="c.is_active === false">inactive</span>
            <tm-icon *ngIf="c.id === currentId" name="check" [size]="14" />
          </li>
          <li *ngIf="filtered().length === 0" class="cs__empty">No cities found</li>
        </ul>
        <button type="button" class="cs__manage" (click)="manage()">
          <tm-icon name="plus" [size]="14" />
          <span>Add / manage cities</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: inline-flex; }

    .cs { position: relative; }

    .cs--locked,
    .cs__btn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 36px;
      padding: 0 12px;
      border-radius: var(--tm-radius-md, 10px);
      background: var(--tm-canvas-2);
      color: var(--tm-text);
      font-size: 13px;
      font-weight: 700;
    }
    .cs__btn {
      cursor: pointer;
      border: 1px solid transparent;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .cs__btn:hover { background: var(--tm-line); }
    .cs__btn.is-open { border-color: var(--tm-green, #06b6d4); }
    .cs__name { white-space: nowrap; }
    .cs__caret { color: var(--tm-text-muted); }

    .cs__lock-tag {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: var(--tm-text-muted);
      background: var(--tm-surface);
      padding: 2px 6px;
      border-radius: 6px;
    }

    .cs__pop {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      width: 248px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      box-shadow: var(--tm-shadow-pop);
      z-index: 1200;
      overflow: hidden;
      animation: cs-pop var(--tm-duration-fast) var(--tm-ease) both;
    }
    @keyframes cs-pop {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .cs__search {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--tm-line);
      color: var(--tm-text-muted);
    }
    .cs__search input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 13px;
      color: var(--tm-text);
    }

    .cs__list {
      list-style: none;
      margin: 0;
      padding: 6px;
      max-height: 280px;
      overflow-y: auto;
    }
    .cs__item {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 8px 9px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--tm-text);
      cursor: pointer;
    }
    .cs__item:hover { background: var(--tm-canvas-2); }
    .cs__item.is-active { background: var(--tm-canvas-2); }
    .cs__item-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs__dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--tm-line);
      flex: none;
    }
    .cs__dot.on { background: var(--tm-green, #06b6d4); }
    .cs__inactive {
      font-size: 10px;
      font-weight: 700;
      color: var(--tm-text-muted);
    }
    .cs__empty {
      padding: 14px 10px;
      font-size: 12px;
      color: var(--tm-text-muted);
      text-align: center;
    }

    .cs__manage {
      display: flex;
      align-items: center;
      gap: 7px;
      width: 100%;
      padding: 11px 14px;
      border-top: 1px solid var(--tm-line);
      background: var(--tm-canvas-2);
      color: var(--tm-text);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .cs__manage:hover { background: var(--tm-line); }
  `],
})
export class CitySwitcherComponent implements OnInit, OnDestroy {
  cities: CityOption[] = [];
  currentId: number | null = null;
  open = false;
  filter = '';

  private subs: Subscription[] = [];

  constructor(
    public cityCtx: CityContextService,
    private router: Router,
    private host: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
  ) {}

  get locked(): boolean {
    return this.cityCtx.isLocked;
  }

  get currentName(): string {
    return this.cities.find((c) => c.id === this.currentId)?.name ?? '';
  }

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cities$.subscribe((list) => {
        this.cities = list;
        this.cdr.markForCheck();
      }),
      this.cityCtx.cityId$.subscribe((id) => {
        this.currentId = id;
        this.cdr.markForCheck();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  filtered(): CityOption[] {
    const q = this.filter.trim().toLowerCase();
    return q ? this.cities.filter((c) => c.name.toLowerCase().includes(q)) : this.cities;
  }

  toggle(e: Event): void {
    e.stopPropagation();
    this.open = !this.open;
    if (!this.open) this.filter = '';
  }

  pick(c: CityOption): void {
    this.cityCtx.setCityId(c.id);
    this.open = false;
    this.filter = '';
  }

  manage(): void {
    this.open = false;
    this.router.navigateByUrl('/city');
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(e.target as Node)) {
      this.open = false;
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.open) {
      this.open = false;
      this.cdr.markForCheck();
    }
  }
}

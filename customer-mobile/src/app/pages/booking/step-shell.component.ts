import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

/**
 * The one shell every booking step wears.
 *
 * This is the thing the redesign is really about: back arrow, the trip it's
 * for, a "step 3 of 5" counter, a progress bar, a left-aligned title, and one
 * green button docked at the bottom — laid out the same way whether the rider
 * is booking a car, a seat or a pool. A rider who learns one flow already knows
 * the others, because the frame around every step is identical.
 *
 * A screen supplies only its middle:
 *
 *   <app-step-shell title="Choose your ride" [step]="3" [total]="5"
 *                   [from]="from" [to]="to" cta="Next"
 *                   (back)="back()" (primary)="next()">
 *     ...the step's own rows go here...
 *   </app-step-shell>
 *
 * Titles are left-aligned by rule (a centred title lands under an Android
 * camera hole). The notch and gesture-bar insets ride on the shell, so no
 * screen has to think about them.
 */
@Component({
  selector: 'app-step-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonicModule],
  template: `
    <div class="sf" [class.sf--reference]="reference" [class.sf--header-title]="titleInHeader" [class.sf--map-layout]="mapLayout" [class.sf--inline-search]="inlineSearch" [class.sf--body-hidden]="hideBody">
      <!-- Bar: back · trip · step counter. Fixed; never scrolls away. -->
      <header class="sf__bar" *ngIf="!mapHeader">
        <button class="sf__back" type="button" aria-label="Go back" (click)="back.emit()"><ion-icon name="arrow-back-outline" aria-hidden="true"></ion-icon></button>

        <div class="sf__trip" *ngIf="from || to; else titleInBar">
          <span class="sf__place">{{ shorten(from) }}</span>
          <span class="sf__arrow" aria-hidden="true" *ngIf="from && to">→</span>
          <span class="sf__place" *ngIf="to">{{ shorten(to) }}</span>
        </div>
        <ng-template #titleInBar><div class="sf__trip sf__trip--label">{{ barLabel }}</div></ng-template>

        <h1 class="sf__bar-title" *ngIf="titleInHeader">{{ title }}</h1>

        <span class="sf__step" *ngIf="fareLabel || stepLabel">{{ fareLabel || stepLabel }}</span>
      </header>

      <!-- Progress: one segment per step, filled up to the current one. -->
      <div class="sf__prg" *ngIf="total > 0 && !mapHeader" aria-hidden="true">
        <span *ngFor="let seg of segments; let i = index" [class.on]="i < step"></span>
      </div>

      <div class="sf__map" *ngIf="mapLayout"><ng-content select="[step-map]"></ng-content></div>

      <!-- The step's own content. Scrolls if it must; the button never does. -->
      <div class="sf__body" [hidden]="hideBody">
        <h1 class="sf__caption" *ngIf="reference && compactTitle">Step {{ step }} of {{ total }} · {{ title }}</h1>
        <p class="sf__caption" *ngIf="reference && total > 0 && !compactTitle">Step {{ step }} of {{ total }}<ng-container *ngIf="!titleInHeader"> · {{ title }}</ng-container></p>
        <div class="sf__title-row" *ngIf="title && !compactTitle && !titleInHeader">
          <h1 class="bk-title">{{ title }}</h1>
          <ng-content select="[title-action]"></ng-content>
        </div>
        <p class="bk-sub" *ngIf="subtitle">{{ subtitle }}</p>
        <ng-content></ng-content>
      </div>

      <!-- One primary action, always in the same place. A second, quieter
           action (Back, Cancel) can be projected in via [slot=dock-extra]. -->
      <footer class="sf__dock" *ngIf="cta || hasDock">
        <ng-content select="[dock-extra]"></ng-content>
        <div class="sf__actions" [class.sf__actions--pair]="secondaryLabel" [class.sf__actions--search]="inlineSearch">
        <ng-content select="[dock-search]"></ng-content>
        <button
          *ngIf="cta"
          class="sf__cta"
          type="button"
          [class.sf__cta--ghost]="ghost"
          [class.sf__cta--danger]="danger"
          [class.sf__cta--select]="selectAction"
          [attr.aria-expanded]="selectAction ? selectExpanded : null"
          [attr.data-place-search-control]="selectAction ? '' : null"
          [disabled]="disabled"
          (click)="primary.emit()">
          {{ cta }}
          <ion-icon *ngIf="actionArrow && !selectAction" name="arrow-forward-outline" aria-hidden="true"></ion-icon>
          <ion-icon *ngIf="selectAction" [name]="selectExpanded ? 'chevron-up-outline' : 'chevron-down-outline'" aria-hidden="true"></ion-icon>
        </button>
        <button *ngIf="secondaryLabel" class="sf__secondary" type="button" [disabled]="secondaryDisabled" (click)="secondary.emit()">{{ secondaryLabel }}</button>
        </div>
        <p class="sf__hint" *ngIf="dockHint">{{ dockHint }}</p>
        <ng-content select="[dock-bottom]"></ng-content>
      </footer>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    .sf {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--dc-canvas);
    }

    /* --- bar ------------------------------------------------------------ */
    .sf__bar {
      flex: none;
      display: flex;
      align-items: center;
      gap: 9px;
      padding: calc(var(--dc-safe-top)) var(--dc-safe-right) 10px var(--dc-safe-left);
      background: var(--dc-surface);
      box-shadow: var(--dc-shadow-sm);
      z-index: 2;
    }
    .sf__back {
      flex: none;
      /* 44px is the tap floor — the circle IS the target, so it can't be
         smaller even though a 38px circle would look a touch neater. */
      width: 44px; height: 44px;
      border-radius: 50%;
      border: 1px solid var(--dc-hairline);
      background: var(--dc-surface-2);
      color: var(--dc-ink);
      font-size: 22px;
      line-height: 1;
      display: flex; align-items: center; justify-content: center;
    }
    .sf__trip {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 700;
      color: var(--dc-ink);
    }
    .sf__trip--label { color: var(--dc-ink); }
    .sf--header-title .sf__trip { flex: 1 1 0; }
    .sf__bar-title { flex: 1 1 0; min-width: 0; margin: 0; text-align: center; color: var(--dc-ink); font-size: 16px; font-weight: 750; line-height: 1.3; overflow-wrap: anywhere; }
    /* Each place truncates on its own, so a long name on one end never
       squeezes the other down to nothing. */
    .sf__place { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sf__arrow { flex: none; color: var(--dc-ink-faint); }
    .sf__step {
      flex: none;
      font-size: var(--dc-t-caption);
      font-weight: 800;
      color: var(--dc-green);
      background: var(--dc-green-tint);
      border-radius: 999px;
      padding: 4px 9px;
      font-variant-numeric: tabular-nums;
    }

    /* --- progress ------------------------------------------------------- */
    .sf__prg { flex: none; display: flex; gap: 3px; padding: 9px var(--dc-safe-right) 0 var(--dc-safe-left); background: var(--dc-canvas); }
    .sf__prg span { flex: 1; height: 3px; border-radius: 2px; background: var(--dc-hairline-strong); transition: background .2s ease; }
    .sf__prg span.on { background: var(--dc-green); }

    /* --- body ----------------------------------------------------------- */
    .sf__title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .sf__title-row .bk-title {
      margin: 0;
      flex: 1 1 auto;
      min-width: 0;
      word-break: break-word;
    }
    .sf__body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 16px var(--dc-safe-right) 16px var(--dc-safe-left);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .sf__body > * {
      flex-shrink: 0;
    }

    /* --- dock ----------------------------------------------------------- */
    .sf__dock {
      flex: none;
      padding: 11px var(--dc-safe-right) calc(var(--dc-safe-bottom)) var(--dc-safe-left);
      background: var(--dc-surface);
      box-shadow: 0 -2px 10px rgba(13, 27, 42, 0.04);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .sf__cta {
      min-height: 48px;
      border: 0;
      border-radius: var(--dc-r-md);
      background: var(--dc-green);
      color: #fff;
      font-size: 15px;
      font-weight: 750;
      box-shadow: 0 6px 16px rgba(18, 179, 91, 0.28);
    }
    /* Disabled stays readable — greyed, not faded to a ghost. */
    .sf__cta[disabled] { background: var(--dc-hairline-strong); color: var(--dc-ink-faint); box-shadow: none; }
    .sf__cta--ghost { background: var(--dc-surface); color: var(--dc-ink-soft); border: 1px solid var(--dc-hairline-strong); box-shadow: none; }
    .sf__cta--danger { background: var(--dc-danger); box-shadow: 0 6px 16px rgba(220, 53, 69, 0.24); }
    .sf__back ion-icon { font-size: 21px; }
    .sf__caption, .sf__hint { margin: 0; color: var(--dc-ink-soft); font-size: 11px; font-weight: 400; line-height: 1.5; }
    .sf__hint { text-align: center; }
    .sf__actions { display: grid; }
    .sf__actions--pair { grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
    .sf__secondary { min-height: 48px; padding: 10px 14px; border: 1px solid #f1c8c8; border-radius: 12px; color: #b42318; background: #fff; font-size: 13px; font-weight: 700; }
    .sf__secondary:disabled { opacity: .5; }
    @media (max-width: 350px) { .sf__actions--pair { gap: 7px; } .sf__actions--pair .sf__cta { font-size: 12px; padding: 8px; } .sf__secondary { padding: 8px; font-size: 12px; } }
    .sf--reference { max-width: 620px; margin: 0 auto; }
    .sf--reference .sf__bar { padding-top: max(12px, env(safe-area-inset-top)); box-shadow: none; background: var(--dc-canvas); }
    .sf--reference .sf__back { background: #fff; box-shadow: 0 2px 5px #1018280a; }
    .sf--reference .sf__trip--label { line-height: 1.4; overflow-wrap: anywhere; }
    .sf--reference .sf__step { font-size: 11px; }
    .sf--reference .sf__body { scrollbar-width: none; padding-top: 6px; gap: 12px; }
    .sf--reference .sf__body::-webkit-scrollbar { display: none; }
    .sf--reference .bk-title { font-size: 20px; }
    .sf--reference .sf__dock { box-shadow: none; border-top: 1px solid var(--dc-hairline); padding-bottom: max(16px, env(safe-area-inset-bottom)); }
    .sf--reference .sf__cta { box-shadow: none; border-radius: 12px; }
    .sf__map { flex: 1 1 auto; min-height: 140px; position: relative; overflow: hidden; }
    .sf--map-layout { position: relative; }
    .sf--map-layout .sf__map { position: absolute; inset: 0; min-height: 0; }
    .sf--map-layout .sf__body { flex: 0 1 auto; max-height: 42%; margin: auto 12px 0; padding: 12px; background: var(--dc-canvas); border-radius: 18px; box-shadow: 0 3px 18px #14223716; z-index: 1; }
    .sf--map-layout .sf__dock { position: relative; z-index: 1; margin: 10px 12px max(32px, env(safe-area-inset-bottom)); padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
    .sf__actions--search { grid-template-columns: minmax(0, 8fr) minmax(0, 2fr); gap: 8px; align-items: stretch; }
    .sf__body[hidden] { display: none; }
    .sf--map-layout.sf--body-hidden .sf__dock { margin-top: auto; }
    .sf--inline-search .sf__cta { min-width: 0; padding: 8px; font-size: 12px; line-height: 1.3; overflow-wrap: anywhere; }
    .sf--inline-search .sf__cta--select { display: flex; align-items: center; justify-content: center; gap: 5px; background: #fff; color: var(--dc-green); border: 0; box-shadow: none; cursor: pointer; }
    .sf__cta--select ion-icon { flex: none; font-size: 16px; }
    .sf--inline-search .sf__cta:not(.sf__cta--select) { display: flex; align-items: center; justify-content: center; gap: 6px; }
    button:focus-visible { outline: 2px solid var(--dc-green); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .sf__prg span { transition: none; } }
  `],
})
export class StepShellComponent {
  @Input() reference = false;
  @Input() compactTitle = false;
  @Input() titleInHeader = false;
  @Input() mapLayout = false;
  @Input() mapHeader = false;
  @Input() inlineSearch = false;
  @Input() selectAction = false;
  @Input() selectExpanded = false;
  @Input() actionArrow = false;
  @Input() hideBody = false;
  @Input() fareLabel = '';
  @Input() dockHint = '';
  @Input() secondaryLabel = '';
  @Input() secondaryDisabled = false;
  @Output() secondary = new EventEmitter<void>();
  /** Left-aligned title for this step. */
  @Input() title = '';
  @Input() subtitle = '';

  /** Trip context in the bar. If both are empty, `barLabel` shows instead. */
  @Input() from = '';
  @Input() to = '';
  /** Shown in the bar when there is no trip yet (e.g. a result screen). */
  @Input() barLabel = '';

  /** Which step this is, and how many there are. `step` is 1-based. */
  @Input() step = 0;
  @Input() total = 0;

  /** Primary button. Empty hides the whole dock unless dock-extra is used. */
  @Input() cta = '';
  @Input() disabled = false;
  @Input() ghost = false;
  @Input() danger = false;
  @Input() hasDock = false;

  @Output() back = new EventEmitter<void>();
  @Output() primary = new EventEmitter<void>();

  get segments(): number[] {
    return Array.from({ length: Math.max(0, this.total) });
  }

  get stepLabel(): string {
    if (this.total <= 0) return '';
    if (this.step > this.total) return '✓';
    return `${this.step}/${this.total}`;
  }

  /** "Iqbal Market, Sopore, J&K" → "Iqbal Market" — the part a rider knows. */
  shorten(address: string): string {
    if (!address) return '';
    return address.split(',')[0].trim() || address;
  }
}

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ICONS, IconName } from './icon-registry';

/**
 * Inline SVG icon renderer.
 *
 *   <tm-icon name="home" />
 *   <tm-icon name="bell" size="20" />
 *
 * Glyph color = `currentColor`, so the icon inherits whatever color the
 * surrounding element uses (the icon-tile glyph is white because the tile
 * sets `color: #fff`).
 */
@Component({
  selector: 'tm-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.aria-hidden]="label ? null : 'true'"
      [attr.aria-label]="label"
      [attr.role]="label ? 'img' : null"
      [innerHTML]="paths"
    ></svg>
  `,
  styles: [`
    :host { display: inline-flex; line-height: 0; }
    svg { display: block; }
  `],
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  @Input() size: number | string = 18;
  /** Optional a11y label. If omitted, the icon is decorative. */
  @Input() label?: string;

  get paths(): SafeHtml {
    const raw = ICONS[this.name] || '';
    return this.sanitizer.bypassSecurityTrustHtml(raw);
  }

  constructor(private sanitizer: DomSanitizer) {}
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  HostListener,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

/**
 * Drag-and-drop file picker.
 *
 *   <tm-file-drop
 *     accept="image/*,application/pdf"
 *     [multiple]="true"
 *     [maxSizeMb]="10"
 *     (filesAdded)="onFiles($event)"
 *   />
 *
 * The component itself does NOT manage upload state — it just collects files
 * and emits them. The host decides what to do with them (queue, validate
 * server-side, upload, etc.). Files exceeding `maxSizeMb` are filtered out
 * and reported via the `(rejected)` event with a reason string per file.
 */
@Component({
  selector: 'tm-file-drop',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <button
      type="button"
      class="zone"
      [class.is-over]="isOver"
      [class.is-disabled]="disabled"
      [disabled]="disabled"
      (click)="picker.click()"
      (dragenter)="onDragEnter($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <span class="zone__icon" aria-hidden="true">
        <tm-icon name="upload" [size]="22" />
      </span>
      <span class="zone__title">{{ title }}</span>
      <span class="zone__hint">{{ hint }}</span>
      <input
        #picker
        type="file"
        class="zone__input"
        [accept]="accept || null"
        [multiple]="multiple"
        [disabled]="disabled"
        (change)="onPicked($event)"
      />
    </button>
  `,
  styles: [`
    :host { display: block; }

    .zone {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: var(--tm-space-5) var(--tm-space-4);
      background: var(--tm-canvas);
      border: 1.5px dashed var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      cursor: pointer;
      text-align: center;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .zone:hover:not(:disabled) {
      border-color: var(--tm-ink);
      background: var(--tm-surface);
    }
    .zone.is-over {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
      border-style: solid;
    }
    .zone.is-disabled,
    .zone:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .zone__icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      display: grid;
      place-items: center;
    }
    .zone.is-over .zone__icon {
      background: var(--tm-green);
      color: #fff;
    }
    .zone__title {
      font-size: 14px;
      font-weight: 700;
      color: var(--tm-text);
    }
    .zone__hint {
      font-size: 12px;
      color: var(--tm-text-muted);
    }
    .zone__input { display: none; }
  `],
})
export class FileDropComponent {
  @Input() accept = '';
  @Input() multiple = true;
  /** Files larger than this in megabytes are filtered out. 0 disables the limit. */
  @Input() maxSizeMb = 10;
  @Input() disabled = false;
  @Input() title = 'Drop files here, or click to browse';
  @Input() hint = 'Images or PDFs up to 10 MB each';

  @Output() filesAdded = new EventEmitter<File[]>();
  @Output() rejected = new EventEmitter<{ file: File; reason: string }[]>();

  @ViewChild('picker', { static: true }) picker!: ElementRef<HTMLInputElement>;

  isOver = false;

  /**
   * Without `pointer-events` shielding on inner spans, dragenter/leave fire
   * once per crossing of child elements. Counting nesting lets us only flip
   * `isOver` on the outermost transitions.
   */
  private dragDepth = 0;

  @HostBinding('attr.role') role = 'button';

  // The host attaches dragover/drop handlers so files dropped *on the host*
  // (not necessarily the inner zone) still work. The inner button forwards.

  onDragEnter(e: DragEvent): void {
    if (this.disabled) return;
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth++;
    this.isOver = true;
  }

  onDragOver(e: DragEvent): void {
    if (this.disabled) return;
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  onDragLeave(e: DragEvent): void {
    if (this.disabled) return;
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.isOver = false;
  }

  onDrop(e: DragEvent): void {
    if (this.disabled) return;
    e.preventDefault();
    this.dragDepth = 0;
    this.isOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    this.accept_(files);
  }

  onPicked(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    this.accept_(files);
    // Reset so the same file can be picked again after removal.
    input.value = '';
  }

  private accept_(files: File[]): void {
    if (!files.length) return;
    const accepted: File[] = [];
    const rejected: { file: File; reason: string }[] = [];
    const maxBytes = this.maxSizeMb > 0 ? this.maxSizeMb * 1024 * 1024 : Infinity;

    for (const f of files) {
      if (!this.matchesAccept(f)) {
        rejected.push({ file: f, reason: 'unsupported type' });
        continue;
      }
      if (f.size > maxBytes) {
        rejected.push({ file: f, reason: `exceeds ${this.maxSizeMb} MB` });
        continue;
      }
      accepted.push(f);
    }
    // Cap to a single file when multiple is false.
    const final = this.multiple ? accepted : accepted.slice(0, 1);
    if (final.length) this.filesAdded.emit(final);
    if (rejected.length) this.rejected.emit(rejected);
  }

  private hasFiles(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    // Browsers report 'Files' in dataTransfer.types when a file is being dragged.
    return Array.from(types).indexOf('Files') !== -1;
  }

  private matchesAccept(file: File): boolean {
    if (!this.accept) return true;
    const patterns = this.accept.split(',').map((s) => s.trim().toLowerCase());
    const mime = (file.type || '').toLowerCase();
    const name = file.name.toLowerCase();
    return patterns.some((p) => {
      if (!p) return false;
      if (p.startsWith('.')) return name.endsWith(p);
      if (p.endsWith('/*')) return mime.startsWith(p.slice(0, -1));
      return mime === p;
    });
  }
}

import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-registry';

/**
 *   <tm-input placeholder="Search trips..." icon="search" [(ngModel)]="q" />
 *   <tm-input label="Email" type="email" [(ngModel)]="email" />
 *
 * Works as a `ControlValueAccessor` so it plugs into Angular forms.
 */
@Component({
  selector: 'tm-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, IconComponent],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => InputComponent), multi: true },
  ],
  template: `
    <label *ngIf="label" class="tm-overline label">{{ label }}</label>
    <div class="field" [class.has-error]="!!error" [class.disabled]="disabled">
      <tm-icon *ngIf="icon" [name]="icon" [size]="16" />
      <input
        [type]="type"
        [placeholder]="placeholder"
        [disabled]="disabled"
        [value]="value ?? ''"
        (input)="onInput($event)"
        (blur)="onTouched()"
      />
      <tm-icon *ngIf="iconTrail" [name]="iconTrail" [size]="16" class="trail" />
    </div>
    <small *ngIf="hint && !error" class="hint">{{ hint }}</small>
    <small *ngIf="error" class="err">{{ error }}</small>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 6px; }
    .label { color: var(--tm-text-muted); }

    .field {
      display: flex; align-items: center; gap: 10px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      padding: 11px 14px;
      border-radius: var(--tm-radius-md);
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  box-shadow var(--tm-duration-fast) var(--tm-ease);
      color: var(--tm-text-soft);
    }
    .field:hover:not(.disabled) { border-color: var(--tm-text-soft); }
    .field:focus-within {
      border-color: var(--tm-ink);
      box-shadow: 0 0 0 4px rgba(15,20,25,0.06);
      color: var(--tm-text-muted);
    }
    .field.has-error { border-color: var(--tm-danger); }
    .field.has-error:focus-within { box-shadow: 0 0 0 4px rgba(239,68,68,0.12); }
    .field.disabled { background: var(--tm-canvas-2); cursor: not-allowed; }

    input {
      border: none; outline: none; background: transparent;
      flex: 1; font: inherit; min-width: 0;
      color: var(--tm-text);
    }
    input::placeholder { color: var(--tm-text-soft); }
    input:disabled { cursor: not-allowed; }

    .trail { color: var(--tm-text-soft); }

    .hint { color: var(--tm-text-muted); font-size: 12px; }
    .err  { color: var(--tm-danger);     font-size: 12px; font-weight: 600; }
  `],
})
export class InputComponent implements ControlValueAccessor {
  @Input() label?: string;
  @Input() placeholder = '';
  @Input() type: 'text' | 'email' | 'password' | 'number' | 'tel' | 'search' = 'text';
  @Input() icon?: IconName;
  @Input() iconTrail?: IconName;
  @Input() hint?: string;
  @Input() error?: string | null;
  @Input() disabled = false;

  @Output() valueChange = new EventEmitter<string>();

  value: string | null = '';

  private _onChange: (val: string) => void = () => {};
  onTouched: () => void = () => {};

  writeValue(value: string | null): void { this.value = value ?? ''; }
  registerOnChange(fn: (val: string) => void): void { this._onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(isDisabled: boolean): void { this.disabled = isDisabled; }

  onInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this.value = v;
    this._onChange(v);
    this.valueChange.emit(v);
  }
}

import { ChangeDetectionStrategy, Component, ContentChild, Input, TemplateRef } from '@angular/core';

export type ColumnAlign = 'left' | 'right' | 'center';

/**
 * Declares a column for `<tm-data-table>`.
 *
 *   <tm-column key="name" label="User Name" />
 *
 * Custom cell rendering via a child `<ng-template>` that receives the row
 * as `$implicit` and the column as `col`:
 *
 *   <tm-column key="id" label="ID" width="100">
 *     <ng-template let-row>
 *       <a [routerLink]="['/customers', row.id]">#{{ row.id }}</a>
 *     </ng-template>
 *   </tm-column>
 *
 * The component renders nothing on its own — the parent table queries it via
 * `@ContentChildren` and lays out its own cells using the column metadata
 * and template.
 */
@Component({
  selector: 'tm-column',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class ColumnComponent {
  /** Key used as default cell accessor (row[key]) and for tracking. */
  @Input({ required: true }) key!: string;
  /** Column header label. */
  @Input({ required: true }) label!: string;
  /** Fixed width, e.g. "120px" or "10rem". */
  @Input() width?: string;
  /** Horizontal alignment for both header and cell. */
  @Input() align: ColumnAlign = 'left';
  /** Hide on viewports below this px width. */
  @Input() hideBelow?: number;
  /** Allow column cell text to wrap. Default truncates with ellipsis. */
  @Input() wrap = false;

  @ContentChild(TemplateRef) template?: TemplateRef<{ $implicit: any; col: ColumnComponent; index: number }>;
}

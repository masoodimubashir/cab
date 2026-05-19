import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Chart,
  ChartConfiguration,
  ChartType,
  registerables,
} from 'chart.js';

Chart.register(...registerables);

/**
 * Thin Chart.js wrapper. Pass `[type]` and `[config]` (the `data` + `options`
 * payload Chart.js expects), and we'll mount / re-mount the chart inside a
 * canvas. Use `[type]` for the chart type ('bar', 'doughnut', 'line', ...).
 *
 * The host component owns the data — when `config` changes we rebuild from
 * scratch. That's simpler than diffing datasets and is plenty fast for the
 * dashboard-scale charts we render here.
 */
@Component({
  selector: 'tm-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="tm-chart" [style.height.px]="height">
      <canvas #canvas></canvas>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; }
    .tm-chart { position: relative; width: 100%; }
    canvas { display: block; max-width: 100%; }
  `],
})
export class ChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;

  @Input() type: ChartType = 'bar';
  @Input() config: Omit<ChartConfiguration, 'type'> = { data: { datasets: [] } };
  @Input() height = 280;

  private chart: Chart | null = null;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.canvas) return; // before view init — render() runs from AfterViewInit
    if (changes['type'] || changes['config']) this.render();
  }

  ngOnDestroy(): void {
    this.destroy();
  }

  private render(): void {
    this.destroy();
    // Chart.js drives its own animation frame loop. Running it outside Angular
    // avoids triggering change detection on every frame.
    this.zone.runOutsideAngular(() => {
      this.chart = new Chart(this.canvas.nativeElement, {
        type: this.type,
        ...this.config,
      } as ChartConfiguration);
    });
  }

  private destroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}

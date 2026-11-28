import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CityOption } from '../../core/city-context.service';

@Component({
  selector: 'app-vehicle-cities',
  standalone: true,
  imports: [CommonModule],
  template: `
    <fieldset [disabled]="disabled">
      <legend>Save in</legend>
      <div class="cities">
        <span class="current">{{ current || 'Current city' }} <small *ngIf="current">Current city</small></span>
        <span *ngFor="let city of chosenCities" class="chosen city-tag">{{ city.name }}</span>
        <button *ngIf="canChoose || cities.length" type="button" [attr.aria-expanded]="expanded" (click)="toggleList()">{{ expanded ? 'Done choosing' : selected.length ? 'Change cities' : 'Choose other cities' }}</button>
      </div>
      <div class="cities options" *ngIf="expanded">
        <label *ngFor="let city of cities" [class.chosen]="selected.includes(city.id)">
          <input type="checkbox" [checked]="selected.includes(city.id)" (change)="toggle(city.id)"> {{ city.name }}
        </label>
      </div>
    </fieldset>`,
  styles: [`
    fieldset { margin: 16px 0 0; padding: 0; border: 0; min-width: 0; }
    legend { padding: 0; margin-bottom: 8px; font-weight: 650; }
    .cities { display: flex; flex-wrap: wrap; gap: 8px; }
    label, .current, .city-tag { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--tm-line); padding: 7px 10px; border-radius: 8px; }
    button { color: #155d3a; background: transparent; border: 0; font: inherit; text-decoration: underline; cursor: pointer; }
    .options { margin-top: 10px; }
    label { cursor: pointer; } small { font-size: 11px; }
    .current, .chosen { background: #eef8f3; color: #155d3a; border-color: #a6d5ba; }
    input { accent-color: #157145; margin: 0; }
  `],
})
export class VehicleCitiesComponent {
  @Input() current = '';
  @Input() cities: CityOption[] = [];
  @Input() selected: number[] = [];
  @Input() disabled = false;
  @Input() canChoose = false;
  @Output() opened = new EventEmitter<void>();
  @Output() selectedChange = new EventEmitter<number[]>();
  expanded = false;
  get chosenCities(): CityOption[] { return this.cities.filter(city => this.selected.includes(city.id)); }

  toggleList(): void {
    this.expanded = !this.expanded;
    if (this.expanded) this.opened.emit();
  }

  toggle(id: number): void {
    this.selectedChange.emit(this.selected.includes(id) ? this.selected.filter(city => city !== id) : [...this.selected, id]);
  }
}

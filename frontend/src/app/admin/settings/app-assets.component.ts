import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent, ModalComponent, StatusPillComponent } from '../../ui';

type Platform = 'android' | 'ios';
type PlatformChoice = Platform | 'both';

interface VehicleRow {
  id: number;
  display_name: string;
  vehicle_type_name?: string | null;
  ride_type_name?: string | null;
  is_active: boolean;
}

interface VehicleAsset {
  id: number;
  city_id: number;
  display_name: string;
  platform: Platform;
  key: string;
  image_path: string | null;
  image_url: string | null;
}

interface VehicleFamily {
  key: string;
  display_name: string;
  members: VehicleRow[];
}

interface FamilyAsset {
  id: number;
  city_id: number;
  display_name: string;
  platform: Platform;
  key: string;
  image_path: string | null;
  image_url: string | null;
}

const ASSET_KEYS = [
  { value: 'map_marker', label: 'Map marker' },
  { value: 'selected_map_marker', label: 'Selected map marker' },
  { value: 'driver_map_marker', label: 'Driver map marker' },
  { value: 'booking_card', label: 'Booking card image' },
];

@Component({
  selector: 'app-app-assets',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent, ModalComponent, StatusPillComponent],
  template: `
    <div class="page">
      <header class="hero">
        <div>
          <h1>App Assets</h1>
          <p>Manage vehicle images used by mobile apps, including map markers per Android and iOS.</p>
        </div>
        <tm-button *ngIf="selectedFamily" variant="green" icon="plus" (clicked)="openCreate()">Add asset</tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <strong>No city selected</strong>
        <span>Pick a city from the top bar to manage app assets.</span>
      </div>

      <ng-container *ngIf="cityId != null">
        <section class="layout">
          <aside class="vehicles">
            <div class="search">
              <tm-icon name="search" [size]="14" />
              <input [(ngModel)]="search" placeholder="Search vehicles" />
            </div>

            <button
              *ngFor="let v of filteredFamilies"
              type="button"
              class="vehicle"
              [class.is-active]="selectedFamily?.key === v.key"
              (click)="selectFamily(v)"
            >
              <span class="vehicle__icon"><tm-icon name="car" [size]="15" /></span>
              <span class="vehicle__text">
                <strong>{{ v.display_name }}</strong>
                <small>{{ familySummary(v) }}</small>
              </span>
              <tm-status-pill [tone]="familyStatusTone(v)">{{ familyIsActive(v) ? 'On' : 'Off' }}</tm-status-pill>
            </button>
          </aside>

          <main class="assets">
            <div class="empty" *ngIf="!selectedFamily">
              <tm-icon name="upload" [size]="24" />
              <strong>Select a vehicle family</strong>
              <span>Choose a city vehicle family to manage its Android and iOS app assets.</span>
            </div>

            <ng-container *ngIf="selectedFamily">
              <header class="assets__head">
                <div>
                  <h2>{{ selectedFamily.display_name }}</h2>
                  <p>{{ familySummary(selectedFamily) }}</p>
                </div>
                <tm-button variant="outline" size="sm" icon="refresh" [disabled]="loadingAssets" (clicked)="loadAssets()">Refresh</tm-button>
              </header>

              <div class="assetGrid" *ngIf="!loadingAssets">
                <section class="platform" *ngFor="let platform of platforms">
                  <header class="platform__head">
                    <span>{{ platform.label }}</span>
                    <small>{{ assetsFor(platform.value).length }} assets</small>
                  </header>

                  <div class="empty empty--small" *ngIf="!assetsFor(platform.value).length">
                    <tm-icon name="upload" [size]="18" />
                    <span>No {{ platform.label }} assets yet.</span>
                  </div>

                  <article class="asset" *ngFor="let asset of assetsFor(platform.value)">
                    <div class="asset__media">
                      <img *ngIf="asset.image_url" [src]="asset.image_url" />
                      <tm-icon *ngIf="!asset.image_url" name="upload" [size]="20" />
                    </div>
                    <div class="asset__meta">
                      <strong>{{ labelForKey(asset.key) }}</strong>
                      <small>{{ asset.key }}</small>
                    </div>
                    <div class="asset__actions">
                      <button type="button" class="iconBtn" title="Replace" (click)="openReplace(asset)">
                        <tm-icon name="edit" [size]="13" />
                      </button>
                      <button type="button" class="iconBtn iconBtn--danger" title="Delete" (click)="assetToDelete = asset">
                        <tm-icon name="trash" [size]="13" />
                      </button>
                    </div>
                  </article>
                </section>
              </div>

              <div class="cue cue--inline" *ngIf="loadingAssets">
                <tm-icon name="refresh" [size]="20" />
                <span>Loading assets...</span>
              </div>
            </ng-container>
          </main>
        </section>
      </ng-container>
    </div>

    <tm-modal [open]="assetOpen" [title]="assetMode === 'replace' ? 'Replace asset' : 'Add asset'" (closed)="closeAssetModal()">
      <div slot="body" class="form">
        <label class="field">
          <span>Platform</span>
          <select [(ngModel)]="assetForm.platform" [disabled]="assetMode === 'replace'">
            <option value="android">Android</option>
            <option value="ios">iOS</option>
            <option value="both">Both</option>
          </select>
        </label>

        <label class="field">
          <span>Usage</span>
          <select [(ngModel)]="assetForm.key" [disabled]="assetMode === 'replace'">
            <option *ngFor="let key of assetKeys" [value]="key.value">{{ key.label }}</option>
            <option value="custom">Custom key</option>
          </select>
        </label>

        <label class="field" *ngIf="assetForm.key === 'custom'">
          <span>Custom key</span>
          <input [(ngModel)]="assetForm.customKey" placeholder="e.g. airport_map_marker" [disabled]="assetMode === 'replace'" />
        </label>

        <label class="field">
          <span>Image</span>
          <input type="file" accept="image/*" (change)="onFile($event)" />
        </label>

        <img *ngIf="assetForm.previewUrl" [src]="assetForm.previewUrl" class="preview" />
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="closeAssetModal()">Cancel</tm-button>
        <tm-button variant="green" [disabled]="savingAsset" (clicked)="saveAsset()">
          {{ savingAsset ? 'Saving...' : 'Save' }}
        </tm-button>
      </div>
    </tm-modal>

    <tm-modal [open]="!!assetToDelete" title="Delete asset" (closed)="assetToDelete = null">
      <div slot="body">
        <p>Delete <strong>{{ assetToDelete?.key }}</strong> for {{ assetToDelete?.platform }}?</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="assetToDelete = null">Cancel</tm-button>
        <tm-button variant="danger" (clicked)="deleteAsset()">Delete</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .hero h1 { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .hero p { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }
    .layout { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
    .vehicles, .assets { background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: 14px; overflow: hidden; }
    .vehicles { padding: 12px; display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 160px); overflow-y: auto; }
    .search { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 10px; border: 1px solid var(--tm-line); border-radius: 10px; color: var(--tm-text-muted); background: var(--tm-canvas); }
    .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--tm-text); font: inherit; font-size: 13px; }
    .vehicle { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .vehicle:hover, .vehicle.is-active { background: var(--tm-canvas); border-color: var(--tm-line); }
    .vehicle.is-active { border-color: var(--tm-green); }
    .vehicle__icon { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); flex: none; }
    .vehicle__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .vehicle__text strong { font-size: 13px; color: var(--tm-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .vehicle__text small { font-size: 11px; color: var(--tm-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .assets { min-height: 520px; }
    .assets__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--tm-line); }
    .assets__head h2 { margin: 0; font-size: 16px; color: var(--tm-text); }
    .assets__head p { margin: 2px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .assetGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 14px; }
    .platform { border: 1px solid var(--tm-line); border-radius: 12px; overflow: hidden; background: var(--tm-canvas); }
    .platform__head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 11px 12px; border-bottom: 1px solid var(--tm-line); }
    .platform__head span { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .platform__head small { font-size: 11px; color: var(--tm-text-muted); font-weight: 700; }
    .asset { display: grid; grid-template-columns: 74px 1fr auto; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--tm-line); }
    .asset:last-child { border-bottom: 0; }
    .asset__media { width: 74px; height: 54px; border: 1px solid var(--tm-line); border-radius: 9px; display: flex; align-items: center; justify-content: center; background: var(--tm-surface); color: var(--tm-text-muted); overflow: hidden; }
    .asset__media img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .asset__meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .asset__meta strong { font-size: 13px; color: var(--tm-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .asset__meta small { font-size: 11px; color: var(--tm-text-muted); font-family: var(--tm-font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .asset__actions { display: inline-flex; gap: 6px; }
    .iconBtn { width: 28px; height: 28px; border: 0; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--tm-text-muted); background: var(--tm-surface); }
    .iconBtn:hover { background: var(--tm-ink); color: #fff; }
    .iconBtn--danger:hover { background: var(--tm-danger, #ef4444); }
    .cue, .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; min-height: 220px; padding: 30px; text-align: center; color: var(--tm-text-muted); }
    .cue { background: var(--tm-surface); border: 1px dashed var(--tm-line); border-radius: 14px; }
    .cue strong, .empty strong { color: var(--tm-text); font-size: 14px; }
    .cue--inline { min-height: 180px; border: 0; background: transparent; }
    .empty--small { min-height: 150px; padding: 20px; font-size: 12px; }
    .form { display: flex; flex-direction: column; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field span { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field input, .field select { width: 100%; height: 38px; padding: 0 10px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text); font: inherit; font-size: 13px; outline: none; }
    .field input[type="file"] { height: auto; padding: 9px 10px; }
    .preview { max-width: 100%; max-height: 170px; object-fit: contain; border: 1px solid var(--tm-line); border-radius: 10px; background: var(--tm-canvas); }
    @media (max-width: 1000px) { .layout, .assetGrid { grid-template-columns: 1fr; } .vehicles { max-height: none; } }
  `],
})
export class AppAssetsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  vehicles: VehicleRow[] = [];
  families: VehicleFamily[] = [];
  selectedFamily: VehicleFamily | null = null;
  assets: FamilyAsset[] = [];
  search = '';
  loadingVehicles = false;
  loadingAssets = false;
  savingAsset = false;
  assetOpen = false;
  assetMode: 'create' | 'replace' = 'create';
  replacingAsset: FamilyAsset | null = null;
  assetToDelete: FamilyAsset | null = null;
  assetForm = this.blankAssetForm();
  readonly platforms = [{ label: 'Android', value: 'android' as const }, { label: 'iOS', value: 'ios' as const }];
  readonly assetKeys = ASSET_KEYS;
  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.selectedFamily = null;
        this.assets = [];
        this.loadVehicles();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  get filteredFamilies(): VehicleFamily[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.families;
    return this.families.filter((family) => {
      const hay = `${family.display_name} ${this.familySummary(family)} ${family.members.map((m) => m.display_name).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }

  loadVehicles(): void {
    if (this.cityId == null) {
      this.vehicles = [];
      return;
    }
    this.loadingVehicles = true;
    this.api.get<{ data: VehicleRow[] }>(`/admin/cities/${this.cityId}/vehicle-types`).subscribe({
      next: (res) => {
        this.loadingVehicles = false;
        this.vehicles = res.data ?? [];
        this.families = this.groupVehicles(this.vehicles);
        this.selectedFamily = this.families[0] ?? null;
        if (this.selectedFamily) this.loadAssets();
      },
      error: () => {
        this.loadingVehicles = false;
        this.vehicles = [];
        this.toast.error('Failed to load vehicles');
      },
    });
  }

  selectFamily(family: VehicleFamily): void {
    this.selectedFamily = family;
    this.loadAssets();
  }

  loadAssets(): void {
    if (this.cityId == null || !this.selectedFamily) {
      this.assets = [];
      return;
    }

    const member = this.selectedFamily.members[0];
    if (!member) {
      this.assets = [];
      return;
    }

    this.loadingAssets = true;
    this.api.get<{ data: VehicleAsset[] }>(`/admin/cities/${this.cityId}/vehicle-types/${member.id}/images`).subscribe({
      next: (res) => {
        this.loadingAssets = false;
        this.assets = (res.data ?? []) as FamilyAsset[];
      },
      error: () => {
        this.loadingAssets = false;
        this.assets = [];
        this.toast.error('Failed to load app assets');
      },
    });
  }

  assetsFor(platform: Platform): FamilyAsset[] {
    return this.assets.filter((a) => a.platform === platform);
  }

  labelForKey(key: string): string {
    return ASSET_KEYS.find((x) => x.value === key)?.label ?? key.replace(/_/g, ' ');
  }

  openCreate(): void {
    this.assetMode = 'create';
    this.replacingAsset = null;
    this.assetForm = this.blankAssetForm();
    this.assetOpen = true;
  }

  openReplace(asset: FamilyAsset): void {
    this.assetMode = 'replace';
    this.replacingAsset = asset;
    this.assetForm = {
      platform: asset.platform,
      key: ASSET_KEYS.some((x) => x.value === asset.key) ? asset.key : 'custom',
      customKey: asset.key,
      file: null,
      previewUrl: asset.image_url,
    };
    this.assetOpen = true;
  }

  closeAssetModal(): void {
    this.assetOpen = false;
    this.savingAsset = false;
  }

  onFile(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0] ?? null;
    this.assetForm.file = file;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => (this.assetForm.previewUrl = reader.result as string);
    reader.readAsDataURL(file);
  }

  saveAsset(): void {
    if (this.cityId == null || !this.selectedFamily || this.savingAsset) return;
    const key = this.normalizedKey();
    if (!key) {
      this.toast.error('Asset key is required');
      return;
    }
    if (!this.assetForm.file) {
      this.toast.error('Pick an image');
      return;
    }

    const member = this.selectedFamily.members[0];
    if (!member) {
      this.toast.error('Select a vehicle family');
      return;
    }

    this.savingAsset = true;
    const platforms: Platform[] = this.assetForm.platform === 'both' ? ['android', 'ios'] : [this.assetForm.platform as Platform];
    const requests = platforms.map((platform) => {
      const fd = new FormData();
      fd.append('platform', platform);
      fd.append('key', key);
      fd.append('image', this.assetForm.file as File);
      return this.api.postMultipart<{ image: VehicleAsset; message?: string }>(`/admin/cities/${this.cityId}/vehicle-types/${member.id}/images`, fd);
    });

    forkJoin(requests).subscribe({
      next: () => {
        this.savingAsset = false;
        this.assetOpen = false;
        this.toast.success('Asset saved for the whole family');
        this.loadAssets();
      },
      error: (err) => {
        this.savingAsset = false;
        this.toast.error(err?.error?.message || 'Failed to save asset');
      },
    });
  }

  deleteAsset(): void {
    if (this.cityId == null || !this.selectedFamily || !this.assetToDelete) return;
    const member = this.selectedFamily.members[0];
    if (!member) {
      this.toast.error('Select a vehicle family');
      return;
    }

    const asset = this.assetToDelete;
    this.api.delete(`/admin/cities/${this.cityId}/vehicle-types/${member.id}/images/${asset.id}`).subscribe({
      next: () => {
        this.assetToDelete = null;
        this.toast.success('Asset deleted from the whole family');
        this.loadAssets();
      },
      error: () => this.toast.error('Failed to delete asset'),
    });
  }


  familyIsActive(family: VehicleFamily): boolean {
    return family.members.some((m) => m.is_active);
  }

  familyStatusTone(family: VehicleFamily): 'success' | 'neutral' {
    return this.familyIsActive(family) ? 'success' : 'neutral';
  }

  familySummary(family: VehicleFamily): string {
    const labels = family.members
      .map((m) => (m.ride_type_name || m.vehicle_type_name || 'Vehicle type not set').trim())
      .filter((v, i, arr) => arr.indexOf(v) === i);
    return family.display_name + ' · ' + (labels.join(' · ') || 'Vehicle type not set') + ' · ' + family.members.length + ' row' + (family.members.length === 1 ? '' : 's');
  }

  private groupVehicles(rows: VehicleRow[]): VehicleFamily[] {
    const map = new Map<string, VehicleFamily>();
    rows.forEach((row) => {
      const key = row.display_name.trim().toLowerCase();
      const family = map.get(key) ?? { key, display_name: row.display_name.trim(), members: [] };
      family.members.push(row);
      map.set(key, family);
    });
    return [...map.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }

  private normalizedKey(): string {
    const raw = this.assetForm.key === 'custom' ? this.assetForm.customKey : this.assetForm.key;
    return raw.trim().toLowerCase().replace(/\s+/g, '_');
  }

  private blankAssetForm(): {
    platform: PlatformChoice;
    key: string;
    customKey: string;
    file: File | null;
    previewUrl: string | null;
  } {
    return { platform: 'both', key: 'map_marker', customKey: '', file: null, previewUrl: null };
  }
}

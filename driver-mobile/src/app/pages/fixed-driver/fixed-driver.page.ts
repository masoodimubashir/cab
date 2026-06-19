import { Component } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { interval, Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';

interface FixedRoute {
  id: number;
  name: string;
  scope: 'local' | 'outstation';
  origin_name: string;
  dest_name: string;
  flat_fare: number | null;
}

interface FixedVehicle {
  id: number;
  route_id: number;
  route_name: string;
  scope: string;
  capacity: number;
  seats_taken: number;
  seats_remaining: number;
  status: string;
  visible_to_customers: boolean;
}

interface FixedPassenger {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
  seats: number;
  status: string;
  payment_status: string | null;
  fare_amount: number | null;
  board: string | null;
  drop: string | null;
}

interface ManifestResponse {
  departure: FixedVehicle;
  passengers: FixedPassenger[];
}

@Component({
  selector: 'app-fixed-driver',
  templateUrl: './fixed-driver.page.html',
  styleUrls: ['./fixed-driver.page.scss'],
  standalone: false,
})
export class FixedDriverPage {
  loading = false;
  busy = false;
  error: string | null = null;
  message: string | null = null;

  routes: FixedRoute[] = [];
  vehicles: FixedVehicle[] = [];
  selectedRouteId: number | null = null;
  capacity = 4;

  activeVehicle: FixedVehicle | null = null;
  passengers: FixedPassenger[] = [];
  private manifestPoll?: Subscription;

  constructor(
    private api: ApiService,
    private alerts: AlertController,
    private toasts: ToastController
  ) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  ionViewWillLeave(): void {
    this.stopManifestPolling();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.message = null;
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending === 0) this.loading = false;
    };

    this.api.get<{ data: FixedRoute[] }>('/fixed/driver/routes').subscribe({
      next: (res) => {
        this.routes = res.data ?? [];
        if (!this.selectedRouteId && this.routes.length) this.selectedRouteId = this.routes[0].id;
      },
      error: (err) => this.error = err?.error?.message || 'Could not load fixed routes.',
      complete: done,
    });

    this.api.get<{ data: FixedVehicle[] }>('/fixed/driver/vehicles').subscribe({
      next: (res) => {
        this.vehicles = res.data ?? [];
        this.activeVehicle = this.pickActiveVehicle();
        if (this.activeVehicle) {
          this.loadManifest(this.activeVehicle.id, false);
          this.startManifestPolling();
        } else {
          this.stopManifestPolling();
        }
      },
      error: (err) => this.error = err?.error?.message || 'Could not load fixed vehicles.',
      complete: done,
    });
  }

  openVehicle(): void {
    if (!this.selectedRouteId) {
      this.error = 'Select a fixed route first.';
      return;
    }
    if (!this.capacity || this.capacity < 1) {
      this.error = 'Enter vehicle capacity.';
      return;
    }

    this.busy = true;
    this.error = null;
    this.api.post<{ vehicle: FixedVehicle; message: string }>('/fixed/driver/vehicles', {
      route_id: this.selectedRouteId,
      capacity: this.capacity,
    }).pipe(finalize(() => this.busy = false)).subscribe({
      next: (res) => {
        this.message = res.message || 'Fixed vehicle opened.';
        this.activeVehicle = res.vehicle;
        this.refresh();
      },
      error: (err) => this.error = err?.error?.message || 'Could not open fixed vehicle.',
    });
  }

  loadManifest(vehicleId: number, showSpinner = true): void {
    if (showSpinner) this.busy = true;
    this.api.get<ManifestResponse>(`/fixed/departures/${vehicleId}/manifest`)
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: (res) => {
          this.activeVehicle = res.departure;
          this.passengers = res.passengers ?? [];
        },
        error: (err) => this.error = err?.error?.message || 'Could not load passenger list.',
      });
  }

  async startRide(): Promise<void> {
    if (!this.activeVehicle) return;
    const alert = await this.alerts.create({
      header: 'Start fixed ride?',
      message: 'Customers can still book from upcoming stops while seats are available.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Start ride', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') return;

    this.busy = true;
    this.error = null;
    this.api.post<{ vehicle: FixedVehicle; message: string }>(`/fixed/departures/${this.activeVehicle.id}/start`, {})
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: async (res) => {
          this.activeVehicle = res.vehicle;
          await this.showToast(res.message || 'Fixed ride started.');
          this.refresh();
        },
        error: (err) => this.error = err?.error?.message || 'Could not start fixed ride.',
      });
  }

  async completeRide(): Promise<void> {
    if (!this.activeVehicle || !this.canComplete(this.activeVehicle)) return;
    const alert = await this.alerts.create({
      header: 'Complete fixed ride?',
      message: 'This closes the vehicle and stops new fixed bookings. All active passengers must already be dropped, cancelled or no-show.',
      buttons: [
        { text: 'Keep open', role: 'cancel' },
        { text: 'Complete ride', role: 'confirm' },
      ],
    });
    await alert.present();
    const result = await alert.onDidDismiss();
    if (result.role !== 'confirm') return;

    this.busy = true;
    this.error = null;
    this.api.post<{ vehicle: FixedVehicle; message: string }>("/fixed/departures/" + this.activeVehicle.id + "/complete", {})
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: async (res) => {
          this.activeVehicle = res.vehicle;
          this.stopManifestPolling();
          await this.showToast(res.message || 'Fixed ride completed.');
          this.refresh();
        },
        error: (err) => this.error = err?.error?.message || 'Could not complete fixed ride.',
      });
  }

  board(passenger: FixedPassenger): void {
    this.updatePassenger(passenger, 'board');
  }

  drop(passenger: FixedPassenger): void {
    this.updatePassenger(passenger, 'drop');
  }


  get groupedPassengers(): Array<{ stop: string; passengers: FixedPassenger[] }> {
    const groups = new Map<string, FixedPassenger[]>();
    for (const passenger of this.passengers) {
      const stop = passenger.board || 'Boarding point';
      groups.set(stop, [...(groups.get(stop) ?? []), passenger]);
    }
    return Array.from(groups.entries()).map(([stop, passengers]) => ({ stop, passengers }));
  }

  get selectedRoute(): FixedRoute | null {
    return this.routes.find((route) => route.id === Number(this.selectedRouteId)) ?? null;
  }

  canStart(vehicle: FixedVehicle | null): boolean {
    return !!vehicle && !['DEPARTED', 'COMPLETED', 'CANCELLED'].includes(vehicle.status);
  }

  canComplete(vehicle: FixedVehicle | null): boolean {
    return !!vehicle
      && !['COMPLETED', 'CANCELLED'].includes(vehicle.status)
      && !this.passengers.some((passenger) => ['BOOKED', 'CONFIRMED', 'BOARDED'].includes(passenger.status));
  }

  canBoardPassenger(passenger: FixedPassenger): boolean {
    return ['BOOKED', 'CONFIRMED'].includes(passenger.status);
  }

  canDropPassenger(passenger: FixedPassenger): boolean {
    return passenger.status === 'BOARDED';
  }

  private updatePassenger(passenger: FixedPassenger, action: 'board' | 'drop'): void {
    this.busy = true;
    this.error = null;
    this.api.post<{ message: string }>(`/fixed/bookings/${passenger.id}/${action}`, {})
      .pipe(finalize(() => this.busy = false))
      .subscribe({
        next: async (res) => {
          await this.showToast(res.message || 'Passenger updated.');
          if (this.activeVehicle) this.loadManifest(this.activeVehicle.id, false);
        },
        error: (err) => this.error = err?.error?.message || 'Could not update passenger.',
      });
  }


  private startManifestPolling(): void {
    this.stopManifestPolling();
    if (!this.activeVehicle || ["COMPLETED", "CANCELLED"].includes(this.activeVehicle.status)) return;

    this.manifestPoll = interval(8000).subscribe(() => {
      if (!this.activeVehicle || this.busy || this.loading) return;
      this.loadManifest(this.activeVehicle.id, false);
    });
  }

  private stopManifestPolling(): void {
    this.manifestPoll?.unsubscribe();
    this.manifestPoll = undefined;
  }

  private pickActiveVehicle(): FixedVehicle | null {
    return this.vehicles.find((vehicle) => ['FORMING', 'DISPATCHED'].includes(vehicle.status))
      ?? this.vehicles[0]
      ?? null;
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 1800, position: 'bottom' });
    await toast.present();
  }
}

// Visual review only: renders the actual booking page with sample data and no live API.
import { Component, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { of } from 'rxjs';
import { FixedBookPageModule } from '../src/app/pages/booking/fixed/fixed.module';
import { ApiService } from '../src/app/core/api.service';
import { AuthService } from '../src/app/core/auth.service';
import { BookingService } from '../src/app/pages/booking/booking.service';
import { GeolocationService } from '../src/app/core/geolocation.service';
import { FixedCustomerLocationService } from '../src/app/core/fixed-customer-location.service';
import { PaymentOptionsService } from '../src/app/core/payment-options.service';
import { RealtimeService } from '../src/app/core/realtime.service';
import { AudioAlertService } from '../src/app/core/audio-alert.service';

const routes = [
  { id: 1, name: 'Kralpora → Kupwara', scope: 'local', origin_name: 'Kralpora', dest_name: 'Kupwara', flat_fare: 40, distance_to_nearest_pickup: 85, nearest_pickup_stop: { name: 'Eidgah Jamia Masjid Trehgam', distance_meters: 85 }, stops: Array(13).fill({ name: 'Trehgam' }) },
  { id: 2, name: 'Regipora Link Road → Gushi', scope: 'local', origin_name: 'Regipora Link Road', dest_name: 'Gushi', flat_fare: 20, distance_to_nearest_pickup: 146, nearest_pickup_stop: { name: 'Trehgam', distance_meters: 146 }, stops: Array(12).fill({ name: 'Trehgam' }) },
  { id: 3, name: 'Kupwara → Srinagar', scope: 'outstation', origin_name: 'Kupwara', dest_name: 'Srinagar', flat_fare: 250, distance_to_nearest_pickup: 300, nearest_pickup_stop: { name: 'Kupwara Bus Stand', distance_meters: 300 }, stops: Array(8).fill({ name: 'Kupwara' }) },
];
@Component({ selector: 'app-root', standalone: false, template: '<ion-app><ion-router-outlet></ion-router-outlet></ion-app>' })
class PreviewRoot {}
@NgModule({
  declarations: [PreviewRoot],
  imports: [BrowserModule, IonicModule.forRoot(), RouterModule.forRoot([]), FixedBookPageModule],
  providers: [
    { provide: ApiService, useValue: { get: (path: string) => of(path.startsWith('/fixed/routes') ? { data: routes.filter(route => !path.includes('q=') || (route.name + ' Trehgam').toLowerCase().includes(new URLSearchParams(path.split('?')[1]).get('q')!.toLowerCase())) } : {}), post: () => of({}) } },
    { provide: BookingService, useValue: { trip: { cityId: 1 }, cities: async () => [{ id: 1, name: 'Kupwara' }], setCity: () => {} } },
    { provide: AuthService, useValue: { getUser: () => null } },
    { provide: GeolocationService, useValue: { getCurrentPosition: async () => ({ lat: 34.5, lng: 74.2 }) } },
    { provide: FixedCustomerLocationService, useValue: { fix$: of(null), start: async () => {}, stop: () => {} } },
    { provide: PaymentOptionsService, useValue: { load: async () => ({ cash_deposit_percent: 0 }) } },
    { provide: RealtimeService, useValue: {} },
    { provide: AudioAlertService, useValue: {} },
  ],
  bootstrap: [PreviewRoot],
})
class PreviewModule {}
platformBrowserDynamic().bootstrapModule(PreviewModule).catch(console.error);

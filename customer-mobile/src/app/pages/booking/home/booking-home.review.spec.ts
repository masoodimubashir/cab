import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { GeolocationService } from '../../../core/geolocation.service';
import { PlacesService } from '../../../core/places.service';
import { RealtimeService } from '../../../core/realtime.service';
import { BookingService } from '../booking.service';
import { BookingHomePage } from './booking-home.page';

describe('Booking Home location regressions', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [BookingHomePage], imports: [CommonModule], schemas: [NO_ERRORS_SCHEMA],
      providers: [ApiService, AuthService, GeolocationService, PlacesService, RealtimeService,
        BookingService, Router, AlertController].map(provide => ({ provide, useValue: {} })),
    }).compileComponents();
  });

  function fixture() {
    const fixture = TestBed.createComponent(BookingHomePage);
    spyOn(fixture.componentInstance, 'ngOnInit').and.stub();
    spyOn(fixture.componentInstance, 'ngOnDestroy').and.stub();
    return fixture;
  }

  it('keeps banner controls usable while location is loading', () => {
    const view = fixture();
    const page = view.componentInstance;
    page.locationFetching = true;
    page.halfBanner = { title: 'Test offer', image_url: '' } as any;
    view.detectChanges();
    const root = view.nativeElement as HTMLElement;
    expect(root.querySelector('.loc-loader-overlay')).toBeNull();
    const indicator = root.querySelector('.bh-location-status') as HTMLElement;
    expect(indicator).not.toBeNull();
    expect(getComputedStyle(indicator).pointerEvents).toBe('none');
    expect(indicator.getBoundingClientRect().height).toBeLessThan(100);
    expect(root.querySelector('ion-menu-button')).not.toBeNull();
    (root.querySelector('.dc-banner-close-btn') as HTMLButtonElement).click();
    expect(page.isHalfBannerCollapsed).toBeTrue();
    expect(page.locationFetching).toBeTrue();
  });

  for (const gps of [null, { lat: 34.02, lng: 74.02 }]) {
    it(gps ? 'uses GPS for the customer pin' : 'uses a city fallback only for the map view', async () => {
      const view = fixture();
      const page = view.componentInstance as any;
      page.booking = {
        cities: async () => [{ id: 1, name: 'City', center_lat: 34, center_lng: 74 }],
        catalog: async () => [], setCity: () => {}, setMode: () => {},
      };
      page.geo = { getCurrentPosition: async () => gps, getCurrentFix: async () => null };
      page.map = { setCenter: jasmine.createSpy('setCenter'), setZoom: jasmine.createSpy('setZoom') };
      const pin = spyOn(page, 'updateMapPosition').and.resolveTo();
      await page.loadLocationAndCatalog();
      expect(page.locationFetching).toBeFalse();
      if (gps) {
        expect(pin).toHaveBeenCalledWith(gps.lat, gps.lng, 40, true);
        expect(page.located).toBeTrue();
      } else {
        expect(pin).not.toHaveBeenCalled();
        expect(page.userMarker).toBeNull();
        expect(page.currentCoords).toBeNull();
        expect(page.map.setCenter).toHaveBeenCalledWith({ lat: 34, lng: 74 });
        expect(page.map.setZoom).toHaveBeenCalledWith(12);
        expect(page.located).toBeFalse();
      }
    });
  }
});

import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { CoreModule } from './core/core.module';
import { DevLocationBadgeComponent } from './core/dev-location-badge.component';
import { DevLocationModalComponent } from './core/dev-location-modal.component';
import { SharedModule } from './shared/shared.module';

@NgModule({
  declarations: [AppComponent, DevLocationBadgeComponent, DevLocationModalComponent],
  imports: [BrowserModule, FormsModule, IonicModule.forRoot(), CoreModule, SharedModule, AppRoutingModule],
  providers: [{ provide: RouteReuseStrategy, useClass: IonicRouteStrategy }],
  bootstrap: [AppComponent],
})
export class AppModule {}

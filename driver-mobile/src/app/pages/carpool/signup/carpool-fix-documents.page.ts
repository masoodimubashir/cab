import { Component, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { ApiService } from '../../../core/api.service';
import { DocUi, SignupDocs } from './signup-docs';

/**
 * Fix documents (from the status page, 1f "Needs attention"). Same documents and
 * uploads as sign-up step 5, but its own screen, so Back always returns to the
 * status page instead of walking back through the sign-up steps.
 */
@Component({
  selector: 'app-carpool-fix-documents',
  templateUrl: './carpool-fix-documents.page.html',
  styleUrls: ['./carpool-signup.page.scss', './carpool-signup-look.scss'],
  standalone: false,
})
export class CarpoolFixDocumentsPage implements OnInit {
  readonly docs: SignupDocs;
  error: string | null = null;

  constructor(
    api: ApiService,
    private nav: NavController,
  ) {
    this.docs = new SignupDocs(api);
  }

  ngOnInit(): void {
    this.docs.load((msg) => (this.error = msg));
  }

  /** Documents that still need sending come first; done ones follow. */
  get ordered(): DocUi[] {
    return [...this.docs.docs].sort((a, b) => Number(this.docs.needsWork(b)) - Number(this.docs.needsWork(a)));
  }

  get toFix(): number {
    return this.docs.docs.filter((d) => this.docs.needsWork(d)).length;
  }

  back(): void {
    void this.nav.navigateBack('/carpool-signup/status');
  }

  send(): void {
    if (!this.docs.allUploaded) return;
    void this.nav.navigateBack('/carpool-signup/status');
  }
}

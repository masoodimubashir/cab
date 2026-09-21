import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';

export interface DocumentRequirement {
  document_id: number | null;
  name: string;
  required_images: number;
  approved_images: number;
  status: 'missing' | 'rejected' | 'pending' | 'approved';
  slots: { index: number; status: string; rejection_reason?: string | null }[];
}

@Component({
  selector: 'app-document-requirements-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header class="ion-no-border"><ion-toolbar>
      <ion-title>Document check</ion-title>
      <ion-buttons slot="end"><ion-button (click)="close()" aria-label="Close document check"><ion-icon name="close-outline" slot="icon-only"></ion-icon></ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="document-check">
        <div class="check-icon"><ion-icon name="document-text-outline"></ion-icon></div>
        <h1>{{ needsUpload ? 'A few documents need attention' : 'Your documents are under review' }}</h1>
        <p class="intro">{{ needsUpload ? 'Complete the current requirements below before going online. Your approved images are already saved.' : 'Your uploads are with the team. You can go online once the required documents and your account are approved.' }}</p>
        <article *ngFor="let doc of requirements">
          <div class="document-heading"><h2>{{ doc.name }}</h2><span [class.review]="doc.status === 'pending'">{{ doc.status === 'pending' ? 'In review' : doc.status === 'rejected' ? 'Re-upload' : 'Upload needed' }}</span></div>
          <p>{{ doc.approved_images }} of {{ doc.required_images }} images approved</p>
          <ng-container *ngFor="let slot of doc.slots">
            <small *ngIf="slot.status === 'missing'">Image {{ slot.index }}: upload needed</small>
            <small class="rejection" *ngIf="slot.status === 'rejected'">Image {{ slot.index }}: {{ slot.rejection_reason || 'Please upload a clear, valid copy.' }}</small>
          </ng-container>
          <small *ngIf="doc.document_id === null">Contact support to update this older document.</small>
        </article>
      </div>
    </ion-content>
    <ion-footer class="ion-no-border"><div class="check-footer">
      <span>{{ needsUpload ? 'Open Profile → Documents' : 'No need to upload pending files again.' }}</span>
      <ion-button size="small" (click)="openDocuments()">{{ needsUpload ? 'Upload here' : 'View documents' }}<ion-icon name="arrow-forward-outline" slot="end"></ion-icon></ion-button>
    </div></ion-footer>
  `,
  styles: [`
    :host { --ion-background-color: #fff; --ion-text-color: #17232b; }
    ion-toolbar { --background: #fff; --border-width: 0; padding: 4px 8px; }
    ion-title { font-size: 17px; font-weight: 700; }
    .document-check { padding: 16px 22px 24px; }
    .check-icon { width: 48px; height: 48px; border-radius: 15px; background: #eaf8ef; color: #168448; display: grid; place-items: center; font-size: 26px; }
    h1 { font-size: 24px; font-weight: 750; line-height: 1.25; margin: 18px 0 10px; }
    .intro { font-size: 14px; line-height: 1.6; color: #647481; margin: 0 0 22px; }
    article { padding: 16px; margin-top: 10px; border: 1px solid #e5eaf0; border-radius: 14px; }
    .document-heading { display: flex; gap: 10px; justify-content: space-between; align-items: flex-start; }
    h2 { font-size: 15px; font-weight: 700; margin: 0; line-height: 1.4; }
    .document-heading span { background: #fff3e7; color: #9a4a12; border-radius: 20px; padding: 4px 8px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .document-heading .review { background: #edf3ff; color: #355c9d; }
    article p, article small { display: block; color: #647481; font-size: 12px; line-height: 1.5; margin: 7px 0 0; }
    article .rejection { color: #a43838; }
    .check-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; padding: 16px 22px calc(16px + env(safe-area-inset-bottom)); border-top: 1px solid #edf0f3; background: #fff; }
    .check-footer span { font-size: 12px; color: #647481; }
    ion-button { --border-radius: 10px; }
  `],
})
export class DocumentRequirementsModalComponent {
  @Input() requirements: DocumentRequirement[] = [];
  constructor(private modal: ModalController) {}
  get needsUpload(): boolean { return this.requirements.some(doc => doc.document_id !== null && ['missing', 'rejected'].includes(doc.status)); }
  close(): void { void this.modal.dismiss(); }
  openDocuments(): void { void this.modal.dismiss({ upload: true }); }
}

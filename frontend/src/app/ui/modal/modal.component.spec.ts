import { Component } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ModalComponent } from './modal.component';

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: '<tm-modal [open]="open" title="Edit route" [lockScroll]="false"><div slot="body">Choose editor</div></tm-modal>',
})
class ModalHostComponent { open = true; }

describe('Modal editor handoff', () => {
  it('removes the closing overlay after its animation so the next editor can receive clicks', fakeAsync(() => {
    const fixture = TestBed.createComponent(ModalHostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    fixture.componentInstance.open = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.is-closing')).not.toBeNull();
    tick(220);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    fixture.destroy();
  }));
});

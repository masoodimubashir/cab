import { TestBed } from '@angular/core/testing';
import { CarpoolRideBannerComponent, RideBanner } from './carpool-ride-banner.component';

/** W21: the banner at the top of the carpool page (mockup "Ride banner"). Shared by both apps. */
describe('CarpoolRideBannerComponent', () => {
  const base: RideBanner = {
    tone: 'go', chip: 'Live', live: true, title: 'Today, 8:30 AM', route: 'Bemina Bypass to Kashmir University',
    line: 'Next pickup: Aamir, about 8:47', small: 'Arrival about 9:04', ring: { kind: 'num', text: '1/3', unit: 'picked up', fill: 1 / 3 },
  };
  const render = (b: RideBanner) => {
    const f = TestBed.createComponent(CarpoolRideBannerComponent);
    f.componentInstance.b = b;
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  };

  beforeEach(() => TestBed.configureTestingModule({ imports: [CarpoolRideBannerComponent] }));

  it('shows the chip, time, route and the line, in its tone', () => {
    const { el } = render(base);
    const box = el.querySelector('.rb')!;
    expect(box.classList).toContain('go');
    expect(el.querySelector('.rb-chip')!.textContent!.trim()).toBe('Live');
    expect(el.querySelector('.rb-chip .dot')).not.toBeNull();
    expect(el.querySelector('h2')!.textContent).toBe('Today, 8:30 AM');
    expect(el.querySelector('.rb-route')!.textContent).toBe('Bemina Bypass to Kashmir University');
    expect(el.querySelector('.rb-line')!.textContent).toContain('Next pickup: Aamir, about 8:47');
    expect(el.querySelector('.rb-line small')!.textContent).toBe('Arrival about 9:04');
  });

  it('fills the ring to the share given and prints its number and word', () => {
    const { el } = render(base);
    const arc = el.querySelector('.rb-ring .arc') as SVGCircleElement;
    const c = 2 * Math.PI * 28;
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(c * (2 / 3), 0);
    expect(el.querySelector('.rb-ring .n')!.textContent).toBe('1/3');
    expect(el.querySelector('.rb-ring .u')!.textContent).toBe('picked up');
  });

  it('draws a full ring for a finished trip and a dashed one for a trip that broke off, each with its icon', () => {
    let { el } = render({ ...base, tone: 'done', ring: { kind: 'done', icon: 'checkmark' } });
    expect(el.querySelector('.rb-ring .full')).not.toBeNull();
    expect((el.querySelector('.rb-ic') as any).name).toBe('checkmark');
    ({ el } = render({ ...base, tone: 'over', ring: { kind: 'broken', icon: 'walk-outline' } }));
    expect(el.querySelector('.rb-ring .dash')).not.toBeNull();
    expect((el.querySelector('.rb-ic') as any).name).toBe('walk-outline');
  });

  it('puts a warning or reason in the strip, with its button', () => {
    const { f, el } = render({ ...base, small: undefined, note: 'Location is off', noteIcon: 'alert-circle-outline', action: 'Turn on' });
    let hit = 0;
    f.componentInstance.act.subscribe(() => hit++);
    expect(el.querySelector('.rb-note span')!.textContent).toBe('Location is off');
    (el.querySelector('.rb-note button') as HTMLButtonElement).click();
    expect(hit).toBe(1);
  });

  it('has no button when there is nothing to do, and no strip without a note', () => {
    let { el } = render({ ...base, note: 'Riders were told' });
    expect(el.querySelector('.rb-note button')).toBeNull();
    ({ el } = render(base));
    expect(el.querySelector('.rb-note')).toBeNull();
  });

  it('greys the button while its action runs', () => {
    const { f, el } = render({ ...base, note: 'Running late?', action: '+10 min' });
    f.componentInstance.busy = true;
    f.detectChanges();
    expect((el.querySelector('.rb-note button') as HTMLButtonElement).disabled).toBeTrue();
  });
});

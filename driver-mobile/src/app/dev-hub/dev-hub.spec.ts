import { DEV_HUB_CONFIG } from './dev-hub.config';
import { DevHubComponent } from './dev-hub.component';
import { fillPhotos, fillScreen } from './dev-hub.autofill';

describe('developer hub', () => {
  const name = (path: string) => DEV_HUB_CONFIG.screens.find((s) => s.match.test(path))?.name;

  it('names the sign-up, status, Fix documents and Plans screens, not just the address', () => {
    expect(name('/carpool-signup')).toBe('Sign-up step 1: driver type (1)');
    expect(name('/carpool-signup/details')).toBe('Sign-up steps 2 to 5 (1b to 1e)');
    expect(name('/carpool-signup/status')).toBe('Sign-up status (1f, 1g)');
    expect(name('/carpool-signup/documents')).toBe('Fix documents');
    expect(name('/carpool-signup/plans')).toBe('Plans (1h, 1i)');
    expect(name('/carpool/listing/12/pickup')).toBe('Pickup with code');
    expect(name('/carpool/listing/12')).toBe('Carpool page (8)');
    expect(name('/carpool/home')).toBe('Home (2)');
  });

  it('offers the Plans scenarios on the Plans page', () => {
    expect(DEV_HUB_CONFIG.screens.find((s) => s.match.test('/carpool-signup/plans'))?.keys)
      .toEqual(['d-no-plan', 'd-plan-30', 'd-plan-ending', 'd-plan-waiting']);
  });

  describe('Fill photos', () => {
    let host: HTMLDivElement;
    const slot = (cls: string) => {
      const label = document.createElement('label');
      label.className = cls;
      label.style.cssText = 'display:block;width:120px;height:60px';
      label.textContent = 'Front, plate visible';
      const input = document.createElement('input');
      input.type = 'file';
      input.hidden = true;
      label.appendChild(input);
      host.appendChild(label);
      return input;
    };

    beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
    afterEach(() => host.remove());

    it('puts a test picture into empty slots only and tells the screen', async () => {
      const empty = slot('cps-photo');
      const done = slot('cps-photo has-photo');
      let changed = 0;
      empty.addEventListener('change', () => changed++);
      const n = await fillPhotos();
      expect(n).toBe(1);
      expect(changed).toBe(1);
      expect(empty.files?.[0]?.type).toBe('image/jpeg');
      expect(empty.files?.[0]?.size).toBeGreaterThan(1000);
      expect(done.files?.length ?? 0).toBe(0);
    });
  });
  describe('Fill fields on the carpool sign-up car step', () => {
    let host: HTMLDivElement;
    const field = (label: string, placeholder: string) => {
      const l = document.createElement('label');
      l.className = 'cps-field';
      l.innerHTML = `<span class="cps-field__label">${label}</span><input class="cps-field__input" type="text" placeholder="${placeholder}">`;
      host.appendChild(l);
      return l.querySelector('input') as HTMLInputElement;
    };
    /** The app's own check (carpool-signup.page.ts), spaces ignored. */
    const PLATE = /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$/;

    beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); });
    afterEach(() => host.remove());

    it('reads the label text, so the number plate gets a real plate the app accepts', () => {
      const make = field('Make', 'Maruti');
      const colour = field('Colour', 'White');
      const plate = field('Number plate', 'JK01 AB 4521');
      fillScreen({ phone: '9990012345' });
      expect(make.value).toBe('Tata');
      expect(colour.value).toBe('Blue');
      expect(plate.value.toUpperCase().replace(/[^A-Z0-9]/g, '')).toMatch(PLATE);
    });

    it('gives a different plate each time, because plates must be unique', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const plate = field('Number plate', 'JK01 AB 4521');
        fillScreen({ phone: '9990012345' });
        seen.add(plate.value);
        plate.closest('label')!.remove();
      }
      expect(seen.size).toBeGreaterThan(15);
    });
  });

  /** L1.6: Simulate drive in Tools. */
  describe('Simulate drive', () => {
    let hub: DevHubComponent;
    let replies: string[];
    let sent: any[];

    beforeEach(() => {
      jasmine.clock().install();
      replies = [];
      sent = [];
      spyOn(window, 'fetch').and.callFake(async (_url: any, init: any) => {
        sent.push(JSON.parse(init.body));
        const message = replies.shift() ?? 'The car is 0.5 km along the route (of 9.3 km).';
        return new Response(JSON.stringify({ message }), { status: 200 });
      });
      hub = new DevHubComponent();
    });
    afterEach(() => {
      hub.ngOnDestroy();
      jasmine.clock().uninstall();
    });
    const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r)); };

    it('moves the car one step, or to the next pickup, and shows what the server said', async () => {
      jasmine.clock().uninstall();
      await hub.drive('step');
      expect(sent.pop()).toEqual({ to: 'step', metres: 300 });
      expect(hub.note).toContain('along the route');
      replies.push('The car is at the pickup of Sana (Rajbagh). Their wait has started.');
      await hub.drive('pickup');
      expect(sent.pop()).toEqual({ to: 'pickup', metres: 300 });
      expect(hub.note).toContain('Their wait has started');
      jasmine.clock().install();
    });

    it('drives on its own every 5 seconds until stopped', async () => {
      hub.toggleAuto();
      expect(hub.autoDriving).toBeTrue();
      jasmine.clock().tick(5000);
      jasmine.clock().tick(5000);
      expect(sent.length).toBe(3);
      expect(sent.every((b) => b.to === 'step' && b.metres === 150)).toBeTrue();
      hub.toggleAuto();
      expect(hub.autoDriving).toBeFalse();
      jasmine.clock().tick(20000);
      expect(sent.length).toBe(3);
    });

    it('stops by itself at the end of the route or when no carpool is on the road', async () => {
      jasmine.clock().uninstall();
      replies.push('The car is 9.3 km along the route (of 9.3 km). It has reached the end.');
      hub.toggleAuto();
      await settle();
      expect(hub.autoDriving).toBeFalse();
      replies.push('No carpool of yours is on the road. Start one first (scenario "On the road with riders").');
      hub.toggleAuto();
      await settle();
      expect(hub.autoDriving).toBeFalse();
      jasmine.clock().install();
    });
  });
});

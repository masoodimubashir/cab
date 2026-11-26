import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { CarpoolSettingsComponent, parseWords } from './carpool-settings.component';

const LIMITS = {
  search_distance_km: { min: 1, max: 10, default: 2, unit: 'km', nullable: false },
  auto_complete_hours: { min: 1, max: 48, default: 12, unit: 'hours', nullable: false },
  chat_retention_days: { min: 1, max: 30, default: 1, unit: 'days', nullable: false },
  publish_horizon_days: { min: 1, max: 90, default: 30, unit: 'days', nullable: false },
  start_early_minutes: { min: 5, max: 720, default: 60, unit: 'minutes', nullable: false },
  pending_expire_minutes: { min: 1, max: 180, default: 15, unit: 'minutes', nullable: false },
  plan_grace_days: { min: 0, max: 7, default: 1, unit: 'days', nullable: false },
  missed_departure_days: { min: 0, max: 1, default: 0, unit: 'days', nullable: false },
  plan_warning_days: { min: 1, max: 14, default: 3, unit: 'days', nullable: false },
  plan_push_hours: { min: 1, max: 72, default: 24, unit: 'hours', nullable: false },
  document_warning_days: { min: 1, max: 30, default: 7, unit: 'days', nullable: false },
  report_retention_days: { min: 30, max: 730, default: 180, unit: 'days', nullable: false },
  no_show_wait_minutes: { min: 1, max: 30, default: 5, unit: 'minutes', nullable: false },
  arrival_radius_m: { min: 30, max: 500, default: 100, unit: 'metres', nullable: false },
  position_retention_days: { min: 1, max: 30, default: 1, unit: 'days', nullable: false },
};

function settings(over: Record<string, unknown> = {}) {
  return {
    version: 'v1',
    enabled: true,
    search_distance_km: 2,
    auto_complete_hours: 12,
    chat_retention_days: 1,
    publish_horizon_days: 30,
    start_early_minutes: 60,
    pending_expire_minutes: 15,
    plan_grace_days: 1,
    missed_departure_days: 0,
    plan_warning_days: 3,
    plan_push_hours: 24,
    document_warning_days: 7,
    report_retention_days: 180,
    no_show_wait_minutes: 5,
    arrival_radius_m: 100,
    position_retention_days: 1,
    limits: LIMITS,
    upcoming_carpools: 0,
    carpools_on_the_road: 0,
    waiting_requests: 0,
    kill_switch: false,
    banned_words: [],
    banned_words_max: 500,
    can_edit: true,
    jobs: [],
    history: [],
    ...over,
  };
}

describe('CarpoolSettingsComponent', () => {
  let api: jasmine.SpyObj<ApiService>;
  let toast: jasmine.SpyObj<ToastService>;
  let c: CarpoolSettingsComponent;

  let canBrand = false;
  const operator = { settings: { carpool_service_name: 'Ride Share', carpool_service_image_url: 'http://x/tile.png' } };

  function open(data = settings()): void {
    api.get.and.callFake(((path: string) => of(path === '/admin/operator-settings' ? operator : { data })) as any);
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { hasPermission: (p: string) => canBrand && p === 'operator_settings' } }] });
    c = TestBed.runInInjectionContext(() => new CarpoolSettingsComponent(api, toast));
    c.ngOnInit();
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'patch', 'post', 'delete', 'postMultipart']);
    canBrand = false;
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
  });

  it('shows the server values and starts with nothing to save', () => {
    open();
    expect(c.f.publish_horizon_days).toBe(30);
    expect(c.f.missed_departure_days).toBe(0);
    expect(c.dirty).toBeFalse();
    expect(c.invalid).toBeFalse();
  });

  it('notices which settings were changed', () => {
    open();
    c.f.plan_grace_days = 3;
    c.f.start_early_minutes = 45;
    expect(c.dirty).toBeTrue();
    expect(c.changedKeys).toEqual(['start_early_minutes', 'plan_grace_days']);
    expect(c.isChanged('plan_grace_days')).toBeTrue();
    expect(c.isChanged('publish_horizon_days')).toBeFalse();
    c.discard();
    expect(c.dirty).toBeFalse();
    expect(c.f.plan_grace_days).toBe(1);
  });

  it('refuses values outside the limits the server sent, and blanks and decimals', () => {
    open();
    c.f.publish_horizon_days = 100;
    expect(c.err('publish_horizon_days')).toBe('Enter a value from 1 to 90.');
    expect(c.invalid).toBeTrue();
    c.f.publish_horizon_days = 1.5;
    expect(c.err('publish_horizon_days')).toContain('whole number');
    c.f.publish_horizon_days = null as any;
    expect(c.err('publish_horizon_days')).toContain('whole number');
    c.f.publish_horizon_days = 90;
    c.f.start_early_minutes = 4;
    expect(c.err('start_early_minutes')).toBe('Enter a value from 5 to 720.');
    c.f.start_early_minutes = 5;
    expect(c.invalid).toBeFalse();
  });

  it('offers two choices for a carpool nobody started: end of the departure day or end of the next day', () => {
    open();
    expect(c.err('missed_departure_days')).toBeNull();
    c.f.missed_departure_days = 1;
    expect(c.isChanged('missed_departure_days')).toBeTrue();
    expect(c.changedKeys).toEqual(['missed_departure_days']);
    expect(c.err('missed_departure_days')).toBeNull();
    c.discard();
    expect(c.f.missed_departure_days).toBe(0);
    expect(c.dirty).toBeFalse();
  });

  it('shows the choice the server already holds', () => {
    open(settings({ missed_departure_days: 1 }));
    expect(c.f.missed_departure_days).toBe(1);
    expect(c.dirty).toBeFalse();
  });

  it('has a plain-words explanation for every setting, the switch and the banned words', () => {
    open();
    for (const g of c.groups) {
      for (const r of g.rows) {
        expect(c.tip(r.key).length).withContext(r.key).toBeGreaterThan(60);
      }
    }
    expect(c.tips.enabled.length).toBeGreaterThan(60);
    expect(c.tips.banned_words.length).toBeGreaterThan(60);
  });

  it('sends only the changed fields and the version it loaded', () => {
    open();
    api.patch.and.returnValue(of({ data: settings({ version: 'v2', plan_grace_days: 3 }) }) as any);
    c.f.plan_grace_days = 3;
    c.save();

    expect(api.patch).toHaveBeenCalledOnceWith('/admin/carpool/settings', { plan_grace_days: 3, version: 'v1' });
    expect(c.s?.version).toBe('v2');
    expect(c.dirty).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });

  it('offers the plan reminder push hours next to the plan warning and saves them', () => {
    open();
    const keys = c.groups.find((g) => g.id === 'drivers-chats')!.rows.map((r) => r.key);
    expect(keys.indexOf('plan_push_hours')).toBe(keys.indexOf('plan_warning_days') + 1);
    expect(c.tip('plan_push_hours')).toContain('This setting');
    api.patch.and.returnValue(of({ data: settings({ version: 'v2', plan_push_hours: 6 }) }) as any);
    c.f.plan_push_hours = 6;
    c.save();
    expect(api.patch).toHaveBeenCalledOnceWith('/admin/carpool/settings', { plan_push_hours: 6, version: 'v1' });
  });

  it('offers the three live-location numbers at the end of On the day (L1.5)', () => {
    open();
    const keys = c.groups.find((g) => g.id === 'on-the-day')!.rows.map((r) => r.key);
    expect(keys.slice(-3)).toEqual(['no_show_wait_minutes', 'arrival_radius_m', 'position_retention_days']);
    for (const k of ['no_show_wait_minutes', 'arrival_radius_m', 'position_retention_days'] as const) {
      expect(c.tip(k)).withContext(k).toContain('This setting');
      expect(c.f[k]).withContext(k).toBe(settings()[k]);
    }
    c.f.arrival_radius_m = 20;
    expect(c.err('arrival_radius_m')).toBeTruthy();
    c.f.arrival_radius_m = 150;
    api.patch.and.returnValue(of({ data: settings({ version: 'v2', arrival_radius_m: 150, no_show_wait_minutes: 3 }) }) as any);
    c.f.no_show_wait_minutes = 3;
    c.save();
    expect(api.patch).toHaveBeenCalledOnceWith('/admin/carpool/settings', { no_show_wait_minutes: 3, arrival_radius_m: 150, version: 'v1' });
  });

  it('offers the document expiry warning days (S11)', () => {
    open();
    const keys = c.groups.find((g) => g.id === 'drivers-chats')!.rows.map((r) => r.key);
    expect(keys).toContain('document_warning_days');
    expect(c.tip('document_warning_days')).toContain('This setting');
  });

  it('sends the missed-departure choice as 0 or 1', () => {
    open(settings({ missed_departure_days: 1 }));
    api.patch.and.returnValue(of({ data: settings({ version: 'v2' }) }) as any);
    c.f.missed_departure_days = 0;
    c.save();

    expect(api.patch).toHaveBeenCalledOnceWith('/admin/carpool/settings', { missed_departure_days: 0, version: 'v1' });
    expect(c.f.missed_departure_days).toBe(0);
  });

  it('asks first when a timing change reaches carpools that already exist', () => {
    open(settings({ upcoming_carpools: 17, waiting_requests: 2 }));
    c.f.start_early_minutes = 30;
    c.save();
    expect(c.askApply).toBeTrue();
    expect(api.patch).not.toHaveBeenCalled();

    api.patch.and.returnValue(of({ data: settings({ version: 'v2', start_early_minutes: 30 }) }) as any);
    c.apply();
    expect(api.patch).toHaveBeenCalledOnceWith('/admin/carpool/settings', { start_early_minutes: 30, version: 'v1' });
    expect(c.askApply).toBeFalse();
  });

  it('saves a non-timing change without asking, even with carpools booked', () => {
    open(settings({ upcoming_carpools: 17 }));
    api.patch.and.returnValue(of({ data: settings({ version: 'v2', chat_retention_days: 5 }) }) as any);
    c.f.chat_retention_days = 5;
    c.save();
    expect(c.askApply).toBeFalse();
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('does not send anything while a value is invalid or nothing changed', () => {
    open();
    c.save();
    c.f.publish_horizon_days = 500;
    c.save();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('replaces its values and says so when someone else saved first (409)', () => {
    open();
    api.patch.and.returnValue(throwError(() => ({
      status: 409,
      error: { message: 'Settings were changed by someone else.', data: settings({ version: 'v9', plan_grace_days: 2 }) },
    })));
    c.f.chat_retention_days = 7;
    c.save();

    expect(c.s?.version).toBe('v9');
    expect(c.f.plan_grace_days).toBe(2);           // their value is shown
    expect(c.f.chat_retention_days).toBe(1);       // our unsaved edit is dropped
    expect(c.dirty).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith(jasmine.stringContaining('changed by someone else'));
  });

  it('shows the server message for any other failure and keeps the typed values', () => {
    open();
    api.patch.and.returnValue(throwError(() => ({ status: 422, error: { errors: { plan_grace_days: ['The plan grace days must be between 0 and 7.'] } } })));
    c.f.plan_grace_days = 3;
    c.save();
    expect(toast.error).toHaveBeenCalledWith('The plan grace days must be between 0 and 7.');
    expect(c.f.plan_grace_days).toBe(3);
  });

  it('keeps unsaved edits when the Carpool enabled switch is saved', () => {
    open();
    api.patch.and.returnValue(of({ data: settings({ version: 'v2', enabled: true }) }) as any);
    c.f.plan_grace_days = 4;
    c.turnOff();
    expect(api.patch).toHaveBeenCalledOnceWith('/admin/carpool/settings', { enabled: false, version: 'v1' });
    expect(c.f.plan_grace_days).toBe(4);
    expect(c.dirty).toBeTrue();
  });
  describe('report reasons', () => {
    const reason = (id: number, key: string, active = true) => ({ id, key, label: key, applies_to: 'both', active, reports: 0 });

    it('adds a reason and shows it at the end of the list', () => {
      open(settings({ report_reasons: [reason(1, 'spam')] }));
      api.post.and.returnValue(of({ data: reason(2, 'smoke') }) as any);
      c.newReason = '  Smelled of smoke ';
      c.addReason();
      expect(api.post).toHaveBeenCalledWith('/admin/carpool/report-reasons', { label: 'Smelled of smoke', applies_to: 'both' });
      expect(c.reasons.map((r) => r.key)).toEqual(['spam', 'smoke']);
      expect(c.newReason).toBe('');
    });

    it('does not send a label that is too short', () => {
      open(settings({ report_reasons: [] }));
      c.newReason = 'ab';
      c.addReason();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('turns a reason off, and puts the switch back when the server refuses', () => {
      open(settings({ report_reasons: [reason(1, 'spam'), reason(2, 'other')] }));
      api.patch.and.returnValue(of({ data: { ...reason(1, 'spam'), active: false } }) as any);
      const box = { checked: false } as HTMLInputElement;
      c.toggleReason(c.reasons[0], { target: box } as unknown as Event);
      expect(api.patch).toHaveBeenCalledWith('/admin/carpool/report-reasons/1', { active: false });
      expect(c.reasons[0].active).toBeFalse();

      api.patch.and.returnValue(throwError(() => ({ error: { message: 'Keep at least one reason on.' } })));
      const last = { checked: false } as HTMLInputElement;
      c.toggleReason(c.reasons[1], { target: last } as unknown as Event);
      expect(c.reasons[1].active).toBeTrue();
      expect(last.checked).toBeTrue();
      expect(toast.error).toHaveBeenCalledWith('Keep at least one reason on.');
    });
  });

  describe('banned words', () => {
    const word = (id: number, w: string, active = true) => ({ id, word: w, active });
    const bulk = (over: Record<string, unknown> = {}) => ({
      data: { added: [], already_there: 0, skipped: [], skipped_count: 0, over_limit: 0, total: 0, max: 500, ...over },
    });

    it('reads a pasted list the way the server does', () => {
      expect(parseWords('Fool, STUPID;idiot\n  dumb   head \n\n,a,fool')).toEqual(['fool', 'stupid', 'idiot', 'dumb head']);
      expect(parseWords('')).toEqual([]);
      expect(parseWords('x'.repeat(61))).toEqual([]);
    });

    it('counts only the words that would really be added', () => {
      open(settings({ banned_words: [word(1, 'idiot')] }));
      c.word = 'idiot, fool, fool, a';
      expect(c.wordCount).toBe(1);
      c.word = '';
      expect(c.wordCount).toBe(0);
    });

    it('sends the pasted text, shows the new words in order and says what happened', () => {
      open(settings({ banned_words: [word(1, 'idiot')] }));
      api.post.and.returnValue(of(bulk({ added: [word(3, 'stupid'), word(2, 'fool')], already_there: 1, total: 3 })) as any);
      c.word = 'Fool, stupid, idiot';
      c.addWords();

      expect(api.post).toHaveBeenCalledOnceWith('/admin/carpool/banned-words/bulk', { words: 'Fool, stupid, idiot' });
      expect(c.s?.banned_words.map((w) => w.word)).toEqual(['fool', 'idiot', 'stupid']);
      expect(c.word).toBe('');
      expect(c.result).toEqual({ text: 'Added 2 words. 1 was already on the list.', warn: false });
    });

    it('warns when words were skipped or the list is full', () => {
      open();
      api.post.and.returnValue(of(bulk({ added: [word(2, 'fool')], skipped: ['a'], skipped_count: 1, over_limit: 3 })) as any);
      c.word = 'fool, a, x1, x2, x3';
      c.addWords();
      expect(c.result?.warn).toBeTrue();
      expect(c.result?.text).toContain('Skipped 1');
      expect(c.result?.text).toContain('3 not added because the list is full (500 words)');
    });

    it('does nothing when there is nothing new to add', () => {
      open(settings({ banned_words: [word(1, 'idiot')] }));
      c.word = 'idiot';
      c.addWords();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('keeps the typed text when adding fails', () => {
      open();
      api.post.and.returnValue(throwError(() => ({ status: 422, error: { message: 'The list is full.' } })));
      c.word = 'fool';
      c.addWords();
      expect(c.word).toBe('fool');
      expect(c.adding).toBeFalse();
      expect(toast.error).toHaveBeenCalledWith('The list is full.');
    });

    it('searches the list without changing it', () => {
      open(settings({ banned_words: [word(1, 'fool'), word(2, 'foolish'), word(3, 'idiot')] }));
      c.wordFilter = 'FOOL';
      expect(c.shownWords.map((w) => w.word)).toEqual(['fool', 'foolish']);
      c.wordFilter = 'zzz';
      expect(c.shownWords).toEqual([]);
      c.wordFilter = '';
      expect(c.shownWords.length).toBe(3);
      expect(c.s?.banned_words.length).toBe(3);
    });
  });

  describe('app tile name and picture', () => {
    const sent = () => api.postMultipart.calls.mostRecent().args[1] as FormData;

    it('is hidden, and not loaded, for staff without the Operator settings permission', () => {
      open();
      expect(c.canBrand).toBeFalse();
      expect(c.tile).toBeNull();
      expect(api.get).not.toHaveBeenCalledWith('/admin/operator-settings');
    });

    it('shows the saved name and picture', () => {
      canBrand = true;
      open();
      expect(c.tile).toEqual({ name: 'Ride Share', image: 'http://x/tile.png' });
      expect(c.tileName).toBe('Ride Share');
      expect(c.tilePreview).toBe('http://x/tile.png');
      expect(c.tileDirty).toBeFalse();
    });

    it('saves only the carpool name, as the same form the operator settings page sends', () => {
      canBrand = true;
      open();
      api.postMultipart.and.returnValue(of({ settings: { carpool_service_name: 'Pool', carpool_service_image_url: 'http://x/tile.png' } }) as any);
      c.tileName = '  Pool ';
      expect(c.tileDirty).toBeTrue();
      c.saveTile();
      expect(api.postMultipart.calls.mostRecent().args[0]).toBe('/admin/operator-settings');
      const fd = sent();
      expect(fd.get('_method')).toBe('PATCH');
      expect(fd.get('carpool_service_name')).toBe('Pool');
      expect(fd.has('private_service_name')).toBeFalse();
      expect(fd.has('carpool_service_image')).toBeFalse();
      expect(fd.has('carpool_remove_service_image')).toBeFalse();
      expect(c.tile?.name).toBe('Pool');
      expect(c.tileDirty).toBeFalse();
      expect(toast.success).toHaveBeenCalled();
    });

    it('sends a new picture, or asks to remove it', () => {
      canBrand = true;
      open();
      api.postMultipart.and.returnValue(of(operator) as any);
      const file = new File(['x'], 'tile.png', { type: 'image/png' });
      c.pickTile({ target: { files: [file], value: 'tile.png' } } as unknown as Event);
      c.saveTile();
      expect(sent().get('carpool_service_image')).toEqual(file);

      c.removeTile();
      expect(c.tilePreview).toBeNull();
      c.saveTile();
      expect(sent().get('carpool_remove_service_image')).toBe('1');
      expect(sent().has('carpool_service_image')).toBeFalse();
    });

    it('refuses a picture over 4 MB without sending it', () => {
      canBrand = true;
      open();
      const big = { size: 5 * 1024 * 1024, name: 'big.png' } as File;
      c.pickTile({ target: { files: [big], value: 'big.png' } } as unknown as Event);
      expect(toast.error).toHaveBeenCalledWith('Choose a picture up to 4 MB.');
      expect(c.tileDirty).toBeFalse();
    });

    it('keeps what was typed when saving fails', () => {
      canBrand = true;
      open();
      api.postMultipart.and.returnValue(throwError(() => ({ status: 422, error: { errors: { carpool_service_name: ['Too long.'] } } })));
      c.tileName = 'Pool';
      c.saveTile();
      expect(toast.error).toHaveBeenCalledWith('Too long.');
      expect(c.tileName).toBe('Pool');
      expect(c.tileBusy).toBeFalse();
    });
  });
});

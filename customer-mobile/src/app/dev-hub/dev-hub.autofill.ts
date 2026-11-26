/**
 * Fills the form on the current screen with believable test data (developer hub).
 * Works on Ionic inputs and plain inputs; it only touches fields that are on screen.
 */

export interface FillContext {
  /** A test phone number without the country code, 10 digits. */
  phone: string;
}

const NAMES = ['Aijaz Test', 'Sana Test', 'Bilal Test', 'Nida Test'];

/** What a field is for, from its label, placeholder and name. */
function hintOf(el: HTMLElement): string {
  // type="text" says nothing about the field (it made every plain box look like a message box).
  const type = el.getAttribute('type');
  const own = [
    el.getAttribute('placeholder'), el.getAttribute('label'), el.getAttribute('name'), el.getAttribute('formcontrolname'),
    el.getAttribute('aria-label'), el.getAttribute('autocomplete'), el.getAttribute('inputmode'), type === 'text' ? '' : type, el.id,
  ];
  // The visible label: an ion-label or .label inside the field, or the text of the <label> around it
  // (the carpool sign-up uses <label class="cps-field"><span class="cps-field__label">Number plate</span>…).
  const item = el.closest('ion-item, .field, .form-group, .cps-field, label');
  const named = item?.querySelector('ion-label, label, .label, [class*="__label"], [class*="-label"]')?.textContent ?? '';
  const label = named || (item?.tagName === 'LABEL' ? item.textContent ?? '' : '');
  return [label, ...own].filter(Boolean).join(' ').toLowerCase();
}

function valueFor(hint: string, el: HTMLElement, ctx: FillContext, n: number): string {
  const max = Number(el.getAttribute('maxlength') || (el as HTMLInputElement).maxLength || 0);
  if (/otp|verification|code|pin/.test(hint) && !/pincode|postal|promo|coupon/.test(hint)) return max === 4 ? '1234' : '123456';
  if (/phone|mobile|tel/.test(hint)) return ctx.phone;
  if (/e-?mail/.test(hint)) return `test${n}@dreamcabs.test`;
  // A random plate the apps accept (JK01 DV 4821); plates must be unique, so never the same twice in a row.
  if (/plate|registration|reg\.? ?no|vehicle ?number|number ?plate/.test(hint)) return `JK01DV${1000 + Math.floor(Math.random() * 9000)}`;
  if (/make|brand|manufacturer/.test(hint)) return 'Tata';
  if (/model/.test(hint)) return 'Nexon';
  if (/colou?r/.test(hint)) return 'Blue';
  if (/seats?|capacity/.test(hint)) return '4';
  if (/price|fare|amount|rupee|cost/.test(hint)) return '60';
  if (/year/.test(hint)) return '2022';
  if (/date|dob|birth|expiry/.test(hint)) return /expiry/.test(hint) ? '2027-12-31' : '1995-05-05';
  if (/address|street|area|landmark/.test(hint)) return 'Bemina, Srinagar';
  if (/city/.test(hint)) return 'Srinagar';
  if (/name/.test(hint)) return NAMES[n % NAMES.length];
  if (/message|note|detail|comment|reason|description|about|text|search/.test(hint)) return 'Test text from the developer hub.';
  if (/number|numeric|decimal/.test(hint)) return '1';
  return 'Test';
}

function setValue(el: HTMLElement, value: string): void {
  if (el.tagName.toLowerCase().startsWith('ion-')) {
    (el as unknown as { value: string }).value = value;
    el.dispatchEvent(new CustomEvent('ionInput', { detail: { value }, bubbles: true }));
    el.dispatchEvent(new CustomEvent('ionChange', { detail: { value }, bubbles: true }));
    el.dispatchEvent(new CustomEvent('ionBlur', { bubbles: true }));
    return;
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function visible(el: HTMLElement): boolean {
  if (el.closest('[data-dev-hub]')) return false;
  const page = el.closest('.ion-page');
  if (page?.classList.contains('ion-page-hidden') || page?.hasAttribute('aria-hidden')) return false;
  const r = el.getBoundingClientRect();

  return r.width > 0 && r.height > 0;
}

/** Fills every empty, visible field. Returns how many were filled. */
export function fillScreen(ctx: FillContext, overwrite = false): number {
  const fields = Array.from(document.querySelectorAll<HTMLElement>('ion-input, ion-textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea'))
    .filter((el) => el.tagName.toLowerCase().startsWith('ion-') || !el.parentElement?.closest('ion-input, ion-textarea'))
    .filter(visible);
  let n = 0;
  for (const el of fields) {
    if ((el as HTMLInputElement).readOnly || el.hasAttribute('readonly') || (el as HTMLInputElement).disabled) continue;
    const current = String((el as unknown as { value?: string }).value ?? '');
    if (current && !overwrite) continue;
    const hint = hintOf(el);
    const type = (el.getAttribute('type') || '').toLowerCase();
    let v = valueFor(hint, el, ctx, n + 1);
    if (type === 'number' && !/^\d+$/.test(v)) v = '1';
    if (type === 'password') v = 'Test1234';
    setValue(el, v);
    n++;
  }
  // Tick the "I agree" boxes and switches that are still off.
  document.querySelectorAll<HTMLElement>('ion-checkbox').forEach((cb) => {
    if (!visible(cb) || (cb as unknown as { checked: boolean }).checked) return;
    (cb as unknown as { checked: boolean }).checked = true;
    cb.dispatchEvent(new CustomEvent('ionChange', { detail: { checked: true, value: true }, bubbles: true }));
    n++;
  });

  return n;
}

export function clearScreen(): number {
  let n = 0;
  document.querySelectorAll<HTMLElement>('ion-input, ion-textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea').forEach((el) => {
    if (!visible(el) || (el as HTMLInputElement).readOnly) return;
    if (!el.tagName.toLowerCase().startsWith('ion-') && el.parentElement?.closest('ion-input, ion-textarea')) return;
    if (String((el as unknown as { value?: string }).value ?? '')) {
      setValue(el, '');
      n++;
    }
  });

  return n;
}

/** The text a photo slot shows, used as the caption on the test picture. */
function slotLabel(input: HTMLInputElement): string {
  const box = input.closest('label, .cps-photo, .cps-slot, ion-item, .field') as HTMLElement | null;
  const doc = input.closest('.cps-doc, .d-card, section')?.querySelector('h2, .d-title, .cps-doc__name')?.textContent ?? '';
  return [doc, box?.innerText ?? ''].map((t) => t.trim()).filter(Boolean).join(' · ').slice(0, 60) || 'Test photo';
}

/** A slot already holding a picture or a sent document is left alone. */
function slotFilled(input: HTMLInputElement): boolean {
  const box = input.closest('label, .cps-photo, .cps-slot') as HTMLElement | null;
  return !!box && /has-photo|is-done|done/.test(box.className);
}

/** Draws a small picture with a caption, so test uploads are easy to tell apart. */
function testPicture(caption: string, n: number): Promise<File> {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 400;
  const g = c.getContext('2d')!;
  const hues = [150, 205, 32, 270, 350];
  g.fillStyle = `hsl(${hues[n % hues.length]} 45% 42%)`;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(255,255,255,.18)';
  g.fillRect(24, 24, c.width - 48, c.height - 48);
  g.fillStyle = '#fff';
  g.font = 'bold 34px Roboto, sans-serif';
  g.fillText('Dev hub test photo', 48, 96);
  g.font = '26px Roboto, sans-serif';
  g.fillText(caption.slice(0, 38), 48, 150);
  g.fillText(new Date().toLocaleString('en-IN'), 48, 340);
  return new Promise((resolve) => c.toBlob((b) => resolve(new File([b!], `dev-hub-${n}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.85));
}

/**
 * Puts a generated test picture into every empty photo or document slot on screen
 * (file inputs are hidden inside their tap area, so the tap area must be on screen).
 * Returns how many were filled.
 */
export async function fillPhotos(overwrite = false): Promise<number> {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=file]')).filter((input) => {
    if (input.disabled || input.closest('[data-dev-hub]')) return false;
    const box = (input.closest('label, .cps-photo, .cps-slot, ion-item, .field') as HTMLElement | null) ?? input.parentElement;
    return !!box && visible(box) && (overwrite || !slotFilled(input));
  });
  let n = 0;
  for (const input of inputs) {
    const file = await testPicture(slotLabel(input), n);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    n++;
    await new Promise((r) => setTimeout(r, 150)); // let each upload start before the next
  }
  return n;
}

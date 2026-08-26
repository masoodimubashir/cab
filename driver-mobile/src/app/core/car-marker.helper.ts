/**
 * Reusable Car Marker Generator for Google Maps AdvancedMarkerElement.
 * Creates an ultra-crisp, transparent-background top-down vector vehicle
 * with 100% pinpoint mathematical centering and live bearing rotation.
 */
export interface CarMarkerOptions {
  bearing?: number;
  label?: string;
  width?: number;
  height?: number;
}

export function buildReusableCarMarkerElement(options: CarMarkerOptions = {}): HTMLElement {
  const bearing = options.bearing ?? 0;
  const label = options.label;
  const width = options.width ?? 28;
  const height = options.height ?? 54;

  const root = document.createElement('div');
  root.className = 'fixed-driver-car-marker';

  const carWrap = document.createElement('div');
  carWrap.className = 'car-icon-wrap';
  carWrap.style.transform = `translate(-50%, -50%) rotate(${bearing}deg)`;

  carWrap.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 68" width="${width}" height="${height}" class="vector-car-svg">
      <!-- 1. Headlight Beams (Front Projection) -->
      <polygon points="7,8 2,0 12,0 10,8" fill="rgba(254, 240, 138, 0.45)" />
      <polygon points="26,8 24,0 34,0 29,8" fill="rgba(254, 240, 138, 0.45)" />

      <!-- 2. Tires (4 Wheels) -->
      <rect x="2" y="14" width="4" height="10" rx="2" fill="#0F172A" stroke="#334155" stroke-width="0.5" />
      <rect x="30" y="14" width="4" height="10" rx="2" fill="#0F172A" stroke="#334155" stroke-width="0.5" />
      <rect x="2" y="44" width="4" height="10" rx="2" fill="#0F172A" stroke="#334155" stroke-width="0.5" />
      <rect x="30" y="44" width="4" height="10" rx="2" fill="#0F172A" stroke="#334155" stroke-width="0.5" />

      <!-- 3. Side Mirrors -->
      <path d="M4 22 C2 22 2 25 5 26 L6 25 Z" fill="#0E8543" stroke="#064E3B" stroke-width="0.5" />
      <path d="M32 22 C34 22 34 25 31 26 L30 25 Z" fill="#0E8543" stroke="#064E3B" stroke-width="0.5" />

      <!-- 4. Aerodynamic Chassis (Body) -->
      <path d="M9 14 C9 8, 14 6, 18 6 C22 6, 27 8, 27 14 L27 52 C27 58, 24 60, 18 60 C12 60, 9 58, 9 52 Z" fill="#12B35B" stroke="#0E8543" stroke-width="1.4" />

      <!-- 5. Front Windshield -->
      <path d="M11 20 C11 18, 13 16, 18 16 C23 16, 25 18, 25 20 L24 26 L12 26 Z" fill="#0F172A" stroke="#38BDF8" stroke-width="0.8" />
      <path d="M13 18 L15 25" stroke="#38BDF8" stroke-width="0.8" stroke-linecap="round" opacity="0.8" />

      <!-- 6. Roof & Taxi Top Beacon -->
      <rect x="11.5" y="27" width="13" height="17" rx="2" fill="#0E8543" stroke="#064E3B" stroke-width="0.5" />
      <rect x="15" y="32" width="6" height="5" rx="1.5" fill="#FEF08A" stroke="#CA8A04" stroke-width="0.6" />

      <!-- 7. Rear Windshield -->
      <path d="M12 45 L24 45 L25 50 C23 52, 13 52, 11 50 Z" fill="#0F172A" stroke="#38BDF8" stroke-width="0.8" />

      <!-- 8. Headlights -->
      <rect x="8.5" y="8.5" width="3.5" height="2" rx="1" fill="#FEF08A" stroke="#CA8A04" stroke-width="0.4" />
      <rect x="24" y="8.5" width="3.5" height="2" rx="1" fill="#FEF08A" stroke="#CA8A04" stroke-width="0.4" />

      <!-- 9. Taillights -->
      <rect x="9.5" y="58.5" width="3.5" height="1.8" rx="0.8" fill="#EF4444" stroke="#991B1B" stroke-width="0.4" />
      <rect x="23" y="58.5" width="3.5" height="1.8" rx="0.8" fill="#EF4444" stroke="#991B1B" stroke-width="0.4" />
    </svg>
  `;

  root.appendChild(carWrap);

  if (label) {
    const pill = document.createElement('div');
    pill.className = 'car-driver-pill';
    pill.textContent = label;
    root.appendChild(pill);
  }

  return root;
}

export function updateCarMarkerBearing(marker: any, bearing: number): void {
  if (!marker?.content) return;
  const carWrap = (marker.content as HTMLElement).querySelector('.car-icon-wrap') as HTMLElement | null;
  if (carWrap) {
    carWrap.style.transform = `translate(-50%, -50%) rotate(${bearing}deg)`;
  }
}

export interface PassengerMarkerOptions {
  kind?: 'pickup' | 'drop';
  name?: string;
  count?: number;
  isLive?: boolean;
  label?: string;
}

/**
 * Builds the unified passenger avatar marker with cap avatar, drop pin, seat count,
 * and live walking pulsing ring.
 */
export function buildPassengerMarkerElement(options: PassengerMarkerOptions = {}): HTMLElement {
  const kind = options.kind || 'pickup';
  const name = options.name || 'Passenger';
  const count = options.count ?? 1;
  const isLive = !!options.isLive;

  const el = document.createElement('div');
  el.className = `fixed-driver-person-marker fixed-driver-person-marker--${kind} ${isLive ? 'is-live-walking' : ''}`;

  const iconHtml = kind === 'pickup'
    ? `<div class="person-avatar-wrap">
         <svg viewBox="0 0 24 32" width="28" height="38" fill="#2563EB" stroke="#FFFFFF" stroke-width="1.2" stroke-linejoin="round" class="person-avatar-svg">
           <!-- Head -->
           <circle cx="12" cy="5" r="3.5" />
           <!-- Full Body: Torso, Arms, Legs -->
           <path d="M15 10.5h-6c-1.1 0-2 .9-2 2v5.5c0 .6.45 1 1 1s1-.4 1-1V13.5h1V28c0 .6.45 1 1 1s1-.4 1-1v-8h2v8c0 .6.45 1 1 1s1-.4 1-1V13.5h1v4.5c0 .6.45 1 1 1s1-.4 1-1v-5.5c0-1.1-.9-2-2-2z" />
         </svg>
       </div>`
    : `<div class="person-avatar-wrap person-avatar-wrap--drop">
         <svg viewBox="0 0 24 32" width="26" height="36" fill="#F59E0B" stroke="#FFFFFF" stroke-width="1.2" class="person-avatar-svg">
           <path d="M12 2C7.58 2 4 5.58 4 10c0 6 8 16 8 16s8-10 8-16c0-4.42-3.58-8-8-8zm0 11c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"/>
         </svg>
       </div>`;

  const safeName = (name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const seatBadge = count > 1 ? `<span class="person-tag-seats">${count}s</span>` : '';
  const liveDot = isLive ? `<span class="person-live-dot" title="Live Walking">●</span>` : '';

  const labelHtml = `
    <div class="person-tag-pill">
      <span class="person-tag-name">${safeName}</span>
      ${seatBadge}
      ${liveDot}
    </div>
  `;

  el.innerHTML = `${iconHtml}${labelHtml}`;
  return el;
}

export interface StopMarkerOptions {
  seq: number | string;
  name?: string;
  isReached?: boolean;
  tone?: string;
}

/**
 * Builds the sequence numbered stop marker with green/slate state colors.
 */
export function buildStopMarkerElement(options: StopMarkerOptions): HTMLElement {
  const el = document.createElement('div');
  el.className = 'fixed-driver-stop-marker';
  const tone = options.tone || (options.isReached ? '#64748B' : '#12B35B');
  el.style.setProperty('--stop-color', tone);
  el.innerHTML = `<span>${options.seq}</span>`;
  return el;
}


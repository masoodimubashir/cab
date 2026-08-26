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
      <defs>
        <!-- Car Body Gradient (Modern Emerald Metallic Cab) -->
        <linearGradient id="cabBodyGradCust" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#0E8543" />
          <stop offset="25%" stop-color="#12B35B" />
          <stop offset="50%" stop-color="#22C55E" />
          <stop offset="75%" stop-color="#12B35B" />
          <stop offset="100%" stop-color="#0E8543" />
        </linearGradient>
        <!-- Windshield Glass Gradient -->
        <linearGradient id="glassGradCust" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#1E293B" />
          <stop offset="100%" stop-color="#0F172A" />
        </linearGradient>
        <!-- Headlight Beam Gradient -->
        <linearGradient id="headlightBeamCust" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#FEF08A" stop-opacity="0.8" />
          <stop offset="100%" stop-color="#FEF08A" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- 1. Headlight Beams (Front Projection) -->
      <polygon points="7,8 3,0 12,0 10,8" fill="url(#headlightBeamCust)" />
      <polygon points="26,8 24,0 33,0 29,8" fill="url(#headlightBeamCust)" />

      <!-- 2. Tires (4 Wheels) -->
      <rect x="2" y="14" width="4" height="10" rx="2" fill="#0F172A" stroke="#334155" stroke-width="0.5" />
      <rect x="30" y="14" width="4" height="10" rx="2" fill="#0F172A" stroke="#334155" stroke-width="0.5" />
      <rect x="2" y="44" width="4" height="10" rx="2" fill="#0F172A" stroke="#334155" stroke-width="0.5" />
      <rect x="30" y="44" width="4" height="10" rx="2" fill="#0F172A" stroke="#334155" stroke-width="0.5" />

      <!-- 3. Side Mirrors -->
      <path d="M4 22 C2 22 2 25 5 26 L6 25 Z" fill="#0E8543" stroke="#064E3B" stroke-width="0.5" />
      <path d="M32 22 C34 22 34 25 31 26 L30 25 Z" fill="#0E8543" stroke="#064E3B" stroke-width="0.5" />

      <!-- 4. Aerodynamic Chassis (Body) -->
      <path d="M9 14 C9 8, 14 6, 18 6 C22 6, 27 8, 27 14 L27 52 C27 58, 24 60, 18 60 C12 60, 9 58, 9 52 Z" fill="url(#cabBodyGradCust)" stroke="#FFFFFF" stroke-width="1.2" />

      <!-- 5. Front Windshield -->
      <path d="M11 20 C11 18, 13 16, 18 16 C23 16, 25 18, 25 20 L24 26 L12 26 Z" fill="url(#glassGradCust)" stroke="#38BDF8" stroke-width="0.6" />
      <path d="M13 18 L15 25" stroke="#BAE6FD" stroke-width="1" stroke-linecap="round" opacity="0.7" />

      <!-- 6. Roof & Taxi Top Beacon -->
      <rect x="11.5" y="27" width="13" height="17" rx="2" fill="#15803D" />
      <rect x="15" y="32" width="6" height="5" rx="1.5" fill="#FEF08A" stroke="#CA8A04" stroke-width="0.5" />

      <!-- 7. Rear Windshield -->
      <path d="M12 45 L24 45 L25 50 C23 52, 13 52, 11 50 Z" fill="url(#glassGradCust)" stroke="#38BDF8" stroke-width="0.5" />

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

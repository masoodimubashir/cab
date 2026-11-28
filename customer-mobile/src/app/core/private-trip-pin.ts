let pinGradientSequence = 0;
/** Shaded pin with a fixed ground anchor and a small perspective sway. */
export function buildPrivateOriginMarker(label: string, destination = false): HTMLElement {
  const marker = document.createElement('div');
  marker.className = 'private-origin-marker' + (destination ? ' private-origin-marker--destination' : '');
  marker.setAttribute('aria-label', label);
  const id = `private-pin-${++pinGradientSequence}`;
  const light = destination ? '#ff9bb0' : '#52dfac', main = destination ? '#df4d6e' : '#00945d', dark = destination ? '#9d2544' : '#005f43';
  marker.innerHTML = `<span class="private-origin-marker__shadow"></span><span class="private-origin-marker__halo"></span>
    <svg width="38" height="48" viewBox="0 0 38 48" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${light}"/><stop offset=".43" stop-color="${main}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
      <radialGradient id="${id}-core" cx=".3" cy=".2" r=".8"><stop stop-color="#fff"/><stop offset=".65" stop-color="#f3fffb"/><stop offset="1" stop-color="#c8e2d9"/></radialGradient></defs>
      <path d="M19 47C15 40 4 28 4 20a15 15 0 0 1 30 0c0 8-11 20-15 27Z" fill="${dark}" opacity=".65"/>
      <path d="M19 45C15 38 3 26 3 18a16 16 0 0 1 32 0c0 8-12 20-16 27Z" fill="url(#${id})" stroke="white" stroke-width="2"/>
      <path d="M7 16a12 12 0 0 1 18-9" fill="none" stroke="white" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>
      <circle cx="19" cy="18" r="7" fill="${dark}" opacity=".35"/><circle cx="18.5" cy="17" r="6" fill="url(#${id}-core)"/>
    </svg><span class="private-origin-marker__label">${destination ? 'Destination' : 'Pickup'}</span>`;
  return marker;
}

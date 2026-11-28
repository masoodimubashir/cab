export type JourneyPoint = { lat: number; lng: number };
type WorldPoint = { x: number; y: number };

function project(p: JourneyPoint): WorldPoint {
  const sin = Math.sin(Math.max(-85, Math.min(85, p.lat)) * Math.PI / 180);
  return { x: (p.lng + 180) / 360, y: .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
}
function unproject(p: WorldPoint): JourneyPoint {
  return { lng: p.x * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * p.y))) * 180 / Math.PI };
}

/** A decorative journey arc, independent of road routing or fare distance. */
export function journeyCurve(pickup: JourneyPoint, drop: JourneyPoint): JourneyPoint[] {
  const a = project(pickup), b = project(drop);
  // Follow the short direction even when a journey crosses the date line.
  b.x = a.x + ((b.x - a.x + 1.5) % 1 - .5);
  const dx = b.x - a.x, dy = b.y - a.y;
  const control = { x: (a.x + b.x) / 2 - dy * .24, y: (a.y + b.y) / 2 + dx * .24 };
  return Array.from({ length: 81 }, (_, i) => {
    const t = i / 80, u = 1 - t;
    return unproject({ x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * b.y });
  });
}

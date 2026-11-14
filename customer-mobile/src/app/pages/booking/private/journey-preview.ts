import { moveCustomerMap } from '../../../core/customer-map';
import { resumeMapCamera } from '../../../core/map-camera';

declare const google: any;
export type JourneyPoint = { lat: number; lng: number };
type WorldPoint = { x: number; y: number };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

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

export function journeyCamera(path: JourneyPoint[], width: number, height: number): { center: JourneyPoint; zoom: number } {
  const points = path.map(project);
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const top = Math.min(210, height * .3), bottom = Math.min(115, height * .2), side = Math.min(60, width * .15);
  const usableW = Math.max(80, width - side * 2), usableH = Math.max(100, height - top - bottom);
  const zoom = Math.max(2, Math.min(17.5,
    Math.log2(usableW / (256 * Math.max(maxX - minX, 1e-8))),
    Math.log2(usableH / (256 * Math.max(maxY - minY, 1e-8)))));
  const worldSize = 256 * 2 ** zoom;
  return { zoom, center: unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 - (top - bottom) / (2 * worldSize) }) };
}

/** One cancellable timeline: frame both ends, draw toward drop, reveal drop. */
export class JourneyPreview {
  private frame = 0;
  private line: any = null;
  private layers: any[] = [];
  private generation = 0;

  constructor(private map: any) {}

  start(pickup: JourneyPoint, drop: JourneyPoint, revealDrop: () => void): void {
    this.clear();
    const generation = this.generation;
    const path = journeyCurve(pickup, drop);
    const div = this.map.getDiv();
    const target = journeyCamera(path, div.clientWidth || 400, div.clientHeight || 700);
    const startCenter = this.map.getCenter()?.toJSON() || pickup;
    const a = project(startCenter), b = project(target.center);
    b.x = a.x + ((b.x - a.x + 1.5) % 1 - .5);
    const startZoom = this.map.getZoom() ?? target.zoom;
    const startTilt = this.map.getTilt() ?? 0, startHeading = this.map.getHeading() ?? 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cameraMs = reduced ? 0 : 750, drawMs = reduced ? 0 : 1000;
    this.line = new google.maps.Polyline({ map: this.map, path: [], clickable: false, geodesic: false,
      strokeColor: '#008453', strokeOpacity: 1, strokeWeight: 7, zIndex: 30,
      icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, fillOpacity: 1, strokeWeight: 1 }, offset: '100%' }] });
    const line = this.line;
    const shadow = new google.maps.Polyline({ map: this.map, path: [], clickable: false, strokeColor: '#123e32', strokeOpacity: .19, strokeWeight: 13, zIndex: 27 });
    const rim = new google.maps.Polyline({ map: this.map, path: [], clickable: false, strokeColor: '#d0f6e5', strokeOpacity: .95, strokeWeight: 9, zIndex: 29 });
    const shine = new google.maps.Polyline({ map: this.map, path: [], clickable: false, strokeColor: '#89e5b8', strokeOpacity: .85, strokeWeight: 2, zIndex: 31 });
    this.layers = [shadow, rim, shine];
    const shadowShift = 3 / (256 * 2 ** target.zoom);
    resumeMapCamera(this.map);
    const start = performance.now();
    let cameraDone = false;
    const tick = (now: number) => {
      if (generation !== this.generation) return;
      const elapsed = Math.max(0, now - start);
      if (!cameraDone) {
        const t = reduced ? 1 : ease(Math.min(1, elapsed / cameraMs));
        moveCustomerMap(this.map, { center: unproject({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) }),
          zoom: mix(startZoom, target.zoom, t), tilt: mix(startTilt, 0, t), heading: mix(startHeading, 0, t) });
        cameraDone = reduced || elapsed >= cameraMs;
      }
      const progress = reduced ? 1 : Math.max(0, Math.min(1, (elapsed - cameraMs) / drawMs));
      if (progress > 0) {
        const end = progress * (path.length - 1), index = Math.floor(end);
        const visible = path.slice(0, index + 1);
        if (index < path.length - 1) visible.push({ lat: mix(path[index].lat, path[index + 1].lat, end - index), lng: mix(path[index].lng, path[index + 1].lng, end - index) });
        line.setPath(visible);
        rim.setPath(visible);
        shine.setPath(visible);
        shadow.setPath(visible.map(p => { const w = project(p); return unproject({ x: w.x, y: w.y + shadowShift }); }));
      }
      if (progress >= 1) {
        this.frame = 0;
        revealDrop();
        if (!reduced) {
          const flow = (time: number) => {
            if (generation !== this.generation) return;
            if (typeof document === 'undefined' || document.visibilityState !== 'hidden') shine.set('icons', [{
              icon: { path: google.maps.SymbolPath.CIRCLE, scale: 3, fillColor: '#fff', fillOpacity: 1, strokeColor: '#70dfac', strokeWeight: 3 },
              offset: `${((time - now) % 2200) / 22}%`,
            }]);
            this.frame = requestAnimationFrame(flow);
          };
          this.frame = requestAnimationFrame(flow);
        }
      }
      else this.frame = requestAnimationFrame(tick);
    };
    if (reduced) tick(start);
    else this.frame = requestAnimationFrame(tick);
  }

  clear(): void {
    ++this.generation;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.line?.setMap(null);
    for (const layer of this.layers) layer.setMap(null);
    this.layers = [];
    this.line = null;
  }
}

/*
 * The map's wind layer. It draws one hour of the field the server sent:
 * moving particles, or still arrows under reduced motion or when stale.
 * It never fetches, never blends two hours and never judges freshness.
 */

const MPH_TO_MS = 0.44704;
const M_PER_DEG_LAT = 111320;
const FRAME_MS = 1000 / 30;
const PARTICLES = 300;

/**
 * The vector the wind blows toward, in mph: u east, v north. `dirFromDeg` is
 * where the wind comes from, so a north wind (0) has a negative v.
 */
export function toUV(speedMph, dirFromDeg) {
  const rad = (dirFromDeg * Math.PI) / 180;
  return { u: -speedMph * Math.sin(rad), v: -speedMph * Math.cos(rad) };
}

/** The cell holding x on an ascending axis and how far across it, or null. */
function cell(axis, x) {
  const n = axis.length;
  if (n < 2 || !(x >= axis[0] && x <= axis[n - 1])) return null;
  let i = 0;
  while (i < n - 2 && x > axis[i + 1]) i++;
  return { i, t: (x - axis[i]) / (axis[i + 1] - axis[i]) };
}

/**
 * The wind at a point for one hour, interpolated between the four grid
 * points around it. Only that hour's values are read. Null outside the grid.
 */
export function sampleField(field, hourIndex, lon, lat) {
  const speed = field.speed[hourIndex];
  const dir = field.dir[hourIndex];
  const x = cell(field.lons, lon);
  const y = cell(field.lats, lat);
  if (!speed || !dir || !x || !y) return null;
  const at = (r, c) => toUV(speed[y.i + r][x.i + c], dir[y.i + r][x.i + c]);
  const [a, b, c, d] = [at(0, 0), at(0, 1), at(1, 0), at(1, 1)];
  const mix = (k) => (a[k] * (1 - x.t) + b[k] * x.t) * (1 - y.t) + (c[k] * (1 - x.t) + d[k] * x.t) * y.t;
  return { u: mix("u"), v: mix("v") };
}

/** Moves a particle along a sample in mph for dtSeconds. */
export function stepParticle(p, sample, dtSeconds, metersPerDegLat, metersPerDegLon) {
  return {
    lon: p.lon + (sample.u * MPH_TO_MS * dtSeconds) / metersPerDegLon,
    lat: p.lat + (sample.v * MPH_TO_MS * dtSeconds) / metersPerDegLat,
  };
}

/**
 * Draws the field on a canvas over the map. Each draw projects from lon/lat,
 * so it stays aligned through pan and zoom.
 * options: { hour, stale, reducedMotion, colors: { sea, ink, paper } }
 */
export function createWindLayer(map, field, options) {
  let hour = options.hour || 0;
  let stale = !!options.stale;
  let colors = options.colors;
  let particles = [];
  let raf = 0;
  let last = 0;
  let moving = false;
  const still = () => stale || !!options.reducedMotion;

  const box = map.getContainer();
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "absolute", top: "0", left: "0", pointerEvents: "none" });
  // Above the map, under its controls.
  box.insertBefore(canvas, box.querySelector(".maplibregl-control-container"));
  const ctx = canvas.getContext("2d");

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = box.clientWidth;
    const h = box.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    Object.assign(canvas.style, { width: w + "px", height: h + "px" });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // A new particle somewhere inside both the visible map and the grid.
  function spawn() {
    const { lons, lats } = field;
    const b = map.getBounds();
    const w = Math.max(b.getWest(), lons[0]);
    const e = Math.min(b.getEast(), lons[lons.length - 1]);
    const s = Math.max(b.getSouth(), lats[0]);
    const n = Math.min(b.getNorth(), lats[lats.length - 1]);
    if (!(e > w && n > s)) return null;
    const lon = w + Math.random() * (e - w);
    const lat = s + Math.random() * (n - s);
    return { lon, lat, age: 0, life: 40 + Math.random() * 60, trail: [[lon, lat]] };
  }

  function step(dt) {
    const mPerDegLon = M_PER_DEG_LAT * Math.cos((map.getCenter().lat * Math.PI) / 180);
    // Real wind would crawl, so time is sped up with the scale: 10 mph
    // crosses about 36 px a second at any zoom.
    const metersPerPx = (mPerDegLon * 360) / (512 * 2 ** map.getZoom());
    const simDt = dt * metersPerPx * 8;
    particles = particles.map((p) => {
      const sample = p && sampleField(field, hour, p.lon, p.lat);
      if (!p || !sample || ++p.age > p.life) return spawn();
      Object.assign(p, stepParticle(p, sample, simDt, M_PER_DEG_LAT, mPerDegLon));
      p.trail.push([p.lon, p.lat]);
      // Faster wind leaves a longer trail.
      const keep = Math.min(16, 4 + Math.round(Math.hypot(sample.u, sample.v) / 2));
      if (p.trail.length > keep) p.trail.splice(0, p.trail.length - keep);
      return p;
    });
  }

  function drawParticles() {
    ctx.strokeStyle = colors.sea;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.25;
    ctx.lineCap = "round";
    for (const p of particles) {
      if (!p || p.trail.length < 2) continue;
      ctx.beginPath();
      p.trail.forEach((ll, i) => {
        const pt = map.project(ll);
        if (i) ctx.lineTo(pt.x, pt.y);
        else ctx.moveTo(pt.x, pt.y);
      });
      ctx.stroke();
    }
  }

  // One arrow per grid point, length by speed, labelled in mph from zoom 12.
  function drawArrows() {
    const speed = field.speed[hour];
    const dir = field.dir[hour];
    if (!speed || !dir) return;
    ctx.font = "12px Geist, sans-serif";
    ctx.textAlign = "center";
    field.lats.forEach((lat, r) => {
      field.lons.forEach((lon, c) => {
        const pt = map.project([lon, lat]);
        const mph = speed[r][c];
        const { u, v } = toUV(mph, dir[r][c]);
        const half = Math.min(25, 4 + mph * 1.1);
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(Math.atan2(-v, u));
        ctx.globalAlpha = stale ? 0.4 : 1;
        ctx.strokeStyle = stale ? colors.ink : colors.sea;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-half, 0);
        ctx.lineTo(half, 0);
        ctx.moveTo(half - 7, -4);
        ctx.lineTo(half, 0);
        ctx.lineTo(half - 7, 4);
        ctx.stroke();
        ctx.restore();
        if (map.getZoom() < 12) return;
        const text = Math.round(mph) + " mph";
        ctx.strokeStyle = colors.paper;
        ctx.lineWidth = 3;
        ctx.strokeText(text, pt.x, pt.y + half + 14);
        ctx.fillStyle = colors.ink;
        ctx.fillText(text, pt.x, pt.y + half + 14);
      });
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (still()) drawArrows();
    else drawParticles();
    ctx.globalAlpha = 1;
  }

  const animating = () => !still() && !moving && document.visibilityState !== "hidden";

  function frame(t) {
    raf = 0;
    if (!animating()) return;
    if (t - last >= FRAME_MS) {
      step(Math.min((t - last) / 1000, 0.1));
      last = t;
      draw();
    }
    raf = requestAnimationFrame(frame);
  }

  // Starts or stops the loop to fit the current state, then redraws.
  function sync() {
    cancelAnimationFrame(raf);
    raf = animating() ? requestAnimationFrame(frame) : 0;
    draw();
  }

  // While the map moves, particles stop and are only re-projected.
  const handlers = {
    movestart: () => ((moving = true), sync()),
    move: draw,
    moveend: () => ((moving = false), sync()),
    resize: () => (resize(), draw()),
  };
  for (const [name, fn] of Object.entries(handlers)) map.on(name, fn);
  document.addEventListener("visibilitychange", sync);

  resize();
  particles = Array.from({ length: PARTICLES }, spawn);
  sync();

  return {
    setHour(i) {
      hour = i;
      particles = particles.map(() => spawn());
      draw();
    },
    setStale(value) {
      stale = !!value;
      sync();
    },
    setColors(next) {
      colors = next;
      draw();
    },
    remove() {
      cancelAnimationFrame(raf);
      for (const [name, fn] of Object.entries(handlers)) map.off(name, fn);
      document.removeEventListener("visibilitychange", sync);
      canvas.remove();
    },
  };
}

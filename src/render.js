import { WORLD, TEAM, TEAM_DATA, UNIT_TYPES, BUILDING_TYPES, GAME_RULES } from "./config.js";
import { clamp, rand, RNG, TAU, colorWithAlpha, dist, angleTo, roundRect, polygonPath } from "./utils.js";

const S = 0.5; // terrain render scale

function hexPath(ctx, x, y, r, rotation = 0) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rotation + (i / 6) * TAU;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export class Renderer {
  constructor(canvas, game, minimapCanvas, portraitCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.game = game;
    this.minimap = minimapCanvas;
    this.mctx = minimapCanvas.getContext("2d");
    this.portrait = portraitCanvas;
    this.pctx = portraitCanvas.getContext("2d");
    this.dpr = 1;
    this.terrain = null;
    this.miniBase = null;
    this.fogCanvas = null;
    this.fogVersion = -1;
    this.time = 0;
    this.stars = [];
    this.miniTimer = 0;
    this.portraitTimer = 0;
    this.resize();
    this.makeStars();
  }

  makeStars() {
    const rng = new RNG(771);
    this.stars = [];
    for (let i = 0; i < 90; i++) {
      this.stars.push({ x: rng.range(0, 1), y: rng.range(0, 1), s: rng.range(0.4, 1.5), a: rng.range(0.15, 0.55), p: rng.range(0, TAU) });
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(320, rect.width || window.innerWidth);
    const cssH = Math.max(240, rect.height || window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(cssW * this.dpr);
    this.canvas.height = Math.floor(cssH * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.game.setViewport(cssW, cssH);
    this.width = cssW;
    this.height = cssH;
    this.fogCanvas = null;
  }

  buildTerrain() {
    const c = document.createElement("canvas");
    c.width = WORLD.width * S;
    c.height = WORLD.height * S;
    const ctx = c.getContext("2d");
    const rng = new RNG(60277);
    const w = c.width;
    const h = c.height;

    // Deep mineral shelf palette.
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, "#071b1c");
    base.addColorStop(0.35, "#0a2022");
    base.addColorStop(0.65, "#092026");
    base.addColorStop(1, "#101d20");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Broad organic mineral blooms.
    for (let i = 0; i < 30; i++) {
      const x = rng.range(0, w);
      const y = rng.range(0, h);
      const r = rng.range(70, 360);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const palettes = [
        ["rgba(14, 83, 82, .20)", "rgba(14, 83, 82, 0)"],
        ["rgba(39, 76, 66, .18)", "rgba(39, 76, 66, 0)"],
        ["rgba(16, 54, 74, .26)", "rgba(16, 54, 74, 0)"],
        ["rgba(55, 42, 35, .16)", "rgba(55, 42, 35, 0)"],
      ];
      const p = palettes[i % palettes.length];
      g.addColorStop(0, p[0]);
      g.addColorStop(1, p[1]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    // Fine mottled regolith.
    for (let i = 0; i < 6200; i++) {
      const x = rng.range(0, w);
      const y = rng.range(0, h);
      const r = rng.range(0.5, 4.5);
      const bright = rng.next();
      ctx.fillStyle = bright > 0.65
        ? `rgba(91, 124, 114, ${rng.range(0.015, 0.07)})`
        : `rgba(1, 10, 13, ${rng.range(0.03, 0.15)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    // Sweeping dried riverbeds and dust lanes.
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const y0 = rng.range(90, h - 90);
      const y1 = y0 + rng.range(-120, 120);
      ctx.strokeStyle = i % 2 ? "rgba(73, 95, 81, .10)" : "rgba(31, 79, 70, .12)";
      ctx.lineWidth = rng.range(10, 34);
      ctx.beginPath();
      ctx.moveTo(-30, y0);
      ctx.bezierCurveTo(w * 0.25, y0 + rng.range(-120, 120), w * 0.65, y1 + rng.range(-100, 100), w + 30, y1);
      ctx.stroke();
    }
    ctx.restore();

    // Glowing tectonic fissures.
    for (let i = 0; i < 13; i++) {
      let x = rng.range(60, w - 60);
      let y = rng.range(60, h - 60);
      const points = [[x, y]];
      for (let j = 0; j < rng.int(2, 6); j++) {
        x += rng.range(-80, 80);
        y += rng.range(-55, 55);
        points.push([x, y]);
      }
      ctx.beginPath();
      points.forEach((p, idx) => (idx ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.strokeStyle = "rgba(40, 197, 191, .16)";
      ctx.lineWidth = rng.range(0.7, 1.8);
      ctx.stroke();
      ctx.strokeStyle = "rgba(127, 255, 238, .08)";
      ctx.lineWidth = rng.range(2.5, 5);
      ctx.stroke();
    }

    // Territory rings around both command nexuses.
    this.drawBasePad(ctx, 450 * S, 1100 * S, 172 * S, TEAM_DATA[0]);
    this.drawBasePad(ctx, 2750 * S, 1100 * S, 172 * S, TEAM_DATA[1]);
    this.drawBasePad(ctx, 1600 * S, 1100 * S, 105 * S, null, true);

    // Central ridge shadow.
    ctx.save();
    const rg = ctx.createRadialGradient(1600 * S, 1100 * S, 20, 1600 * S, 1100 * S, 440 * S);
    rg.addColorStop(0, "rgba(1, 9, 12, .28)");
    rg.addColorStop(0.7, "rgba(1, 9, 12, .10)");
    rg.addColorStop(1, "rgba(1, 9, 12, 0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Rock formations (blockers and visual landmarks).
    for (const rock of this.game.rocks) {
      if (!rock.r) continue;
      this.drawRock(ctx, rock, S);
    }

    // Small scattered boulders and crystal debris.
    for (let i = 0; i < 260; i++) {
      const x = rng.range(30, w - 30);
      const y = rng.range(30, h - 30);
      const r = rng.range(1.5, 8);
      if (r > 5) {
        ctx.fillStyle = "rgba(3, 10, 12, .55)";
        ctx.beginPath();
        ctx.ellipse(x + 2, y + 2, r * 0.9, r * 0.45, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = i % 5 === 0 ? "rgba(47, 99, 94, .35)" : "rgba(23, 43, 43, .5)";
      ctx.beginPath();
      ctx.moveTo(x - r, y + r * 0.4);
      ctx.lineTo(x - r * 0.3, y - r);
      ctx.lineTo(x + r * 0.8, y - r * 0.4);
      ctx.lineTo(x + r * 0.6, y + r * 0.7);
      ctx.closePath();
      ctx.fill();
    }

    // Faint survey grid near base pads.
    ctx.save();
    ctx.strokeStyle = "rgba(108, 223, 218, .045)";
    ctx.lineWidth = 0.65;
    for (let x = 0; x < w; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();

    // Vignette baked into terrain.
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.82);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,4,7,.42)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // Border beacons.
    ctx.strokeStyle = "rgba(85, 209, 210, .1)";
    ctx.lineWidth = 3;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.strokeStyle = "rgba(85, 209, 210, .05)";
    ctx.lineWidth = 12;
    ctx.strokeRect(13, 13, w - 26, h - 26);

    this.terrain = c;
    // Mini map underlay.
    const mini = document.createElement("canvas");
    mini.width = 256;
    mini.height = 176;
    const mctx = mini.getContext("2d");
    mctx.drawImage(c, 0, 0, mini.width, mini.height);
    mctx.fillStyle = "rgba(4, 17, 23, .28)";
    mctx.fillRect(0, 0, mini.width, mini.height);
    this.miniBase = mini;
    this.fogCanvas = null;
  }

  drawBasePad(ctx, x, y, r, team, neutral = false) {
    ctx.save();
    ctx.translate(x, y);
    const color = neutral ? "#789d91" : team.color;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.4);
    glow.addColorStop(0, neutral ? "rgba(117, 157, 143, .06)" : colorWithAlpha(color, 0.14));
    glow.addColorStop(0.6, neutral ? "rgba(117, 157, 143, .025)" : colorWithAlpha(color, 0.035));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = neutral ? "rgba(132, 165, 153, .12)" : colorWithAlpha(color, 0.18);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 11]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = neutral ? "rgba(132, 165, 153, .06)" : colorWithAlpha(color, 0.08);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.35 + i * 0.19), 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = neutral ? "rgba(132, 165, 153, .1)" : colorWithAlpha(color, 0.22);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      ctx.save();
      ctx.rotate(a);
      ctx.fillRect(r * 0.87, -1, neutral ? 3 : 6, 2);
      ctx.restore();
    }
    // Central landing cross.
    ctx.strokeStyle = neutral ? "rgba(132, 165, 153, .09)" : colorWithAlpha(color, 0.12);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.18, 0); ctx.lineTo(r * 0.18, 0);
    ctx.moveTo(0, -r * 0.18); ctx.lineTo(0, r * 0.18);
    ctx.stroke();
    ctx.restore();
  }

  drawRock(ctx, rock, scale) {
    const x = rock.x * scale;
    const y = rock.y * scale;
    const r = rock.r * scale;
    const rng = new RNG(Math.floor(rock.seed * 1000 + 1));
    const points = [];
    const count = 8;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      const rr = r * rng.range(0.72, 1.14);
      points.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.78]);
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(0, 5, 7, .58)";
    ctx.beginPath();
    ctx.ellipse(r * 0.22, r * 0.36, r * 1.04, r * 0.58, -0.12, 0, TAU);
    ctx.fill();

    const baseGrad = ctx.createLinearGradient(-r, -r, r, r);
    baseGrad.addColorStop(0, "#263f40");
    baseGrad.addColorStop(0.45, "#152c2d");
    baseGrad.addColorStop(1, "#071516");
    ctx.fillStyle = baseGrad;
    polygonPath(ctx, points);
    ctx.fill();
    ctx.strokeStyle = "rgba(2, 9, 11, .6)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Top facets.
    for (let i = 0; i < 4; i++) {
      const a1 = rng.range(0, TAU);
      const a2 = a1 + rng.range(0.6, 1.5);
      const rr = r * rng.range(0.2, 0.62);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a1) * rr, Math.sin(a1) * rr * 0.7);
      ctx.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr * 0.7);
      ctx.lineTo(rng.range(-r * 0.3, r * 0.3), rng.range(-r * 0.3, r * 0.3));
      ctx.closePath();
      ctx.fillStyle = `rgba(${rng.int(37, 63)}, ${rng.int(71, 92)}, ${rng.int(68, 83)}, ${rng.range(0.18, 0.38)})`;
      ctx.fill();
    }

    // Rim highlights.
    ctx.strokeStyle = "rgba(102, 154, 138, .14)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(-r * 0.12, -r * 0.2, r * 0.7, Math.PI * 1.05, Math.PI * 1.75);
    ctx.stroke();

    // Teal crystal flecks on some rocks.
    if (rng.next() > 0.45) {
      for (let i = 0; i < 3; i++) {
        const cx = rng.range(-r * 0.5, r * 0.5);
        const cy = rng.range(-r * 0.4, r * 0.4);
        ctx.fillStyle = "rgba(88, 236, 232, .30)";
        ctx.beginPath();
        ctx.moveTo(cx, cy - 4);
        ctx.lineTo(cx + 2.5, cy);
        ctx.lineTo(cx - 0.8, cy + 2.5);
        ctx.lineTo(cx - 3, cy - 0.8);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  render(dt) {
    this.time += dt;
    const ctx = this.ctx;
    const game = this.game;
    if (!this.terrain) this.buildTerrain();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#03090e";
    ctx.fillRect(0, 0, this.width, this.height);

    const cam = game.camera;
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    // World backdrop and terrain.
    ctx.drawImage(this.terrain, 0, 0, WORLD.width, WORLD.height);

    // Ambient drifting spores / dust.
    this.drawDust(ctx, cam);

    // Ground-level order markers and selection rings.
    this.drawEffects(ctx, game.effects, "ground");
    for (const e of game.selectedEntities) if (e.kind === "unit") this.drawSelectionRing(ctx, e);
    this.drawBuildGhost(ctx);

    // Resource patches.
    for (const r of game.resources) this.drawCrystal(ctx, r);

    // Buildings and units, with structures behind mobile units.
    for (const b of game.buildings) {
      if (!b.alive) continue;
      if (b.team === TEAM.ENEMY && !game.isVisibleAt(b.x, b.y)) continue;
      this.drawBuilding(ctx, b);
    }

    const visibleUnits = game.units.filter((u) => u.alive && (u.team !== TEAM.ENEMY || game.isVisibleAt(u.x, u.y)));
    visibleUnits.sort((a, b) => a.y - b.y);
    for (const u of visibleUnits) this.drawUnit(ctx, u);

    // Projectiles and active effects.
    for (const p of game.projectiles) {
      if (p.team === TEAM.ENEMY && !game.isVisibleAt(p.x, p.y)) continue;
      this.drawProjectile(ctx, p);
    }
    this.drawEffects(ctx, game.effects, "air");

    // Health bars on top.
    for (const u of visibleUnits) this.drawUnitHealth(ctx, u);
    for (const b of game.buildings) {
      if (!b.alive) continue;
      if (b.team === TEAM.ENEMY && !game.isVisibleAt(b.x, b.y)) continue;
      this.drawBuildingHealth(ctx, b);
    }
    // Ensure the fog layer is generated before the minimap uses it.
    if (game.state !== "menu" && this.fogVersion !== game.fog.version) this.updateFogCanvas();

    this.drawFog(ctx);

    // Range rings when a single combat unit/building is selected.
    const primary = game.primarySelection;
    if (primary && primary.team === TEAM.PLAYER) this.drawRangeRing(ctx, primary);

    ctx.restore();

    this.drawSelectionBox(ctx);
    this.drawScreenHud(ctx);
    this.drawMinimap(dt);
    this.drawPortrait(dt);
  }

  drawDust(ctx, cam) {
    const t = this.time;
    ctx.save();
    for (let i = 0; i < 24; i++) {
      const s = this.stars[i % this.stars.length];
      const x = ((s.x * WORLD.width + t * (4 + s.s * 3)) % WORLD.width);
      const y = (s.y * WORLD.height + Math.sin(t * 0.25 + s.p) * 20) % WORLD.height;
      const inView = Math.abs(x - cam.x) < this.width / cam.zoom / 2 + 30 && Math.abs(y - cam.y) < this.height / cam.zoom / 2 + 30;
      if (!inView) continue;
      ctx.fillStyle = `rgba(153, 238, 230, ${s.a * 0.28})`;
      ctx.beginPath();
      ctx.arc(x, y, s.s * 0.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFog(ctx) {
    const game = this.game;
    if (game.state === "menu" || !game.fog?.visible) return;
    if (!this.fogCanvas || this.fogVersion !== game.fog.version) {
      this.updateFogCanvas();
    }
    if (!this.fogCanvas) return;
    const previous = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, 0, 0, WORLD.width, WORLD.height);
    ctx.imageSmoothingEnabled = previous;
  }

  updateFogCanvas() {
    const fog = this.game.fog;
    if (!fog?.cols) return;
    if (!this.fogCanvas || this.fogCanvas.width !== fog.cols) {
      this.fogCanvas = document.createElement("canvas");
      this.fogCanvas.width = fog.cols;
      this.fogCanvas.height = fog.rows;
    }
    const fctx = this.fogCanvas.getContext("2d");
    const img = fctx.createImageData(fog.cols, fog.rows);
    const data = img.data;
    for (let y = 0; y < fog.rows; y++) {
      for (let x = 0; x < fog.cols; x++) {
        const i = y * fog.cols + x;
        const o = i * 4;
        const edge = Math.min(1, Math.min(x, y, fog.cols - 1 - x, fog.rows - 1 - y) / 4);
        if (fog.visible[i]) {
          data[o + 3] = 0;
        } else if (fog.explored[i]) {
          data[o] = 2; data[o + 1] = 10; data[o + 2] = 15;
          data[o + 3] = Math.floor(140 + (1 - edge) * 25);
        } else {
          data[o] = 1; data[o + 1] = 5; data[o + 2] = 8;
          data[o + 3] = Math.floor(226 + (1 - edge) * 20);
        }
      }
    }
    fctx.putImageData(img, 0, 0);
    this.fogVersion = fog.version;
  }

  drawCrystal(ctx, r) {
    const t = this.time;
    const ratio = clamp(r.amount / r.maxAmount, 0, 1);
    const rng = new RNG(Math.floor(r.seed * 97 + 3));
    const base = r.y;
    ctx.save();
    ctx.translate(r.x, r.y);
    const pulse = 0.65 + Math.sin(t * 1.8 + r.seed) * 0.15;
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 42 + ratio * 10);
    glow.addColorStop(0, `rgba(94, 240, 255, ${0.20 + pulse * 0.08})`);
    glow.addColorStop(0.5, "rgba(44, 170, 190, .08)");
    glow.addColorStop(1, "rgba(24, 102, 120, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 52, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(0, 5, 8, .52)";
    ctx.beginPath();
    ctx.ellipse(2, 10, 20, 9, 0.2, 0, TAU);
    ctx.fill();

    const shards = 7;
    for (let i = 0; i < shards; i++) {
      if (i / shards > ratio + 0.28) continue;
      const a = (i / shards) * TAU + rng.range(-0.25, 0.25);
      const rr = rng.range(6, 17);
      const sx = Math.cos(a) * rr;
      const sy = Math.sin(a) * rr * 0.55 + 2;
      const height = rng.range(12, 27) * (0.55 + ratio * 0.45);
      const width = rng.range(3.5, 7);
      const lean = rng.range(-0.3, 0.3);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(lean);
      ctx.shadowColor = "rgba(94, 242, 255, .8)";
      ctx.shadowBlur = 8;
      const g = ctx.createLinearGradient(0, -height, 0, 6);
      g.addColorStop(0, "#e1ffff");
      g.addColorStop(0.35, "#84f5ff");
      g.addColorStop(0.75, "#25a9c3");
      g.addColorStop(1, "#0b4a61");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -height);
      ctx.lineTo(width, -height * 0.22);
      ctx.lineTo(width * 0.45, 6);
      ctx.lineTo(-width * 0.65, 4);
      ctx.lineTo(-width, -height * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(218, 255, 255, .55)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(0, -height + 2);
      ctx.lineTo(width * 0.15, -height * 0.25);
      ctx.stroke();
      ctx.restore();
    }
    // Tiny sparks.
    for (let i = 0; i < 2; i++) {
      const a = t * (0.4 + i * 0.2) + i * 2.4 + r.seed;
      ctx.fillStyle = "rgba(180, 252, 255, .55)";
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 20, Math.sin(a * 1.3) * 10 - 8, 0.9, 0, TAU);
      ctx.fill();
    }
    // Depletion bar under shards.
    if (ratio < 0.99) {
      ctx.fillStyle = "rgba(0, 6, 9, .7)";
      ctx.fillRect(-16, 18, 32, 2);
      ctx.fillStyle = "rgba(111, 239, 255, .7)";
      ctx.fillRect(-16, 18, 32 * ratio, 2);
    }
    ctx.restore();
  }

  drawSelectionRing(ctx, e) {
    const t = this.time;
    const color = e.team === TEAM.PLAYER ? "#74f3ff" : "#ff6a79";
    ctx.save();
    ctx.translate(e.x, e.y + e.radius * 0.42);
    ctx.rotate(t * 0.55);
    ctx.strokeStyle = colorWithAlpha(color, 0.85);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * TAU;
      const a1 = a0 + 0.62;
      ctx.arc(0, 0, e.radius + 10, a0, a1);
    }
    ctx.stroke();
    ctx.rotate(-t * 0.9);
    ctx.strokeStyle = colorWithAlpha(color, 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, e.radius + 15, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawBuildGhost(ctx) {
    const game = this.game;
    if (!game.buildMode) return;
    const type = game.buildMode.type;
    const def = BUILDING_TYPES[type];
    const x = game.pointer.worldX;
    const y = game.pointer.worldY;
    const valid = game.canPlaceBuilding(type, x, y, TEAM.PLAYER);
    game.buildMode.valid = valid;
    const color = valid ? "#78f4ff" : "#ff4f62";
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = color;
    ctx.fillStyle = colorWithAlpha(color, 0.12);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(x, y, def.radius + 18, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, def.radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    hexPath(ctx, x, y, def.radius * 0.7, Math.PI / 6);
    ctx.stroke();
    ctx.setLineDash([3, 8]);
    ctx.beginPath();
    ctx.moveTo(x - def.radius - 20, y);
    ctx.lineTo(x + def.radius + 20, y);
    ctx.moveTo(x, y - def.radius - 20);
    ctx.lineTo(x, y + def.radius + 20);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawRangeRing(ctx, e) {
    const atk = e.attack;
    if (!atk) return;
    ctx.save();
    ctx.strokeStyle = "rgba(113, 239, 255, .16)";
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, atk.range, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawUnit(ctx, u) {
    const def = UNIT_TYPES[u.type];
    if (!def) return;
    const bob = u.wasMoving ? Math.sin(u.walkCycle) * 1.7 : Math.sin(this.time * 1.4 + u.walkCycle) * 0.6;
    ctx.save();
    ctx.translate(u.x, u.y);
    // Drop shadow.
    ctx.fillStyle = "rgba(0, 4, 7, .50)";
    ctx.beginPath();
    ctx.ellipse(2, u.radius * 0.65, u.radius * 1.15, u.radius * 0.58, 0, 0, TAU);
    ctx.fill();
    ctx.translate(0, bob);
    ctx.rotate(u.angle);
    const scale = 1;
    ctx.scale(scale, scale);
    if (u.hitFlash > 0) {
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 8;
    }
    if (def.shape === "worker") this.drawWorkerShape(ctx, u);
    else if (def.shape === "trooper") this.drawTrooperShape(ctx, u);
    else if (def.shape === "lancer") this.drawLancerShape(ctx, u);
    else if (def.shape === "juggernaut") this.drawJuggernautShape(ctx, u);
    ctx.restore();
  }

  unitPalette(team) {
    return team === TEAM.PLAYER
      ? { main: "#183f4b", light: "#2d7582", accent: "#6df4ff", glow: "rgba(97,243,255,.75)", dark: "#07191f", metal: "#6f8d94" }
      : { main: "#4a1c26", light: "#82303c", accent: "#ff5d6c", glow: "rgba(255,93,108,.7)", dark: "#1c080d", metal: "#9a7274" };
  }

  drawWorkerShape(ctx, u) {
    const p = this.unitPalette(u.team);
    const arms = Math.sin(u.walkCycle) * 0.12;
    // Lower hover ring.
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 6, 12, 5, 0, 0, TAU);
    ctx.stroke();
    // Arms.
    ctx.fillStyle = p.dark;
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.35);
    ctx.lineWidth = 1;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.rotate(side * (0.32 + arms * side));
      ctx.fillStyle = p.main;
      ctx.fillRect(3, side * 8 - 2, 13, 4);
      ctx.fillStyle = p.accent;
      ctx.fillRect(14, side * 8 - 1, 4, 2);
      ctx.restore();
    }
    // Core body.
    const g = ctx.createRadialGradient(-3, -4, 1, 0, 0, 15);
    g.addColorStop(0, p.light);
    g.addColorStop(0.65, p.main);
    g.addColorStop(1, p.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 10, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
    // Cockpit visor.
    ctx.fillStyle = p.accent;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.ellipse(5, 0, 3.5, 5, 0, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Center crystal if carrying.
    if (u.carrying > 0) {
      ctx.fillStyle = "#a4f8ff";
      ctx.shadowColor = "#61f2ff";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(-12, -6);
      ctx.lineTo(-9, 0);
      ctx.lineTo(-12, 7);
      ctx.lineTo(-16, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  drawTrooperShape(ctx, u) {
    const p = this.unitPalette(u.team);
    const step = Math.sin(u.walkCycle) * 2.2;
    // Legs.
    ctx.fillStyle = p.dark;
    ctx.fillRect(-4, -7, 9, 4);
    ctx.fillRect(-4, 3, 9, 4);
    ctx.fillStyle = p.main;
    ctx.fillRect(-8 + step * 0.4, -7, 5, 4);
    ctx.fillRect(-8 - step * 0.4, 3, 5, 4);
    // Body.
    const g = ctx.createLinearGradient(-10, -10, 10, 10);
    g.addColorStop(0, p.light);
    g.addColorStop(0.55, p.main);
    g.addColorStop(1, p.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.lineTo(5, -7);
    ctx.lineTo(9, 0);
    ctx.lineTo(5, 7);
    ctx.lineTo(-8, 8);
    ctx.lineTo(-11, 0);
    ctx.closePath();
    ctx.fill();
    // Shoulder pads.
    ctx.fillStyle = p.light;
    ctx.beginPath();
    ctx.ellipse(1, -7.5, 4, 2.4, 0.2, 0, TAU);
    ctx.ellipse(1, 7.5, 4, 2.4, -0.2, 0, TAU);
    ctx.fill();
    // Helmet.
    ctx.fillStyle = p.dark;
    ctx.beginPath();
    ctx.arc(3, 0, 5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.ellipse(2, 0, 2.4, 3.6, 0, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Rifle.
    ctx.fillStyle = p.metal;
    ctx.fillRect(4, 4, 14, 2.5);
    ctx.fillStyle = p.accent;
    ctx.fillRect(17, 4.2, 4, 2);
    // Team stripe.
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.75);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-7, -2);
    ctx.lineTo(-7, 2);
    ctx.stroke();
  }

  drawLancerShape(ctx, u) {
    const p = this.unitPalette(u.team);
    const step = Math.sin(u.walkCycle) * 2;
    ctx.fillStyle = p.dark;
    ctx.fillRect(-6, -9, 11, 5);
    ctx.fillRect(-6, 4, 11, 5);
    ctx.fillStyle = p.main;
    ctx.fillRect(-11 + step * 0.3, -9, 6, 5);
    ctx.fillRect(-11 - step * 0.3, 4, 6, 5);
    const g = ctx.createLinearGradient(-12, -11, 11, 11);
    g.addColorStop(0, p.light);
    g.addColorStop(0.5, p.main);
    g.addColorStop(1, p.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-10, -10);
    ctx.lineTo(6, -9);
    ctx.lineTo(11, 0);
    ctx.lineTo(6, 9);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-13, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.3);
    ctx.lineWidth = 1;
    ctx.stroke();
    // Heavy shoulder pod.
    ctx.fillStyle = p.light;
    ctx.beginPath();
    ctx.roundRect(-2, -12, 9, 5, 2);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 5;
    ctx.fillRect(3, -10.5, 3, 2);
    ctx.shadowBlur = 0;
    // Helmet.
    ctx.fillStyle = p.dark;
    ctx.beginPath();
    ctx.arc(4, 0, 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.ellipse(3, 0, 2.8, 4.2, 0, 0, TAU);
    ctx.fill();
    // Plasma lance.
    ctx.fillStyle = p.metal;
    ctx.fillRect(4, 7, 18, 3);
    const lg = ctx.createLinearGradient(18, 0, 25, 0);
    lg.addColorStop(0, p.accent);
    lg.addColorStop(1, "#ffffff");
    ctx.fillStyle = lg;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 7;
    ctx.fillRect(19, 7.4, 6, 2.2);
    ctx.shadowBlur = 0;
  }

  drawJuggernautShape(ctx, u) {
    const p = this.unitPalette(u.team);
    const step = Math.sin(u.walkCycle) * 2.4;
    // Four legs.
    ctx.strokeStyle = p.dark;
    ctx.lineWidth = 3.4;
    for (const [sx, sy, phase] of [[-7, -10, 0], [8, -10, 1], [-7, 10, 1], [8, 10, 0]]) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      const off = Math.sin(u.walkCycle + phase * Math.PI) * 2.2;
      ctx.lineTo(sx + 4 + off, sy + (sy < 0 ? -8 : 8));
      ctx.lineTo(sx + 9 + off, sy + (sy < 0 ? -11 : 11));
      ctx.stroke();
    }
    // Hull.
    const g = ctx.createLinearGradient(-16, -13, 16, 13);
    g.addColorStop(0, p.light);
    g.addColorStop(0.55, p.main);
    g.addColorStop(1, p.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-15, -11);
    ctx.lineTo(8, -12);
    ctx.lineTo(15, -4);
    ctx.lineTo(15, 4);
    ctx.lineTo(8, 12);
    ctx.lineTo(-15, 11);
    ctx.lineTo(-18, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.32);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Armor plates.
    ctx.fillStyle = colorWithAlpha(p.accent, 0.18);
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.lineTo(3, -8);
    ctx.lineTo(6, 0);
    ctx.lineTo(3, 8);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    // Cockpit.
    ctx.fillStyle = p.dark;
    ctx.beginPath();
    ctx.arc(2, 0, 5.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.ellipse(2, 0, 2.6, 4, 0, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Main cannon.
    ctx.fillStyle = p.metal;
    ctx.fillRect(7, -3.2, 20, 3.8);
    ctx.fillRect(24, -2.2, 6, 1.8);
    ctx.fillStyle = p.accent;
    ctx.fillRect(27, -1.8, 3, 1);
    // Side vents.
    ctx.fillStyle = colorWithAlpha(p.accent, 0.45);
    for (let i = 0; i < 3; i++) ctx.fillRect(-12 + i * 3, 4.5, 1.4, 3);
  }

  drawBuilding(ctx, b) {
    const def = BUILDING_TYPES[b.type];
    if (!def) return;
    const t = this.time;
    const p = b.team === TEAM.PLAYER
      ? { main: "#163c47", light: "#34717a", accent: "#67f1ff", dark: "#06171d", glow: "rgba(99,241,255,.6)", deck: "#0a252e" }
      : { main: "#481b26", light: "#83323e", accent: "#ff5d6c", dark: "#1b080d", glow: "rgba(255,93,108,.55)", deck: "#2c0e15" };
    const progress = b.completed ? 1 : b.buildProgress;
    ctx.save();
    ctx.translate(b.x, b.y);
    // Ground shadow.
    ctx.fillStyle = "rgba(0,4,7,.62)";
    ctx.beginPath();
    ctx.ellipse(4, b.radius * 0.42, b.radius * 1.12, b.radius * 0.68, 0, 0, TAU);
    ctx.fill();
    // Foundation pad.
    ctx.fillStyle = "rgba(5, 17, 21, .8)";
    hexPath(ctx, 0, 2, b.radius + 9, Math.PI / 6);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, b.completed ? 0.25 : 0.14);
    ctx.lineWidth = 1.4;
    hexPath(ctx, 0, 2, b.radius + 9, Math.PI / 6);
    ctx.stroke();
    if (b.selected) {
      ctx.strokeStyle = colorWithAlpha(p.accent, 0.75);
      ctx.lineWidth = 1.6;
      ctx.setLineDash([9, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, b.radius + 20, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = b.completed ? 1 : 0.42 + progress * 0.58;
    if (def.shape === "nexus") this.drawNexus(ctx, b, p, t, progress);
    else if (def.shape === "barracks") this.drawBarracks(ctx, b, p, t);
    else if (def.shape === "habitat") this.drawHabitat(ctx, b, p, t);
    else if (def.shape === "foundry") this.drawFoundry(ctx, b, p, t);
    else if (def.shape === "turret") this.drawTurret(ctx, b, p, t);
    ctx.globalAlpha = 1;

    if (!b.completed) {
      // Scaffolding overlay.
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = colorWithAlpha("#ffd58f", 0.55);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, b.radius + 3, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(t * 0.3);
      ctx.strokeStyle = "rgba(255, 205, 120, .3)";
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(b.radius * 0.4, 0);
        ctx.lineTo(b.radius + 5, 0);
        ctx.stroke();
      }
      ctx.restore();
      // Progress bar.
      ctx.fillStyle = "rgba(1, 7, 10, .8)";
      ctx.fillRect(-b.radius, b.radius + 19, b.radius * 2, 4);
      ctx.fillStyle = "#ffd27c";
      ctx.fillRect(-b.radius, b.radius + 19, b.radius * 2 * progress, 4);
    }
    ctx.restore();
  }

  drawNexus(ctx, b, p, t, progress) {
    const r = b.radius * (0.75 + progress * 0.25);
    // Outer deck.
    ctx.fillStyle = p.deck;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.35);
    ctx.lineWidth = 2;
    ctx.stroke();
    // Rotating ring.
    ctx.save();
    ctx.rotate(t * 0.12);
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.55);
    ctx.lineWidth = 2.2;
    ctx.setLineDash([11, 9]);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.84, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.fillStyle = colorWithAlpha(p.accent, i % 2 ? 0.8 : 0.35);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84, i % 2 ? 2.3 : 1.3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // Struts.
    ctx.strokeStyle = p.light;
    ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.28, Math.sin(a) * r * 0.28);
      ctx.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
      ctx.stroke();
    }
    // Main tower.
    const g = ctx.createRadialGradient(-6, -8, 2, 0, 0, r * 0.55);
    g.addColorStop(0, p.light);
    g.addColorStop(0.5, p.main);
    g.addColorStop(1, p.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.32);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Central crystal.
    const pulse = 0.65 + Math.sin(t * 2.2) * 0.2;
    ctx.save();
    ctx.rotate(-t * 0.3);
    ctx.fillStyle = p.accent;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 18 * pulse;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.3);
    ctx.lineTo(r * 0.12, -r * 0.06);
    ctx.lineTo(0, r * 0.24);
    ctx.lineTo(-r * 0.12, -r * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,.65)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    // Pulsing beacons.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const blink = 0.35 + Math.max(0, Math.sin(t * 3 + i)) * 0.65;
      ctx.fillStyle = colorWithAlpha(p.accent, blink);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.65, Math.sin(a) * r * 0.65, 2.2, 0, TAU);
      ctx.fill();
    }
    // Core ridge lines.
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.15);
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.18 + i * 0.08), 0, TAU);
      ctx.stroke();
    }
  }

  drawBarracks(ctx, b, p, t) {
    const r = b.radius;
    // Rear modules.
    ctx.fillStyle = p.dark;
    ctx.fillRect(-r * 0.75, -r * 0.64, r * 0.45, r * 0.48);
    ctx.fillRect(-r * 0.75, r * 0.16, r * 0.45, r * 0.48);
    // Main hull.
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, p.light);
    g.addColorStop(0.52, p.main);
    g.addColorStop(1, p.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-r * 0.78, -r * 0.7);
    ctx.lineTo(r * 0.52, -r * 0.7);
    ctx.lineTo(r * 0.82, -r * 0.34);
    ctx.lineTo(r * 0.82, r * 0.34);
    ctx.lineTo(r * 0.52, r * 0.7);
    ctx.lineTo(-r * 0.78, r * 0.7);
    ctx.lineTo(-r * 0.92, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.3);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // Roof panels.
    ctx.fillStyle = "rgba(1, 12, 16, .3)";
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(-r * 0.55, i * r * 0.3 - r * 0.08, r * 0.95, r * 0.16);
    }
    // Landing pad / door at front.
    ctx.fillStyle = p.deck;
    ctx.beginPath();
    ctx.roundRect(r * 0.55, -r * 0.46, r * 0.24, r * 0.92, 3);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.55);
    ctx.stroke();
    ctx.fillStyle = colorWithAlpha(p.accent, 0.75);
    ctx.fillRect(r * 0.78, -r * 0.38, r * 0.05, r * 0.76);
    // Antennae.
    ctx.strokeStyle = p.metal || "#7e9ba0";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, -r * 0.4);
    ctx.lineTo(-r * 0.55, -r * 1.15);
    ctx.moveTo(-r * 0.2, -r * 0.5);
    ctx.lineTo(-r * 0.2, -r * 0.95);
    ctx.stroke();
    const blink = 0.35 + Math.max(0, Math.sin(t * 3.4)) * 0.65;
    ctx.fillStyle = colorWithAlpha(p.accent, blink);
    ctx.beginPath();
    ctx.arc(-r * 0.55, -r * 1.15, 2, 0, TAU);
    ctx.fill();
    // Team chevron.
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, -r * 0.15);
    ctx.lineTo(-r * 0.12, 0);
    ctx.lineTo(-r * 0.35, r * 0.15);
    ctx.stroke();
  }

  drawHabitat(ctx, b, p, t) {
    const r = b.radius;
    // Three linked domes.
    const offsets = [[-r * 0.42, -r * 0.16], [r * 0.3, -r * 0.2], [-r * 0.02, r * 0.4]];
    for (let i = 0; i < offsets.length; i++) {
      const [x, y] = offsets[i];
      const rr = r * (i === 2 ? 0.42 : 0.5);
      const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.4, 2, x, y, rr);
      g.addColorStop(0, p.light);
      g.addColorStop(0.6, p.main);
      g.addColorStop(1, p.dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = colorWithAlpha(p.accent, 0.3);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.strokeStyle = colorWithAlpha(p.accent, 0.18);
      ctx.beginPath();
      ctx.arc(x, y, rr * 0.58, 0, TAU);
      ctx.stroke();
      // Window slits.
      for (let j = 0; j < 3; j++) {
        const a = t * 0.1 + (j / 3) * TAU + i;
        ctx.fillStyle = colorWithAlpha(p.accent, 0.6);
        ctx.fillRect(x + Math.cos(a) * rr * 0.7, y + Math.sin(a) * rr * 0.7, 1.7, 1.7);
      }
    }
    // Linking corridors.
    ctx.strokeStyle = p.light;
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.moveTo(offsets[0][0], offsets[0][1]);
    ctx.lineTo(offsets[1][0], offsets[1][1]);
    ctx.lineTo(offsets[2][0], offsets[2][1]);
    ctx.stroke();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.3);
    ctx.lineWidth = 1;
    ctx.stroke();
    // Supply beacon.
    ctx.fillStyle = p.accent;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(r * 0.2, -r * 0.22, 2, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawFoundry(ctx, b, p, t) {
    const r = b.radius;
    // Main industrial block.
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, p.light);
    g.addColorStop(0.55, p.main);
    g.addColorStop(1, p.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-r * 0.82, -r * 0.66, r * 1.58, r * 1.32, 5);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.3);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // Smokestacks.
    ctx.fillStyle = p.dark;
    for (const sx of [-r * 0.5, -r * 0.2]) {
      ctx.beginPath();
      ctx.roundRect(sx - 4, -r * 1.15, 8, r * 0.55, 3);
      ctx.fill();
    }
    // Vents / furnace glow.
    const flick = 0.55 + Math.sin(t * 7) * 0.15;
    ctx.fillStyle = colorWithAlpha("#ff9c53", flick);
    ctx.shadowColor = "rgba(255,132,68,.7)";
    ctx.shadowBlur = 8;
    for (let i = 0; i < 3; i++) ctx.fillRect(-r * 0.62 + i * 12, r * 0.2, 5, 5);
    ctx.shadowBlur = 0;
    // Gantry.
    ctx.strokeStyle = p.metal || "#7d9aa0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, r * 0.06);
    ctx.lineTo(-r * 0.55, r * 0.6);
    ctx.lineTo(r * 0.75, r * 0.6);
    ctx.stroke();
    // Assembly bay.
    ctx.fillStyle = p.deck;
    ctx.beginPath();
    ctx.roundRect(r * 0.38, -r * 0.52, r * 0.42, r * 0.92, 3);
    ctx.fill();
    ctx.fillStyle = colorWithAlpha(p.accent, 0.75);
    ctx.fillRect(r * 0.56, -r * 0.48, 2, r * 0.8);
    // Warning stripes.
    ctx.fillStyle = "rgba(255, 186, 84, .5)";
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.translate(-r * 0.75 + i * 8, r * 0.48);
      ctx.rotate(-0.4);
      ctx.fillRect(0, 0, 2.5, 7);
      ctx.restore();
    }
    // Smoke wisps.
    for (let i = 0; i < 3; i++) {
      const phase = (t * 0.25 + i * 0.33) % 1;
      ctx.fillStyle = `rgba(127, 145, 139, ${0.13 * (1 - phase)})`;
      ctx.beginPath();
      ctx.arc(-r * 0.35 + Math.sin(t + i) * 4, -r * 1.15 - phase * 28, 5 + phase * 8, 0, TAU);
      ctx.fill();
    }
  }

  drawTurret(ctx, b, p, t) {
    const r = b.radius;
    // Base.
    ctx.fillStyle = p.dark;
    hexPath(ctx, 0, 0, r + 3, Math.PI / 6);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.35);
    ctx.lineWidth = 1.2;
    hexPath(ctx, 0, 0, r + 3, Math.PI / 6);
    ctx.stroke();
    const g = ctx.createRadialGradient(-3, -4, 1, 0, 0, r * 0.8);
    g.addColorStop(0, p.light);
    g.addColorStop(1, p.main);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, TAU);
    ctx.fill();
    // Rotating gun housing.
    ctx.save();
    ctx.rotate(b.turretAngle);
    ctx.fillStyle = p.main;
    ctx.beginPath();
    ctx.roundRect(-r * 0.45, -r * 0.45, r * 0.95, r * 0.9, 4);
    ctx.fill();
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.4);
    ctx.stroke();
    ctx.fillStyle = p.dark;
    ctx.fillRect(r * 0.28, -r * 0.28, r * 0.9, r * 0.2);
    ctx.fillRect(r * 0.28, r * 0.08, r * 0.9, r * 0.2);
    ctx.fillStyle = p.accent;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 5;
    ctx.fillRect(r * 1.12, -r * 0.27, r * 0.15, r * 0.17);
    ctx.fillRect(r * 1.12, r * 0.09, r * 0.15, r * 0.17);
    ctx.shadowBlur = 0;
    ctx.fillStyle = p.light;
    ctx.beginPath();
    ctx.arc(-r * 0.1, 0, r * 0.22, 0, TAU);
    ctx.fill();
    ctx.restore();
    // Beacon.
    ctx.fillStyle = colorWithAlpha(p.accent, 0.5 + Math.sin(t * 3) * 0.3);
    ctx.beginPath();
    ctx.arc(-r * 0.45, -r * 0.55, 1.8, 0, TAU);
    ctx.fill();
  }

  drawUnitHealth(ctx, u) {
    if (!u.alive) return;
    const show = u.team === TEAM.PLAYER || u.selected || u.hitFlash > 0 || this.game.isVisibleAt(u.x, u.y);
    if (!show) return;
    const ratio = clamp(u.hp / u.maxHp, 0, 1);
    const damaged = ratio < 0.999;
    if (!damaged && !u.selected) return;
    const w = Math.max(22, u.radius * 2.1);
    const y = u.y - u.radius - 15;
    ctx.save();
    ctx.fillStyle = "rgba(1,7,10,.78)";
    ctx.fillRect(u.x - w / 2 - 1, y - 1, w + 2, 4.5);
    ctx.fillStyle = u.team === TEAM.PLAYER ? (ratio < 0.3 ? "#ff7a56" : "#77ffbd") : "#ff5b67";
    ctx.fillRect(u.x - w / 2, y, w * ratio, 2.5);
    if (u.isWorker && u.carrying > 0) {
      ctx.fillStyle = "#9af9ff";
      ctx.fillRect(u.x + w / 2 + 3, y - 1, 2.5, 4.5);
    }
    ctx.restore();
  }

  drawBuildingHealth(ctx, b) {
    if (!b.alive) return;
    const ratio = clamp(b.hp / b.maxHp, 0, 1);
    if (!b.selected && ratio >= 0.999 && b.completed) return;
    const w = Math.max(44, b.radius * 1.8);
    const y = b.y - b.radius - 18;
    ctx.save();
    ctx.fillStyle = "rgba(1,7,10,.8)";
    ctx.fillRect(b.x - w / 2 - 1, y - 1, w + 2, 5.5);
    ctx.fillStyle = b.team === TEAM.PLAYER ? (ratio < 0.3 ? "#ff7a56" : "#7dfffc") : "#ff5b67";
    ctx.fillRect(b.x - w / 2, y, w * ratio, 3.5);
    if (!b.completed) {
      ctx.fillStyle = "rgba(255, 209, 124, .9)";
      ctx.fillRect(b.x - w / 2, y + 5, w * b.buildProgress, 1.4);
    }
    if (b.queue.length) {
      const item = b.queue[0];
      const wr = clamp(item.progress / item.total, 0, 1);
      ctx.fillStyle = "rgba(255, 197, 100, .8)";
      ctx.fillRect(b.x - w / 2, y + 7, w * wr, 1.2);
    }
    ctx.restore();
  }

  drawProjectile(ctx, p) {
    const speed = Math.hypot(p.targetX - p.x, p.targetY - p.y) || 1;
    const dx = (p.targetX - p.x) / speed;
    const dy = (p.targetY - p.y) / speed;
    ctx.save();
    ctx.strokeStyle = p.sub === "shell" ? "rgba(255, 193, 102, .7)" : colorWithAlpha(p.color, 0.65);
    ctx.lineWidth = p.sub === "shell" ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(p.x - dx * (p.sub === "shell" ? 8 : 16), p.y - dy * (p.sub === "shell" ? 8 : 16));
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.sub === "shell" ? 12 : 7;
    ctx.fillStyle = p.sub === "shell" ? "#ffd08b" : "#e6feff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.sub === "shell" ? 3.2 : 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawEffects(ctx, effects, layer) {
    const groundTypes = new Set(["order", "shockwave", "buildSpark"]);
    for (const e of effects) {
      const isGround = groundTypes.has(e.type);
      if (layer === "ground" && !isGround) continue;
      if (layer === "air" && isGround) continue;
      const a = clamp(e.life / e.maxLife, 0, 1);
      if (e.type === "order") {
        const grow = 1 - a;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.strokeStyle = colorWithAlpha(e.color, a * 0.8);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, e.size * (0.5 + grow * 0.8), 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-e.size, 0); ctx.lineTo(-e.size * 0.35, 0);
        ctx.moveTo(e.size * 0.35, 0); ctx.lineTo(e.size, 0);
        ctx.moveTo(0, -e.size); ctx.lineTo(0, -e.size * 0.35);
        ctx.moveTo(0, e.size * 0.35); ctx.lineTo(0, e.size);
        ctx.stroke();
        if (e.sub === "attack") {
          ctx.beginPath();
          ctx.arc(0, 0, e.size * 0.45, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      } else if (e.type === "muzzle") {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.angle);
        ctx.fillStyle = colorWithAlpha(e.color, a);
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(0, -e.size * 0.5);
        ctx.lineTo(e.size * 1.8, 0);
        ctx.lineTo(0, e.size * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (e.type === "beam") {
        const grad = ctx.createLinearGradient(e.x, e.y, e.x2, e.y2);
        grad.addColorStop(0, colorWithAlpha(e.color, a * 0.85));
        grad.addColorStop(1, colorWithAlpha(e.color, a * 0.1));
        ctx.strokeStyle = grad;
        ctx.lineWidth = e.width || 2;
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x2, e.y2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (e.type === "deposit") {
        ctx.save();
        ctx.font = "600 12px Bahnschrift, sans-serif";
        ctx.fillStyle = colorWithAlpha(e.color, a);
        ctx.textAlign = "center";
        ctx.fillText(e.text, e.x, e.y - (1 - a) * 16);
        ctx.restore();
      } else if (e.type === "particle" || e.type === "buildSpark") {
        ctx.fillStyle = colorWithAlpha(e.color, a);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * (0.5 + a * 0.5), 0, TAU);
        ctx.fill();
      } else if (e.type === "smoke") {
        ctx.fillStyle = colorWithAlpha(e.color, a * 0.22);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size, 0, TAU);
        ctx.fill();
      } else if (e.type === "shockwave") {
        const grow = 1 - a;
        ctx.strokeStyle = colorWithAlpha(e.color, a * 0.6);
        ctx.lineWidth = 1.5 + a * 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * (0.3 + grow * 1.3), 0, TAU);
        ctx.stroke();
      } else if (e.type === "explosion") {
        const grow = 1 - a;
        const radius = e.size * (0.25 + grow * 0.95);
        const gr = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, radius);
        gr.addColorStop(0, `rgba(255, 250, 210, ${a * 0.9})`);
        gr.addColorStop(0.22, `rgba(255, 196, 89, ${a * 0.78})`);
        gr.addColorStop(0.55, colorWithAlpha(e.color, a * 0.4));
        gr.addColorStop(1, "rgba(20, 20, 20, 0)");
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(e.x, e.y, radius, 0, TAU);
        ctx.fill();
        // A few radial streaks.
        ctx.strokeStyle = `rgba(255, 236, 183, ${a * 0.5})`;
        ctx.lineWidth = 1.3;
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * TAU + e.x * 0.01;
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(ang) * radius * 0.3, e.y + Math.sin(ang) * radius * 0.3);
          ctx.lineTo(e.x + Math.cos(ang) * radius * 1.4, e.y + Math.sin(ang) * radius * 1.4);
          ctx.stroke();
        }
      }
    }
  }

  drawSelectionBox(ctx) {
    const box = this.game.selectionBox;
    if (!box) return;
    const x = Math.min(box.x1, box.x2);
    const y = Math.min(box.y1, box.y2);
    const w = Math.abs(box.x2 - box.x1);
    const h = Math.abs(box.y2 - box.y1);
    if (w < 3 || h < 3) return;
    ctx.save();
    ctx.fillStyle = "rgba(92, 236, 255, .07)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(121, 247, 255, .9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(219, 255, 255, .9)";
    const c = 8;
    ctx.beginPath();
    ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
    ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
    ctx.moveTo(x, y + h - c); ctx.lineTo(x, y + h); ctx.lineTo(x + c, y + h);
    ctx.moveTo(x + w - c, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - c);
    ctx.stroke();
    ctx.restore();
  }

  drawScreenHud(ctx) {
    const w = this.width;
    const h = this.height;
    // Cinematic vignette.
    const vig = ctx.createRadialGradient(w / 2, h * 0.52, Math.min(w, h) * 0.25, w / 2, h * 0.52, Math.max(w, h) * 0.72);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(0.72, "rgba(0,4,8,.12)");
    vig.addColorStop(1, "rgba(0,3,6,.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
    // Fine scanlines.
    ctx.save();
    ctx.globalAlpha = 0.032;
    ctx.fillStyle = "#9ceff3";
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    ctx.restore();
    // Corner brackets.
    ctx.strokeStyle = "rgba(127, 240, 255, .15)";
    ctx.lineWidth = 1;
    const m = 11;
    const len = 22;
    ctx.beginPath();
    ctx.moveTo(m, m + len); ctx.lineTo(m, m); ctx.lineTo(m + len, m);
    ctx.moveTo(w - m - len, m); ctx.lineTo(w - m, m); ctx.lineTo(w - m, m + len);
    ctx.moveTo(m, h - m - len); ctx.lineTo(m, h - m); ctx.lineTo(m + len, h - m);
    ctx.moveTo(w - m - len, h - m); ctx.lineTo(w - m, h - m); ctx.lineTo(w - m, h - m - len);
    ctx.stroke();
  }

  drawMinimap(dt) {
    this.miniTimer -= dt;
    if (this.miniTimer > 0) return;
    this.miniTimer = 0.09;
    const m = this.mctx;
    const game = this.game;
    const w = this.minimap.width;
    const h = this.minimap.height;
    if (!this.miniBase) return;
    m.clearRect(0, 0, w, h);
    m.drawImage(this.miniBase, 0, 0, w, h);
    // Terrain explored fog.
    if (game.state !== "menu") {
      if (!this.fogCanvas || this.fogVersion !== game.fog.version) this.updateFogCanvas();
      if (this.fogCanvas) {
        m.globalAlpha = 0.82;
        m.drawImage(this.fogCanvas, 0, 0, w, h);
        m.globalAlpha = 1;
      }
    }
    // Resources.
    for (const r of game.resources) {
      if (!r.alive) continue;
      if (game.state !== "menu" && !game.isExploredAt(r.x, r.y)) continue;
      m.fillStyle = "rgba(120, 241, 255, .75)";
      m.fillRect((r.x / WORLD.width) * w - 1, (r.y / WORLD.height) * h - 1, 2, 2);
    }
    // Buildings.
    for (const b of game.buildings) {
      if (!b.alive) continue;
      if (game.state !== "menu" && b.team !== TEAM.PLAYER && !game.isVisibleAt(b.x, b.y)) continue;
      m.fillStyle = b.team === TEAM.PLAYER ? "#7af6ff" : "#ff5d6c";
      const x = (b.x / WORLD.width) * w;
      const y = (b.y / WORLD.height) * h;
      if (b.type === "nexus") {
        m.fillRect(x - 3, y - 3, 6, 6);
        m.strokeStyle = "rgba(255,255,255,.7)";
        m.lineWidth = 0.7;
        m.strokeRect(x - 3.5, y - 3.5, 7, 7);
      } else {
        m.fillRect(x - 1.7, y - 1.7, 3.4, 3.4);
      }
    }
    // Units.
    for (const u of game.units) {
      if (!u.alive) continue;
      if (game.state !== "menu" && u.team !== TEAM.PLAYER && !game.isVisibleAt(u.x, u.y)) continue;
      m.fillStyle = u.team === TEAM.PLAYER ? (u.isWorker ? "#b8f8ff" : "#5ef3ff") : "#ff6370";
      m.beginPath();
      m.arc((u.x / WORLD.width) * w, (u.y / WORLD.height) * h, u.isWorker ? 1.1 : 1.6, 0, TAU);
      m.fill();
    }
    // Camera viewport.
    const vw = (this.width / game.camera.zoom / WORLD.width) * w;
    const vh = (this.height / game.camera.zoom / WORLD.height) * h;
    const vx = (game.camera.x / WORLD.width) * w - vw / 2;
    const vy = (game.camera.y / WORLD.height) * h - vh / 2;
    m.strokeStyle = "rgba(224, 253, 255, .82)";
    m.lineWidth = 0.9;
    m.strokeRect(vx, vy, vw, vh);
    m.fillStyle = "rgba(117, 241, 255, .035)";
    m.fillRect(vx, vy, vw, vh);
    // Sweep glint.
    const sy = ((this.time * 22) % (h + 20)) - 10;
    const grad = m.createLinearGradient(0, sy - 8, 0, sy + 8);
    grad.addColorStop(0, "rgba(107, 240, 255, 0)");
    grad.addColorStop(0.5, "rgba(107, 240, 255, .12)");
    grad.addColorStop(1, "rgba(107, 240, 255, 0)");
    m.fillStyle = grad;
    m.fillRect(0, sy - 8, w, 16);
  }

  drawPortrait(dt) {
    this.portraitTimer -= dt;
    if (this.portraitTimer > 0) return;
    this.portraitTimer = 0.1;
    const ctx = this.pctx;
    const w = this.portrait.width;
    const h = this.portrait.height;
    const e = this.game.primarySelection;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w * 0.5, h * 0.4, 2, w * 0.5, h * 0.5, w * 0.75);
    if (e) {
      const color = TEAM_DATA[e.team].color;
      bg.addColorStop(0, colorWithAlpha(color, 0.16));
      bg.addColorStop(0.55, "rgba(6, 20, 29, .7)");
      bg.addColorStop(1, "rgba(2, 9, 14, .95)");
    } else {
      bg.addColorStop(0, "rgba(24, 86, 100, .14)");
      bg.addColorStop(1, "rgba(2, 9, 14, .95)");
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // Reticle background.
    ctx.strokeStyle = "rgba(111, 237, 255, .13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.34, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.24, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2, 8); ctx.lineTo(w / 2, 24);
    ctx.moveTo(w / 2, h - 8); ctx.lineTo(w / 2, h - 24);
    ctx.moveTo(8, h / 2); ctx.lineTo(24, h / 2);
    ctx.moveTo(w - 8, h / 2); ctx.lineTo(w - 24, h / 2);
    ctx.stroke();
    if (!e) {
      ctx.fillStyle = "rgba(124, 230, 245, .3)";
      ctx.font = "600 9px Bahnschrift, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("NO SIGNAL", w / 2, h / 2 + 3);
      return;
    }
    ctx.save();
    ctx.translate(w / 2, h / 2 + 7);
    ctx.rotate(-0.26);
    if (e.kind === "unit") {
      const def = UNIT_TYPES[e.type];
      const scale = def.shape === "juggernaut" ? 4.5 : 6;
      ctx.scale(scale, scale);
      if (def.shape === "worker") this.drawWorkerShape(ctx, e);
      else if (def.shape === "trooper") this.drawTrooperShape(ctx, e);
      else if (def.shape === "lancer") this.drawLancerShape(ctx, e);
      else this.drawJuggernautShape(ctx, e);
    } else if (e.kind === "building") {
      const p = e.team === TEAM.PLAYER
        ? { main: "#163c47", light: "#34717a", accent: "#67f1ff", dark: "#06171d", glow: "rgba(99,241,255,.6)", deck: "#0a252e" }
        : { main: "#481b26", light: "#83323e", accent: "#ff5d6c", dark: "#1b080d", glow: "rgba(255,93,108,.55)", deck: "#2c0e15" };
      const def = BUILDING_TYPES[e.type];
      const scales = { nexus: 1.45, barracks: 1.65, habitat: 2.1, foundry: 1.5, turret: 2.3 };
      ctx.scale(scales[def.shape] || 1.5, scales[def.shape] || 1.5);
      if (def.shape === "nexus") this.drawNexus(ctx, e, p, this.time, 1);
      else if (def.shape === "barracks") this.drawBarracks(ctx, e, p, this.time);
      else if (def.shape === "habitat") this.drawHabitat(ctx, e, p, this.time);
      else if (def.shape === "foundry") this.drawFoundry(ctx, e, p, this.time);
      else if (def.shape === "turret") this.drawTurret(ctx, e, p, this.time);
    }
    ctx.restore();
    // Base gradient overlay.
    const fade = ctx.createLinearGradient(0, h * 0.55, 0, h);
    fade.addColorStop(0, "rgba(3,10,15,0)");
    fade.addColorStop(1, "rgba(3,10,15,.62)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
  }
}

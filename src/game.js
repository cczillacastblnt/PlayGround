import {
  WORLD,
  TEAM,
  TEAM_DATA,
  DIFFICULTIES,
  UNIT_TYPES,
  BUILDING_TYPES,
  STARTING,
  CRYSTAL_PATCHES,
  MAP_ROCKS,
  BUILD_ORDER,
  GAME_RULES,
} from "./config.js";
import {
  clamp,
  dist,
  dist2,
  angleTo,
  normalize,
  rand,
  randInt,
  pick,
  uid,
  RNG,
  shortestAngle,
  rotateTowards,
} from "./utils.js";

const TAU = Math.PI * 2;

class MinHeap {
  constructor() {
    this.data = [];
  }
  get size() {
    return this.data.length;
  }
  push(node) {
    const a = this.data;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.data;
    if (a.length === 1) return a.pop();
    const out = a[0];
    a[0] = a.pop();
    let i = 0;
    while (true) {
      let l = i * 2 + 1;
      let r = l + 1;
      let s = i;
      if (l < a.length && a[l].f < a[s].f) s = l;
      if (r < a.length && a[r].f < a[s].f) s = r;
      if (s === i) break;
      [a[s], a[i]] = [a[i], a[s]];
      i = s;
    }
    return out;
  }
}

class NavGrid {
  constructor(game) {
    this.game = game;
    this.cols = Math.ceil(WORLD.width / WORLD.tile);
    this.rows = Math.ceil(WORLD.height / WORLD.tile);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.cost = new Float32Array(this.cols * this.rows);
    this.from = new Int32Array(this.cols * this.rows);
    this.g = new Float32Array(this.cols * this.rows);
    this.f = new Float32Array(this.cols * this.rows);
    this.closed = new Uint8Array(this.cols * this.rows);
    this.stamp = new Uint32Array(this.cols * this.rows);
    this.searchId = 0;
  }

  idx(cx, cy) {
    return cy * this.cols + cx;
  }

  inBounds(cx, cy) {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  cellToWorld(cx, cy) {
    return { x: cx * WORLD.tile + WORLD.tile / 2, y: cy * WORLD.tile + WORLD.tile / 2 };
  }

  worldToCell(x, y) {
    return {
      cx: clamp(Math.floor(x / WORLD.tile), 0, this.cols - 1),
      cy: clamp(Math.floor(y / WORLD.tile), 0, this.rows - 1),
    };
  }

  rebuild() {
    this.blocked.fill(0);
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const { x, y } = this.cellToWorld(cx, cy);
        if (
          x < WORLD.margin * 0.35 ||
          y < WORLD.margin * 0.35 ||
          x > WORLD.width - WORLD.margin * 0.35 ||
          y > WORLD.height - WORLD.margin * 0.35
        ) {
          this.blocked[this.idx(cx, cy)] = 1;
        }
      }
    }
    for (const rock of this.game.rocks) {
      if (!rock.r) continue;
      this.blockCircle(rock.x, rock.y, rock.r);
    }
    for (const e of this.game.entities) {
      if (e.kind === "resource") this.blockCircle(e.x, e.y, e.radius + 2);
      if (e.kind === "building") this.blockCircle(e.x, e.y, e.radius + 5);
    }
  }

  blockCircle(x, y, r) {
    const minX = clamp(Math.floor((x - r) / WORLD.tile), 0, this.cols - 1);
    const maxX = clamp(Math.ceil((x + r) / WORLD.tile), 0, this.cols - 1);
    const minY = clamp(Math.floor((y - r) / WORLD.tile), 0, this.rows - 1);
    const maxY = clamp(Math.ceil((y + r) / WORLD.tile), 0, this.rows - 1);
    const r2 = r * r;
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const p = this.cellToWorld(cx, cy);
        if (dist2(p.x, p.y, x, y) <= r2) this.blocked[this.idx(cx, cy)] = 1;
      }
    }
  }

  isBlockedCell(cx, cy) {
    if (!this.inBounds(cx, cy)) return true;
    return this.blocked[this.idx(cx, cy)] !== 0;
  }

  isBlockedPoint(x, y) {
    if (x < 4 || y < 4 || x > WORLD.width - 4 || y > WORLD.height - 4) return true;
    const { cx, cy } = this.worldToCell(x, y);
    return this.isBlockedCell(cx, cy);
  }

  nearestOpen(x, y, maxRadius = 12) {
    const { cx, cy } = this.worldToCell(x, y);
    if (!this.isBlockedCell(cx, cy)) return this.cellToWorld(cx, cy);
    for (let r = 1; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.isBlockedCell(nx, ny)) return this.cellToWorld(nx, ny);
        }
      }
    }
    return null;
  }

  lineWalkable(x1, y1, x2, y2) {
    const d = dist(x1, y1, x2, y2);
    if (d < 1) return !this.isBlockedPoint(x2, y2);
    const steps = Math.ceil(d / 15);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isBlockedPoint(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
    return true;
  }

  findPath(sx, sy, tx, ty, maxGoalSearch = 16) {
    const s = this.worldToCell(sx, sy);
    let goal = null;
    const tc = this.worldToCell(tx, ty);
    if (!this.isBlockedCell(tc.cx, tc.cy)) goal = tc;
    else {
      const open = this.nearestOpen(tx, ty, maxGoalSearch);
      if (!open) return [];
      goal = this.worldToCell(open.x, open.y);
    }
    if (s.cx === goal.cx && s.cy === goal.cy) return [{ x: tx, y: ty }];

    const id = ++this.searchId;
    const startIdx = this.idx(s.cx, s.cy);
    this.stamp[startIdx] = id;
    this.g[startIdx] = 0;
    this.f[startIdx] = 0;
    this.from[startIdx] = -1;
    this.closed[startIdx] = 0;

    const heap = new MinHeap();
    heap.push({ idx: startIdx, f: 0 });
    const goalIdx = this.idx(goal.cx, goal.cy);
    let found = false;
    let guard = 0;
    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
    ];

    while (heap.size && guard++ < 12000) {
      const cur = heap.pop();
      if (this.stamp[cur.idx] !== id || this.closed[cur.idx]) continue;
      if (cur.idx === goalIdx) {
        found = true;
        break;
      }
      this.closed[cur.idx] = 1;
      const cx = cur.idx % this.cols;
      const cy = Math.floor(cur.idx / this.cols);
      for (const [dx, dy, cost] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (this.isBlockedCell(nx, ny)) continue;
        if (dx && dy && (this.isBlockedCell(cx + dx, cy) || this.isBlockedCell(cx, cy + dy))) continue;
        const ni = this.idx(nx, ny);
        if (this.stamp[ni] !== id) {
          this.stamp[ni] = id;
          this.g[ni] = Infinity;
          this.closed[ni] = 0;
        }
        if (this.closed[ni]) continue;
        const ng = this.g[cur.idx] + cost;
        if (ng < this.g[ni]) {
          this.g[ni] = ng;
          this.from[ni] = cur.idx;
          const hx = Math.abs(nx - goal.cx);
          const hy = Math.abs(ny - goal.cy);
          const h = (hx + hy) + (1.414 - 2) * Math.min(hx, hy);
          const f = ng + h * 1.02;
          this.f[ni] = f;
          heap.push({ idx: ni, f });
        }
      }
    }
    if (!found) return [];

    const cells = [];
    let cur = goalIdx;
    let guard2 = 0;
    while (cur !== -1 && guard2++ < 5000) {
      cells.push(cur);
      if (cur === startIdx) break;
      cur = this.from[cur];
    }
    cells.reverse();
    const points = cells.map((idx) => this.cellToWorld(idx % this.cols, Math.floor(idx / this.cols)));
    if (points.length) {
      points[points.length - 1] = { x: tx, y: ty };
    }

    // String-pull the path to avoid robotic grid-following.
    if (points.length > 2) {
      const smooth = [];
      let anchorX = sx;
      let anchorY = sy;
      let i = 0;
      while (i < points.length) {
        let farthest = i;
        for (let j = points.length - 1; j > i; j--) {
          if (this.lineWalkable(anchorX, anchorY, points[j].x, points[j].y)) {
            farthest = j;
            break;
          }
        }
        smooth.push(points[farthest]);
        anchorX = points[farthest].x;
        anchorY = points[farthest].y;
        if (farthest === points.length - 1) break;
        i = farthest + 1;
      }
      return smooth;
    }
    return points;
  }
}

export class Game {
  constructor(audio) {
    this.audio = audio;
    this.entities = [];
    this.units = [];
    this.buildings = [];
    this.resources = [];
    this.projectiles = [];
    this.effects = [];
    this.selection = [];
    this.controlGroups = {};
    this.camera = { ...GAME_RULES.startingCamera };
    this.cameraTarget = { ...GAME_RULES.startingCamera };
    this.viewW = 1280;
    this.viewH = 720;
    this.state = "menu";
    this.difficultyKey = "veteran";
    this.difficulty = DIFFICULTIES.veteran;
    this.debug = false;
    this.fog = { cols: 0, rows: 0, visible: null, explored: null, timer: 0 };
    this.pointer = { x: 0, y: 0, worldX: 0, worldY: 0, inside: false };
    this.buildMode = null;
    this.pendingCommand = null;
    this.onAlert = null;
    this.onEnd = null;
    this.onFogUpdate = null;
    this.commandCount = 0;
    this.idleWorkerIndex = 0;
    this.aiTimer = 0;
    this.lastAlertAt = -99;
    this.endShown = false;
    this.menuTime = 0;
    this.menuCamera = { x: 800, y: 1080, zoom: 0.92 };
  }

  emitAlert(message, tone = "info", title = null, cooldown = 0) {
    if (cooldown && this.gameTime - this.lastAlertAt < cooldown) return;
    this.lastAlertAt = this.gameTime;
    if (this.onAlert) this.onAlert({ message, tone, title, time: this.gameTime });
  }

  newGame(difficultyKey = "veteran") {
    this.difficultyKey = DIFFICULTIES[difficultyKey] ? difficultyKey : "veteran";
    this.difficulty = DIFFICULTIES[this.difficultyKey];
    this.entities = [];
    this.units = [];
    this.buildings = [];
    this.resources = [];
    this.projectiles = [];
    this.effects = [];
    this.selection = [];
    this.controlGroups = {};
    this.gameTime = 0;
    this.state = "playing";
    this.endShown = false;
    this.commandCount = 0;
    this.buildMode = null;
    this.pendingCommand = null;
    this.aiTimer = 0;
    this.lastAlertAt = -99;
    this.idleWorkerIndex = 0;
    this.players = {
      0: { minerals: STARTING.player.minerals + this.difficulty.playerStart, supplyCap: 0, supplyUsed: 0 },
      1: { minerals: STARTING.enemy.minerals + this.difficulty.enemyStart, supplyCap: 0, supplyUsed: 0 },
    };
    this.stats = {
      kills: 0,
      losses: 0,
      unitsTrained: 0,
      structuresBuilt: 0,
      mineralsMined: 0,
      enemyBuildingsLost: 0,
      commands: 0,
      waveCount: 0,
    };
    this.rocks = MAP_ROCKS.map((r, i) => ({ ...r, seed: i * 13.7 + 2 }));
    this.nav = new NavGrid(this);
    this.rng = new RNG(9461);

    for (const patch of CRYSTAL_PATCHES) this.addResource(patch.x, patch.y, patch.amount);
    for (const [type, x, y] of STARTING.player.buildings) this.addBuilding(type, TEAM.PLAYER, x, y, true);
    for (const [type, x, y] of STARTING.enemy.buildings) this.addBuilding(type, TEAM.ENEMY, x, y, true);
    for (const [type, x, y] of STARTING.player.units) this.addUnit(type, TEAM.PLAYER, x, y, { silent: true });
    for (const [type, x, y] of STARTING.enemy.units) this.addUnit(type, TEAM.ENEMY, x, y, { silent: true });

    this.nav.rebuild();
    // Starting formations can naturally overlap a structure's navigation
    // footprint. Nudge those units onto open ground so they never begin stuck.
    for (const u of this.units) {
      if (this.nav.isBlockedPoint(u.x, u.y)) {
        const open = this.nav.nearestOpen(u.x, u.y, 14);
        if (open) {
          u.x = open.x;
          u.y = open.y;
        }
      }
    }
    this.initFog();
    this.recalcSupply(TEAM.PLAYER);
    this.recalcSupply(TEAM.ENEMY);
    this.camera = { x: GAME_RULES.startingCamera.x, y: GAME_RULES.startingCamera.y, zoom: GAME_RULES.startingCamera.zoom };
    this.cameraTarget = { ...this.camera };
    this.clampCamera();

    for (const u of this.units) {
      if (u.team === TEAM.PLAYER && u.isWorker) this.autoGather(u);
      if (u.team === TEAM.ENEMY && u.isWorker) this.autoGather(u);
    }
    this.ai = {
      waveTimer: this.difficulty.aiFirstWave,
      thinkTimer: 1.2,
      incomeTimer: 0,
      attacking: false,
      squad: [],
      buildCooldown: 2,
      expansions: 0,
    };
  }

  setMenuScene() {
    this.state = "menu";
    this.newGame("veteran");
    this.state = "menu";
    this.selection = [];
    this.fog.visible.fill(1);
    this.fog.explored.fill(1);
    this.buildMode = null;
    this.pendingCommand = null;
    this.menuTime = 0;
    this.camera = { ...this.menuCamera };
    this.cameraTarget = { ...this.menuCamera };
    this.clampCamera();
  }

  // ---------------------------------------------------------------- entities
  addResource(x, y, amount) {
    const e = {
      id: uid("r"),
      kind: "resource",
      type: "crystal",
      team: TEAM.NEUTRAL,
      x, y,
      radius: 20 + Math.random() * 4,
      amount,
      maxAmount: amount,
      seed: Math.random() * 100,
      alive: true,
    };
    this.entities.push(e);
    this.resources.push(e);
    return e;
  }

  addBuilding(typeId, team, x, y, completed = false) {
    const def = BUILDING_TYPES[typeId];
    if (!def) throw new Error(`Unknown building ${typeId}`);
    const b = {
      id: uid("b"),
      kind: "building",
      type: typeId,
      team,
      x, y,
      hp: completed ? def.hp : Math.max(30, def.hp * 0.08),
      maxHp: def.hp,
      radius: def.radius,
      sight: def.sight,
      armor: def.armor,
      shape: def.shape,
      completed,
      buildProgress: completed ? 1 : 0,
      buildTime: def.buildTime,
      queue: [],
      rally: null,
      builders: [],
      angle: team === TEAM.ENEMY ? Math.PI : 0,
      turretAngle: team === TEAM.ENEMY ? Math.PI : 0,
      cooldown: rand(0, 0.6),
      flash: 0,
      lastShot: 0,
      hitFlash: 0,
      alive: true,
      spawnTime: this.gameTime || 0,
      smokeTimer: rand(0, 1),
    };
    this.entities.push(b);
    this.buildings.push(b);
    if (!completed) this.nav?.rebuild();
    return b;
  }

  addUnit(typeId, team, x, y, opts = {}) {
    const def = UNIT_TYPES[typeId];
    if (!def) throw new Error(`Unknown unit ${typeId}`);
    const p = this.nav ? this.nav.nearestOpen(x, y, 8) : { x, y };
    const u = {
      id: uid("u"),
      kind: "unit",
      type: typeId,
      team,
      x: p.x,
      y: p.y,
      hp: def.hp,
      maxHp: def.hp,
      radius: def.radius,
      sight: def.sight,
      armor: def.armor,
      speed: def.speed,
      attack: def.attack,
      supply: def.supply,
      isWorker: !!def.isWorker,
      shape: def.shape,
      angle: team === TEAM.ENEMY ? Math.PI : 0,
      turretAngle: team === TEAM.ENEMY ? Math.PI : 0,
      cooldown: rand(0, 0.5),
      flash: 0,
      hitFlash: 0,
      lastShot: 0,
      walkCycle: rand(0, TAU),
      order: null,
      targetId: null,
      autoTargetId: null,
      path: [],
      pathIndex: 0,
      repathTimer: 0,
      carrying: 0,
      carryCap: 8,
      miningTimer: 0,
      depositTimer: 0,
      homeNodeId: null,
      buildTargetId: null,
      alive: true,
      selected: false,
      spawnTime: this.gameTime || 0,
      idleTime: 0,
      vx: 0,
      vy: 0,
      wasMoving: false,
      hitReact: 0,
      deathTimer: 0,
      rally: null,
    };
    this.entities.push(u);
    this.units.push(u);
    if (opts.silent) this.fogDirty = true;
    return u;
  }

  // ------------------------------------------------------------------ camera
  setViewport(w, h) {
    this.viewW = w;
    this.viewH = h;
    this.clampCamera();
  }

  clampCamera() {
    const halfW = this.viewW / (2 * this.camera.zoom);
    const halfH = this.viewH / (2 * this.camera.zoom);
    if (halfW * 2 >= WORLD.width) this.camera.x = WORLD.width / 2;
    else this.camera.x = clamp(this.camera.x, halfW, WORLD.width - halfW);
    if (halfH * 2 >= WORLD.height) this.camera.y = WORLD.height / 2;
    else this.camera.y = clamp(this.camera.y, halfH, WORLD.height - halfH);
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.viewH / 2) / this.camera.zoom + this.camera.y,
    };
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.camera.x) * this.camera.zoom + this.viewW / 2,
      y: (y - this.camera.y) * this.camera.zoom + this.viewH / 2,
    };
  }

  focus(x, y, instant = false) {
    this.cameraTarget.x = x;
    this.cameraTarget.y = y;
    if (instant) {
      this.camera.x = x;
      this.camera.y = y;
      this.clampCamera();
    }
  }

  setZoom(z, worldAnchor = null) {
    const oldZoom = this.camera.zoom;
    const next = clamp(z, GAME_RULES.cameraMinZoom, GAME_RULES.cameraMaxZoom);
    if (worldAnchor) {
      const before = {
        x: (worldAnchor.x - this.camera.x) * oldZoom,
        y: (worldAnchor.y - this.camera.y) * oldZoom,
      };
      this.camera.zoom = next;
      this.camera.x = worldAnchor.x - before.x / next;
      this.camera.y = worldAnchor.y - before.y / next;
    } else {
      this.camera.zoom = next;
    }
    this.clampCamera();
  }

  updateCamera(dt) {
    const k = 1 - Math.pow(0.001, dt);
    this.camera.x += (this.cameraTarget.x - this.camera.x) * k;
    this.camera.y += (this.cameraTarget.y - this.camera.y) * k;
    this.clampCamera();
  }

  // ------------------------------------------------------------------- fog
  initFog() {
    const cell = GAME_RULES.fogCell;
    const cols = Math.ceil(WORLD.width / cell);
    const rows = Math.ceil(WORLD.height / cell);
    this.fog = {
      cell, cols, rows,
      visible: new Uint8Array(cols * rows),
      explored: new Uint8Array(cols * rows),
      timer: 0,
      version: 0,
    };
    this.fogDirty = true;
    this.updateFog();
  }

  updateFog() {
    const { cols, rows, cell, visible, explored } = this.fog;
    visible.fill(0);
    for (const e of this.entities) {
      if (e.team !== TEAM.PLAYER || !e.alive) continue;
      const sight = e.kind === "building" ? e.sight : e.sight;
      const cx = e.x / cell;
      const cy = e.y / cell;
      const cr = sight / cell;
      const minX = clamp(Math.floor(cx - cr), 0, cols - 1);
      const maxX = clamp(Math.ceil(cx + cr), 0, cols - 1);
      const minY = clamp(Math.floor(cy - cr), 0, rows - 1);
      const maxY = clamp(Math.ceil(cy + cr), 0, rows - 1);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= cr * cr) {
            const i = y * cols + x;
            visible[i] = 1;
            explored[i] = 1;
          }
        }
      }
    }
    this.fog.version++;
    this.fogDirty = false;
    if (this.onFogUpdate) this.onFogUpdate();
  }

  isVisibleAt(x, y) {
    if (this.state === "menu") return true;
    const cell = this.fog.cell;
    const cx = clamp(Math.floor(x / cell), 0, this.fog.cols - 1);
    const cy = clamp(Math.floor(y / cell), 0, this.fog.rows - 1);
    return this.fog.visible[cy * this.fog.cols + cx] === 1;
  }

  isExploredAt(x, y) {
    if (this.state === "menu") return true;
    const cell = this.fog.cell;
    const cx = clamp(Math.floor(x / cell), 0, this.fog.cols - 1);
    const cy = clamp(Math.floor(y / cell), 0, this.fog.rows - 1);
    return this.fog.explored[cy * this.fog.cols + cx] === 1;
  }

  // -------------------------------------------------------------- selection
  get selectedEntities() {
    return this.selection.map((id) => this.entities.find((e) => e.id === id && e.alive)).filter(Boolean);
  }

  get selectedOwn() {
    return this.selectedEntities.filter((e) => e.team === TEAM.PLAYER);
  }

  get selectedUnits() {
    return this.selectedOwn.filter((e) => e.kind === "unit");
  }

  get selectedBuildings() {
    return this.selectedOwn.filter((e) => e.kind === "building");
  }

  get primarySelection() {
    return this.selectedEntities[0] || null;
  }

  entityAt(wx, wy, teamOnly = null) {
    let best = null;
    let bestScore = Infinity;
    for (const e of this.entities) {
      if (!e.alive || e.kind === "resource") continue;
      if (teamOnly !== null && e.team !== teamOnly) continue;
      if (e.team === TEAM.ENEMY && !this.isVisibleAt(e.x, e.y)) continue;
      const r = e.radius + (e.kind === "building" ? 12 : 8);
      const d = dist(wx, wy, e.x, e.y);
      if (d <= r) {
        const score = d - (e.kind === "unit" ? 6 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
    }
    return best;
  }

  resourceAt(wx, wy) {
    for (const r of this.resources) {
      if (!r.alive) continue;
      if (dist(wx, wy, r.x, r.y) <= r.radius + 13) return r;
    }
    return null;
  }

  selectAt(wx, wy, additive = false) {
    if (this.state !== "playing") return;
    const e = this.entityAt(wx, wy);
    if (!e) {
      if (!additive) this.clearSelection();
      return;
    }
    if (additive) {
      if (this.selection.includes(e.id)) this.selection = this.selection.filter((id) => id !== e.id);
      else this.selection.push(e.id);
    } else {
      this.selection = [e.id];
    }
    this.audio.select();
    this.syncSelectedFlags();
  }

  boxSelect(x1, y1, x2, y2, additive = false) {
    if (this.state !== "playing") return;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const found = [];
    for (const u of this.units) {
      if (u.team !== TEAM.PLAYER || !u.alive) continue;
      if (u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) found.push(u);
    }
    if (!found.length) {
      for (const b of this.buildings) {
        if (b.team !== TEAM.PLAYER || !b.alive) continue;
        if (b.x >= minX && b.x <= maxX && b.y >= minY && b.y <= maxY) found.push(b);
      }
    }
    if (additive) {
      const ids = new Set([...this.selection, ...found.map((e) => e.id)]);
      this.selection = [...ids].slice(0, GAME_RULES.maxSelection);
    } else {
      this.selection = found.slice(0, GAME_RULES.maxSelection).map((e) => e.id);
    }
    if (found.length) this.audio.select();
    this.syncSelectedFlags();
  }

  selectAllOfType(entity) {
    if (!entity || entity.team !== TEAM.PLAYER) return;
    const found = this.entities.filter(
      (e) => e.team === TEAM.PLAYER && e.alive && e.type === entity.type && (e.kind === "unit" || this.isVisibleAt(e.x, e.y))
    );
    this.selection = found.slice(0, GAME_RULES.maxSelection).map((e) => e.id);
    this.audio.select();
    this.syncSelectedFlags();
  }

  selectAllArmy() {
    const found = this.units.filter((u) => u.team === TEAM.PLAYER && u.alive && !u.isWorker);
    this.selection = found.slice(0, GAME_RULES.maxSelection).map((u) => u.id);
    if (!found.length) this.emitAlert("No combat units available.", "info", null, 1);
    this.audio.select();
    this.syncSelectedFlags();
  }

  selectAllWorkers() {
    const found = this.units.filter((u) => u.team === TEAM.PLAYER && u.alive && u.isWorker);
    this.selection = found.slice(0, GAME_RULES.maxSelection).map((u) => u.id);
    this.audio.select();
    this.syncSelectedFlags();
  }

  selectBase() {
    const core = this.buildings.find((b) => b.team === TEAM.PLAYER && b.type === "nexus" && b.alive);
    if (core) {
      this.selection = [core.id];
      this.focus(core.x, core.y);
      this.audio.select();
      this.syncSelectedFlags();
    }
  }

  syncSelectedFlags() {
    const ids = new Set(this.selection);
    for (const e of this.entities) e.selected = ids.has(e.id);
    // Clicking a single building should reveal its production options.
    const primary = this.primarySelection;
    if (primary && primary.team !== TEAM.PLAYER) {
      // Enemy selections are informational only.
    }
  }

  clearSelection() {
    this.selection = [];
    for (const e of this.entities) e.selected = false;
    this.buildMode = null;
  }

  cycleIdleWorker() {
    const idle = this.units.filter((u) => u.team === TEAM.PLAYER && u.alive && u.isWorker && !u.order);
    if (!idle.length) {
      this.emitAlert("All Fabricators are busy.", "info", null, 1);
      return;
    }
    this.idleWorkerIndex %= idle.length;
    const u = idle[this.idleWorkerIndex++];
    this.selection = [u.id];
    this.focus(u.x, u.y);
    this.audio.select();
    this.syncSelectedFlags();
  }

  setControlGroup(n) {
    if (!this.selection.length) return;
    this.controlGroups[n] = this.selection.slice();
    this.emitAlert(`Control group ${n} assigned.`, "info", null, 0.2);
  }

  recallControlGroup(n) {
    const ids = this.controlGroups[n];
    if (!ids) return;
    const alive = ids.filter((id) => this.entities.some((e) => e.id === id && e.alive));
    if (!alive.length) return;
    this.selection = alive;
    this.syncSelectedFlags();
    const first = this.selectedEntities[0];
    if (first) this.focus(first.x, first.y);
    this.audio.select();
  }

  // -------------------------------------------------------------- commands
  issueContextOrder(wx, wy) {
    if (this.state !== "playing") return;
    if (this.buildMode) {
      this.placeBuilding(wx, wy);
      return;
    }
    const selected = this.selectedOwn;
    if (!selected.length) return;
    const target = this.entityAt(wx, wy);
    const resource = target ? null : this.resourceAt(wx, wy);
    const units = this.selectedUnits;
    const buildings = this.selectedBuildings;
    this.stats.commands++;
    this.commandCount++;

    if (target && target.team === TEAM.ENEMY) {
      if (target.team === TEAM.ENEMY && !this.isVisibleAt(target.x, target.y)) return;
      for (const u of units) {
        if (u.isWorker) {
          if (dist(u.x, u.y, target.x, target.y) < 700) this.orderMove(u, target.x, target.y);
          continue;
        }
        this.orderAttack(u, target);
      }
      this.audio.command();
      this.spawnOrderMarker(target.x, target.y, "attack");
      return;
    }

    if (resource && units.some((u) => u.isWorker)) {
      const workers = units.filter((u) => u.isWorker);
      for (const u of workers) this.orderGather(u, resource);
      for (const u of units.filter((u) => !u.isWorker)) {
        this.orderMove(u, wx, wy);
      }
      this.audio.command();
      this.spawnOrderMarker(resource.x, resource.y, "gather");
      return;
    }

    if (target && target.team === TEAM.PLAYER) {
      if (target.kind === "building" && !target.completed) {
        const builders = units.filter((u) => u.isWorker);
        if (builders.length) {
          for (const u of builders) this.orderBuild(u, target);
          this.audio.command();
          this.spawnOrderMarker(target.x, target.y, "build");
          this.emitAlert("Fabricator assigned to construction.", "info", null, 0.4);
          return;
        }
      }
      if (target.kind === "building" && target.completed) {
        if (buildings.length === 1 && !units.length) {
          this.setRally(buildings[0], target.x, target.y);
          return;
        }
        if (units.length) {
          for (const u of units) this.orderMove(u, target.x + (u.x < target.x ? -target.radius - 25 : target.radius + 25), target.y + rand(-18, 18));
          this.audio.command();
          this.spawnOrderMarker(target.x, target.y, "move");
          return;
        }
      }
    }

    // Right-clicking with only a building selected sets its rally point.
    if (!units.length && buildings.length) {
      for (const b of buildings) this.setRally(b, wx, wy);
      this.audio.command();
      this.spawnOrderMarker(wx, wy, "rally");
      return;
    }

    const movable = units;
    if (!movable.length) return;
    this.formationMove(movable, wx, wy);
    this.audio.command();
    this.spawnOrderMarker(wx, wy, "move");
  }

  formationMove(units, x, y) {
    const cols = Math.ceil(Math.sqrt(units.length));
    const spacing = 32;
    units.forEach((u, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const ox = (col - (cols - 1) / 2) * spacing;
      const oy = (row - (Math.ceil(units.length / cols) - 1) / 2) * spacing;
      const destination = this.nav?.nearestOpen(x + ox, y + oy, 8) || { x: x + ox, y: y + oy };
      this.orderMove(u, destination.x, destination.y);
    });
  }

  moveSelectedTo(x, y) {
    const units = this.selectedUnits;
    if (!units.length) return;
    this.formationMove(units, x, y);
    this.stats.commands++;
    this.audio.command();
    this.spawnOrderMarker(x, y, "move");
  }

  gatherSelected() {
    const workers = this.selectedUnits.filter((u) => u.isWorker);
    if (!workers.length) {
      this.audio.error();
      return;
    }
    let sent = 0;
    for (const u of workers) {
      const node = this.findNearestResource(u.x, u.y, u.team);
      if (node) {
        this.orderGather(u, node);
        sent++;
      }
    }
    if (sent) {
      this.audio.command();
      this.emitAlert("Fabricators returning to the ionium field.", "info", null, 0.35);
    }
  }

  beginAttackMove() {
    if (!this.selectedUnits.some((u) => !u.isWorker && u.attack)) {
      this.audio.error();
      return;
    }
    this.pendingCommand = "attack";
    this.buildMode = null;
    this.emitAlert("Attack-move armed. Click a destination.", "info", null, 0.5);
  }

  executeAttackMove(x, y) {
    const units = this.selectedUnits.filter((u) => u.attack);
    if (!units.length) return;
    const cols = Math.ceil(Math.sqrt(units.length));
    units.forEach((u, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const dest = this.nav?.nearestOpen(x + (col - (cols - 1) / 2) * 30, y + (row - 0.5) * 28, 8) || { x, y };
      this.orderAttackMove(u, dest.x, dest.y);
    });
    this.pendingCommand = null;
    this.stats.commands++;
    this.audio.command();
    this.spawnOrderMarker(x, y, "attack");
  }

  stopSelected() {
    for (const u of this.selectedUnits) {
      u.order = null;
      u.path = [];
      u.pathIndex = 0;
      u.targetId = null;
      u.autoTargetId = null;
      u.task = null;
      u.buildTargetId = null;
      u.miningTimer = 0;
      u.depositTimer = 0;
      if (u.isWorker) {
        u.miningTimer = 0;
        u.phase = null;
      }
    }
    this.pendingCommand = null;
    this.buildMode = null;
    this.audio.command();
  }

  holdSelected() {
    for (const u of this.selectedUnits) {
      u.order = { type: "hold" };
      u.path = [];
      u.pathIndex = 0;
      u.task = null;
    }
    this.buildMode = null;
    this.pendingCommand = null;
    this.audio.command();
  }

  beginBuild(typeId) {
    const def = BUILDING_TYPES[typeId];
    if (!def) return;
    const workers = this.selectedUnits.filter((u) => u.isWorker);
    if (!workers.length) {
      this.audio.error();
      this.emitAlert("Select a Fabricator to construct structures.", "danger", "INVALID ORDER");
      return;
    }
    if (this.players[TEAM.PLAYER].minerals < def.cost) {
      this.audio.error();
      this.emitAlert(`Insufficient ionium. ${def.name} requires ${def.cost}.`, "danger", "CONSTRUCTION BLOCKED");
      return;
    }
    if (def.requires?.length) {
      const missing = def.requires.find((r) => !this.hasCompletedBuilding(TEAM.PLAYER, r));
      if (missing) {
        this.audio.error();
        this.emitAlert(`Requires ${BUILDING_TYPES[missing].name}.`, "danger", "TECH LOCKED");
        return;
      }
    }
    this.pendingCommand = null;
    this.buildMode = { type: typeId, x: this.pointer.worldX, y: this.pointer.worldY, valid: false };
    this.audio.uiClick();
  }

  cancelMode() {
    this.buildMode = null;
    this.pendingCommand = null;
    this.audio.uiClick();
  }

  canPlaceBuilding(typeId, x, y, team = TEAM.PLAYER, ignoreRequirements = false) {
    const def = BUILDING_TYPES[typeId];
    if (!def) return false;
    if (x - def.radius < 24 || y - def.radius < 24 || x + def.radius > WORLD.width - 24 || y + def.radius > WORLD.height - 24) return false;
    if (!ignoreRequirements && def.requires?.length) {
      if (def.requires.some((r) => !this.hasCompletedBuilding(team, r))) return false;
    }
    // Do not block the map edges or important paths.
    for (const rock of this.rocks) {
      if (dist(x, y, rock.x, rock.y) < def.radius + rock.r + 14) return false;
    }
    for (const r of this.resources) {
      if (!r.alive) continue;
      if (dist(x, y, r.x, r.y) < def.radius + r.radius + 24) return false;
    }
    for (const b of this.buildings) {
      if (!b.alive) continue;
      if (dist(x, y, b.x, b.y) < def.radius + b.radius + 18) return false;
    }
    for (const u of this.units) {
      if (!u.alive || u.team !== team) continue;
      if (dist(x, y, u.x, u.y) < def.radius + u.radius + 10) return false;
    }
    if (team === TEAM.PLAYER) {
      if (!this.isVisibleAt(x, y)) return false;
      let near = false;
      for (const b of this.buildings) {
        if (b.team === TEAM.PLAYER && b.alive && b.completed && dist(x, y, b.x, b.y) < GAME_RULES.buildRadius) {
          near = true;
          break;
        }
      }
      if (!near) return false;
    } else {
      const core = this.buildings.find((b) => b.team === TEAM.ENEMY && b.type === "nexus" && b.alive);
      if (core && dist(x, y, core.x, core.y) > 780) return false;
    }
    return true;
  }

  placeBuilding(wx, wy) {
    if (!this.buildMode) return;
    const type = this.buildMode.type;
    const def = BUILDING_TYPES[type];
    const workers = this.selectedUnits.filter((u) => u.isWorker);
    if (!workers.length) {
      this.cancelMode();
      return;
    }
    if (!this.canPlaceBuilding(type, wx, wy, TEAM.PLAYER)) {
      this.audio.error();
      this.emitAlert("Cannot deploy there. Move clear of terrain, resources and structures.", "danger", "INVALID SITE");
      return;
    }
    if (this.players[TEAM.PLAYER].minerals < def.cost) {
      this.audio.error();
      this.cancelMode();
      return;
    }
    this.players[TEAM.PLAYER].minerals -= def.cost;
    const b = this.addBuilding(type, TEAM.PLAYER, wx, wy, false);
    b.builders.push(workers[0].id);
    this.orderBuild(workers[0], b);
    if (workers.length > 1) {
      for (const w of workers.slice(1)) {
        this.orderMove(w, wx + rand(-20, 20), wy + rand(-20, 20));
      }
    }
    this.buildMode = null;
    this.audio.buildStart();
    this.emitAlert(`${def.name} construction started.`, "info", null, 0.25);
    this.recalcSupply(TEAM.PLAYER);
  }

  setRally(building, x, y) {
    const target = this.resourceAt(x, y);
    building.rally = { x: target ? target.x : x, y: target ? target.y : y, resourceId: target?.id || null };
    this.spawnOrderMarker(building.rally.x, building.rally.y, "rally");
  }

  // ------------------------------------------------------------ unit orders
  orderMove(u, x, y, opts = {}) {
    if (!u.alive) return;
    const path = this.nav ? this.nav.findPath(u.x, u.y, x, y) : [];
    u.order = { type: opts.attackMove ? "attackMove" : "move", x, y };
    u.path = path;
    u.pathIndex = 0;
    u.targetId = null;
    u.autoTargetId = null;
    u.phase = null;
    u.miningTimer = 0;
    u.buildTargetId = null;
    u.idleTime = 0;
    u.repathTimer = 0.6;
  }

  orderAttack(u, target) {
    if (!u.attack) {
      this.orderMove(u, target.x + rand(-40, 40), target.y + rand(-40, 40));
      return;
    }
    u.order = { type: "attack", targetId: target.id };
    u.targetId = target.id;
    u.autoTargetId = null;
    u.path = [];
    u.pathIndex = 0;
    u.phase = null;
    u.miningTimer = 0;
    u.buildTargetId = null;
    u.repathTimer = 0;
  }

  orderAttackMove(u, x, y) {
    if (!u.attack) {
      this.orderMove(u, x, y);
      return;
    }
    const path = this.nav ? this.nav.findPath(u.x, u.y, x, y) : [];
    u.order = { type: "attackMove", x, y };
    u.path = path;
    u.pathIndex = 0;
    u.targetId = null;
    u.autoTargetId = null;
    u.phase = null;
    u.buildTargetId = null;
    u.repathTimer = 0.5;
  }

  orderGather(u, resource) {
    if (!u.isWorker || !resource || !resource.alive) return;
    u.order = { type: "gather", resourceId: resource.id };
    u.homeNodeId = resource.id;
    u.targetId = null;
    u.autoTargetId = null;
    u.phase = "toNode";
    u.miningTimer = 0;
    u.buildTargetId = null;
    u.depositTimer = 0;
    this.moveWorkerToResource(u, resource);
  }

  moveWorkerToResource(u, resource) {
    const angle = angleTo(resource.x, resource.y, u.x, u.y);
    const tx = resource.x + Math.cos(angle) * (resource.radius + u.radius + 4);
    const ty = resource.y + Math.sin(angle) * (resource.radius + u.radius + 4);
    u.path = this.nav.findPath(u.x, u.y, tx, ty);
    u.pathIndex = 0;
    u.phase = "toNode";
  }

  autoGather(u) {
    if (!u.isWorker) return;
    const node = this.findNearestResource(u.x, u.y, u.team);
    if (node) this.orderGather(u, node);
  }

  findNearestResource(x, y, team = TEAM.PLAYER) {
    const core = this.buildings.find((b) => b.team === team && b.type === "nexus" && b.alive);
    let best = null;
    let bestD = Infinity;
    for (const r of this.resources) {
      if (!r.alive || r.amount <= 0) continue;
      let d = dist2(x, y, r.x, r.y);
      if (core && team === TEAM.PLAYER) d += dist2(core.x, core.y, r.x, r.y) * 0.12;
      if (team === TEAM.ENEMY) {
        const enemyCore = this.buildings.find((b) => b.team === TEAM.ENEMY && b.type === "nexus" && b.alive);
        if (enemyCore && dist2(enemyCore.x, enemyCore.y, r.x, r.y) > 900 * 900) d += 500000;
      }
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  orderBuild(u, building) {
    if (!u.isWorker || !building || !building.alive) return;
    u.order = { type: "build", targetId: building.id };
    u.buildTargetId = building.id;
    u.targetId = null;
    u.autoTargetId = null;
    u.phase = "toBuild";
    u.miningTimer = 0;
    const angle = angleTo(building.x, building.y, u.x, u.y);
    const tx = building.x + Math.cos(angle) * (building.radius + u.radius + 8);
    const ty = building.y + Math.sin(angle) * (building.radius + u.radius + 8);
    u.path = this.nav.findPath(u.x, u.y, tx, ty);
    u.pathIndex = 0;
    if (!building.builders.includes(u.id)) building.builders.push(u.id);
  }

  spawnOrderMarker(x, y, type) {
    this.effects.push({
      type: "order",
      sub: type,
      x, y,
      life: 0.65,
      maxLife: 0.65,
      size: type === "attack" ? 23 : 17,
      color: type === "attack" ? "#ff6a74" : "#7cf4ff",
    });
  }

  // -------------------------------------------------------------- production
  hasCompletedBuilding(team, type) {
    return this.buildings.some((b) => b.alive && b.team === team && b.type === type && b.completed);
  }

  queueUnit(building, unitType) {
    const def = UNIT_TYPES[unitType];
    if (!def || !building || building.team !== TEAM.PLAYER || !building.completed) return false;
    if (!BUILDING_TYPES[building.type]?.trains?.includes(unitType)) return false;
    if (building.queue.length >= GAME_RULES.queueLimit) {
      this.audio.error();
      this.emitAlert("Production queue is full.", "danger", null, 0.6);
      return false;
    }
    if (this.players[TEAM.PLAYER].minerals < def.cost) {
      this.audio.error();
      this.emitAlert(`Insufficient ionium. ${def.name} requires ${def.cost}.`, "danger", "PRODUCTION BLOCKED");
      return false;
    }
    if (this.players[TEAM.PLAYER].supplyUsed + def.supply > this.players[TEAM.PLAYER].supplyCap) {
      this.audio.error();
      this.emitAlert("Supply cap reached. Construct a Habitat.", "danger", "SUPPLY BLOCKED");
      return false;
    }
    this.players[TEAM.PLAYER].minerals -= def.cost;
    building.queue.push({
      type: unitType,
      progress: 0,
      total: def.buildTime,
      cost: def.cost,
      supply: def.supply,
    });
    this.audio.trainStart();
    if (building.queue.length === 1) {
      this.emitAlert(`${def.name} queued for fabrication.`, "info", null, 0.35);
    }
    return true;
  }

  cancelQueue(building, index) {
    if (!building || building.team !== TEAM.PLAYER) return;
    const item = building.queue[index];
    if (!item) return;
    building.queue.splice(index, 1);
    this.players[TEAM.PLAYER].minerals += item.cost;
    this.audio.uiClick();
  }

  cancelQueueLast(building) {
    if (!building || !building.queue.length) return;
    this.cancelQueue(building, building.queue.length - 1);
  }

  // ------------------------------------------------------------------ combat
  damage(target, amount, source, splash = false) {
    if (!target || !target.alive) return;
    const armor = target.armor || 0;
    let dmg = Math.max(1, amount - armor);
    if (Math.random() < 0.08) dmg = Math.round(dmg * 1.35);
    target.hp -= dmg;
    target.hitFlash = 0.16;
    target.lastHitAt = this.gameTime;
    if (dmg >= 20) {
      this.effects.push({
        type: "spark",
        x: target.x + rand(-6, 6),
        y: target.y + rand(-6, 6),
        vx: rand(-20, 20),
        vy: rand(-40, -10),
        life: 0.35,
        maxLife: 0.35,
        color: "#ffd08a",
        size: rand(1, 2.5),
      });
    }
    if (target.hp <= 0) this.killEntity(target, source);
  }

  applySplash(x, y, radius, damage, team, source) {
    for (const e of this.entities) {
      if (!e.alive || e.team === team || e.kind === "resource") continue;
      const d = dist(x, y, e.x, e.y);
      if (d <= radius + e.radius) {
        const falloff = 1 - clamp(d / (radius + e.radius), 0, 0.7);
        this.damage(e, damage * falloff, source, true);
      }
    }
  }

  depleteResource(resource) {
    if (!resource || !resource.alive) return;
    resource.alive = false;
    resource.amount = 0;
    this.resources = this.resources.filter((r) => r !== resource);
    this.entities = this.entities.filter((e) => e !== resource);
    for (let i = 0; i < 16; i++) {
      this.effects.push({
        type: "particle",
        x: resource.x + rand(-12, 12),
        y: resource.y + rand(-12, 12),
        vx: rand(-55, 55),
        vy: rand(-75, 15),
        life: rand(0.35, 0.9),
        maxLife: 0.9,
        color: i % 2 ? "#75ecff" : "#d6ffff",
        size: rand(1, 3.4),
        gravity: 65,
        drag: 0.96,
      });
    }
    this.effects.push({
      type: "shockwave", x: resource.x, y: resource.y,
      life: 0.35, maxLife: 0.35, size: 25, color: "#8af2ff",
    });
    this.nav.rebuild();
  }

  killEntity(e, source) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    const isBig = e.kind === "building";
    const color = e.kind === "resource" ? "#7ee9ff" : TEAM_DATA[e.team].color;
    this.spawnExplosion(e.x, e.y, isBig ? 74 : e.radius * 2.6, color, isBig);
    if (isBig) this.audio.explosion(true);
    else if (this.isVisibleAt(e.x, e.y)) this.audio.explosion(false);

    if (e.kind === "unit") {
      this.units = this.units.filter((u) => u !== e);
      if (e.team === TEAM.PLAYER) this.stats.losses++;
      else this.stats.kills++;
      this.deathParticles(e.x, e.y, color);
    } else if (e.kind === "building") {
      this.buildings = this.buildings.filter((b) => b !== e);
      if (e.team === TEAM.ENEMY) this.stats.enemyBuildingsLost++;
      // Free any fabricators assigned to a dismantled construction site.
      for (const u of this.units) {
        if (u.buildTargetId === e.id) {
          u.buildTargetId = null;
          u.order = null;
          u.path = [];
        }
      }
      this.nav.rebuild();
      this.recalcSupply(TEAM.PLAYER);
      this.recalcSupply(TEAM.ENEMY);
      if (e.type === "nexus") {
        if (e.team === TEAM.ENEMY) this.finish("won");
        else this.finish("lost");
      }
      if (e.team === TEAM.ENEMY) {
        this.emitAlert(`${BUILDING_TYPES[e.type].name} destroyed.`, "good", "TARGET ELIMINATED", 0.6);
      }
    } else if (e.kind === "resource") {
      this.resources = this.resources.filter((r) => r !== e);
      this.nav.rebuild();
    }
    if (e.selected) {
      this.selection = this.selection.filter((id) => id !== e.id);
      this.syncSelectedFlags();
    }
    for (const u of this.units) {
      if (u.targetId === e.id) u.targetId = null;
      if (u.autoTargetId === e.id) u.autoTargetId = null;
    }
  }

  spawnExplosion(x, y, size, color, big) {
    const count = big ? 34 : 10;
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const speed = rand(10, big ? 160 : 65);
      this.effects.push({
        type: "particle",
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - rand(0, 25),
        life: rand(0.25, big ? 1.2 : 0.55),
        maxLife: 1.2,
        color: i % 3 === 0 ? "#fff3ca" : i % 3 === 1 ? color : "#ff9d52",
        size: rand(1.5, big ? 5 : 3),
        gravity: 30,
        drag: 0.94,
      });
    }
    this.effects.push({
      type: "explosion",
      x, y,
      life: big ? 1.15 : 0.55,
      maxLife: big ? 1.15 : 0.55,
      size,
      color,
    });
    if (big) {
      for (let i = 0; i < 8; i++) {
        this.effects.push({
          type: "smoke",
          x: x + rand(-size * 0.6, size * 0.6),
          y: y + rand(-size * 0.25, size * 0.25),
          vx: rand(-8, 8),
          vy: rand(-30, -8),
          life: rand(1.4, 3),
          maxLife: 3,
          color: "#23343d",
          size: rand(10, 26),
        });
      }
    }
    this.effects.push({
      type: "shockwave",
      x, y,
      life: big ? 0.7 : 0.28,
      maxLife: big ? 0.7 : 0.28,
      size,
      color,
    });
  }

  deathParticles(x, y, color) {
    for (let i = 0; i < 7; i++) {
      this.effects.push({
        type: "particle",
        x, y,
        vx: rand(-70, 70),
        vy: rand(-90, 25),
        life: rand(0.3, 0.8),
        maxLife: 0.8,
        color: i % 2 ? color : "#b8d8df",
        size: rand(1, 3),
        gravity: 80,
        drag: 0.96,
      });
    }
  }

  fire(unit, target) {
    const atk = unit.attack;
    unit.cooldown = atk.cooldown * (0.94 + Math.random() * 0.12);
    unit.flash = 0.08;
    unit.lastShot = this.gameTime;
    const angle = angleTo(unit.x, unit.y, target.x, target.y);
    unit.turretAngle = angle;
    const muzzle = {
      x: unit.x + Math.cos(angle) * (unit.radius + 8),
      y: unit.y + Math.sin(angle) * (unit.radius + 8),
    };
    const speed = atk.projectile === "bullet" ? 980 : atk.projectile === "plasma" ? 620 : atk.projectile === "shell" ? 390 : 850;
    const projectile = {
      type: "projectile",
      sub: atk.projectile,
      x: muzzle.x,
      y: muzzle.y,
      targetId: target.id,
      targetX: target.x,
      targetY: target.y,
      team: unit.team,
      sourceId: unit.id,
      damage: atk.damage * (0.92 + Math.random() * 0.16),
      splash: atk.splash || 0,
      speed,
      life: 2.5,
      color: unit.team === TEAM.PLAYER ? "#c5fbff" : "#ffb3a2",
    };
    this.projectiles.push(projectile);
    this.effects.push({
      type: "muzzle",
      x: muzzle.x,
      y: muzzle.y,
      angle,
      life: 0.08,
      maxLife: 0.08,
      size: atk.projectile === "shell" ? 11 : 5,
      color: unit.team === TEAM.PLAYER ? "#d6fdff" : "#ff8b73",
    });
    if (this.isVisibleAt(muzzle.x, muzzle.y)) this.audio.attack(atk.projectile);
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const target = this.entities.find((e) => e.id === p.targetId && e.alive);
      if (target) {
        p.targetX = target.x;
        p.targetY = target.y;
      }
      const dx = p.targetX - p.x;
      const dy = p.targetY - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step + (target ? target.radius * 0.4 : 4)) {
        p.x = p.targetX;
        p.y = p.targetY;
        if (p.splash) {
          this.applySplash(p.x, p.y, p.splash, p.damage, p.team, { team: p.team });
          this.effects.push({
            type: "explosion", x: p.x, y: p.y, life: 0.42, maxLife: 0.42,
            size: p.splash * 0.9, color: p.team === TEAM.PLAYER ? "#9befff" : "#ff8d68",
          });
        } else if (target) {
          this.damage(target, p.damage, { team: p.team });
        }
        if (this.isVisibleAt(p.x, p.y)) this.audio.impact();
        this.projectiles.splice(i, 1);
        continue;
      }
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    }
  }

  findTarget(unit, range, includeBuildings = true) {
    let best = null;
    let bestD = Infinity;
    for (const e of this.entities) {
      if (!e.alive || e.team === unit.team || e.kind === "resource") continue;
      if (!includeBuildings && e.kind === "building" && e.type !== "turret") continue;
      if (unit.team === TEAM.PLAYER && e.team === TEAM.ENEMY && !this.isVisibleAt(e.x, e.y)) continue;
      const d = dist(unit.x, unit.y, e.x, e.y) - e.radius;
      if (d <= range && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  updateCombat(unit, dt) {
    if (!unit.attack || !unit.alive) return false;
    if (unit.cooldown > 0) unit.cooldown -= dt;
    let target = null;
    if (unit.targetId) {
      target = this.entities.find((e) => e.id === unit.targetId && e.alive);
      if (!target) {
        unit.targetId = null;
        if (unit.order?.type === "attack") {
          unit.order = null;
          unit.path = [];
        }
      }
    }
    if (!target && unit.autoTargetId) {
      target = this.entities.find((e) => e.id === unit.autoTargetId && e.alive);
      if (!target) unit.autoTargetId = null;
    }
    if (!target) {
      const inRange = this.findTarget(unit, unit.attack.range);
      if (inRange) {
        target = inRange;
        unit.autoTargetId = inRange.id;
      }
    }

    if (!target) return false;

    const d = dist(unit.x, unit.y, target.x, target.y) - target.radius;
    const orderType = unit.order?.type;
    if (d <= unit.attack.range) {
      unit.turretAngle = angleTo(unit.x, unit.y, target.x, target.y);
      if (unit.cooldown <= 0) this.fire(unit, target);
      if (orderType === "attack" || orderType === "attackMove") {
        unit.path = [];
        unit.pathIndex = 0;
      }
      return true;
    }

    // Chase if explicitly ordered / attack-moving, or if the target is very close.
    const shouldChase = orderType === "attack" || orderType === "attackMove" || !!unit.targetId || (unit.autoTargetId && d < unit.sight * 0.55);
    if (shouldChase) {
      unit.repathTimer -= dt;
      if (unit.kind === "unit" && unit.repathTimer <= 0) {
        unit.repathTimer = 0.65;
        const angle = angleTo(target.x, target.y, unit.x, unit.y);
        const standoff = unit.attack.range * 0.82 + target.radius;
        const tx = target.x + Math.cos(angle) * standoff;
        const ty = target.y + Math.sin(angle) * standoff;
        const path = this.nav.findPath(unit.x, unit.y, tx, ty, 10);
        if (path.length) {
          unit.path = path;
          unit.pathIndex = 0;
          unit.chaseTargetId = target.id;
        } else {
          const direct = this.nav.nearestOpen(tx, ty, 6);
          if (direct) {
            unit.path = [direct];
            unit.pathIndex = 0;
          }
        }
      }
      return true;
    }
    if (!orderType || orderType === "hold") {
      unit.autoTargetId = null;
    }
    return false;
  }

  // ----------------------------------------------------------------- mining
  updateWorker(unit, dt) {
    if (!unit.isWorker) return;
    const order = unit.order;
    if (!order) return;

    if (order.type === "gather") {
      const node = this.entities.find((e) => e.id === order.resourceId && e.alive && e.kind === "resource");
      if (!node || node.amount <= 0) {
        const replacement = this.findNearestResource(unit.x, unit.y, unit.team);
        if (replacement) this.orderGather(unit, replacement);
        else {
          unit.order = null;
          unit.path = [];
        }
        return;
      }
      if (unit.phase === "toNode" || !unit.phase) {
        if (unit.path.length) return;
        if (dist(unit.x, unit.y, node.x, node.y) <= node.radius + unit.radius + 26) {
          unit.phase = "mining";
          unit.miningTimer = 1.1;
        } else {
          this.moveWorkerToResource(unit, node);
        }
      } else if (unit.phase === "mining") {
        unit.miningTimer -= dt;
        unit.turretAngle = angleTo(unit.x, unit.y, node.x, node.y);
        if (unit.miningTimer <= 0) {
          const take = Math.min(unit.carryCap, node.amount);
          node.amount -= take;
          unit.carrying = take;
          this.players[unit.team].minerals += 0;
          this.stats.mineralsMined += unit.team === TEAM.PLAYER ? take : 0;
          this.effects.push({
            type: "beam", x: unit.x, y: unit.y, x2: node.x, y2: node.y,
            life: 0.22, maxLife: 0.22, color: "#8ff5ff", width: 2,
          });
          node.hitFlash = 0.15;
          if (node.amount <= 0) {
            const depleted = node;
            const replacement = this.findNearestResource(unit.x, unit.y, unit.team);
            if (replacement && replacement.id !== depleted.id) {
              unit.homeNodeId = replacement.id;
              unit.order.resourceId = replacement.id;
            }
            this.depleteResource(depleted);
          }
          // Head back to the nearest command nexus.
          const core = this.findDropoff(unit);
          if (core) {
            const angle = angleTo(core.x, core.y, unit.x, unit.y);
            const tx = core.x + Math.cos(angle) * (core.radius + unit.radius + 8);
            const ty = core.y + Math.sin(angle) * (core.radius + unit.radius + 8);
            unit.path = this.nav.findPath(unit.x, unit.y, tx, ty);
            unit.pathIndex = 0;
            unit.phase = "toBase";
          } else {
            unit.phase = "mining";
            unit.miningTimer = 1.5;
          }
          if (unit.team === TEAM.PLAYER) this.audio.gather();
        }
      } else if (unit.phase === "toBase") {
        const core = this.findDropoff(unit);
        if (!core) {
          unit.phase = "mining";
          unit.miningTimer = 1;
          return;
        }
        if (dist(unit.x, unit.y, core.x, core.y) <= core.radius + unit.radius + 28) {
          if (unit.carrying > 0) {
            this.players[unit.team].minerals += unit.carrying;
            if (unit.team === TEAM.PLAYER) {
              this.stats.mineralsMined += 0;
              this.audio.deposit();
              this.effects.push({
                type: "deposit", x: core.x, y: core.y - 12, life: 0.65, maxLife: 0.65,
                text: `+${unit.carrying}`, color: "#ffd27c",
              });
            }
            unit.carrying = 0;
          }
          const targetNode = this.resources.find((r) => r.id === unit.order.resourceId && r.alive && r.amount > 0) ||
            this.findNearestResource(core.x, core.y, unit.team);
          if (targetNode) {
            unit.order.resourceId = targetNode.id;
            this.moveWorkerToResource(unit, targetNode);
          } else {
            unit.order = null;
            unit.path = [];
          }
        } else if (!unit.path.length) {
          const angle = angleTo(core.x, core.y, unit.x, unit.y);
          unit.path = this.nav.findPath(unit.x, unit.y, core.x + Math.cos(angle) * (core.radius + 20), core.y + Math.sin(angle) * (core.radius + 20));
          unit.pathIndex = 0;
        }
      }
    } else if (order.type === "build") {
      const building = this.entities.find((e) => e.id === order.targetId && e.alive && e.kind === "building");
      if (!building) {
        unit.order = null;
        unit.buildTargetId = null;
        this.autoGather(unit);
        return;
      }
      if (building.completed) {
        unit.order = null;
        unit.buildTargetId = null;
        const core = this.findDropoff(unit);
        this.autoGather(unit);
        return;
      }
      const d = dist(unit.x, unit.y, building.x, building.y);
      if (d <= building.radius + unit.radius + 22) {
        unit.phase = "constructing";
        unit.turretAngle = angleTo(unit.x, unit.y, building.x, building.y);
        if (!building.builders.includes(unit.id)) building.builders.push(unit.id);
        const progress = dt / building.buildTime;
        building.buildProgress = clamp(building.buildProgress + progress, 0, 1);
        building.hp = Math.max(building.hp, building.maxHp * (0.08 + 0.92 * building.buildProgress));
        if (Math.random() < dt * 4) {
          this.effects.push({
            type: "buildSpark", x: building.x + rand(-building.radius, building.radius),
            y: building.y + rand(-building.radius, building.radius),
            vx: rand(-12, 12), vy: rand(-25, -5),
            life: rand(0.25, 0.5), maxLife: 0.5, color: "#ffe2a0", size: rand(1, 2),
          });
        }
        if (building.buildProgress >= 1) {
          this.completeBuilding(building);
          unit.order = null;
          unit.buildTargetId = null;
          this.autoGather(unit);
        }
      } else if (!unit.path.length) {
        const angle = angleTo(building.x, building.y, unit.x, unit.y);
        unit.path = this.nav.findPath(
          unit.x, unit.y,
          building.x + Math.cos(angle) * (building.radius + unit.radius + 12),
          building.y + Math.sin(angle) * (building.radius + unit.radius + 12)
        );
        unit.pathIndex = 0;
        unit.phase = "toBuild";
      }
    }
  }

  findDropoff(unit) {
    const cores = this.buildings.filter((b) => b.alive && b.team === unit.team && b.completed && b.type === "nexus");
    if (!cores.length) return null;
    cores.sort((a, b) => dist2(unit.x, unit.y, a.x, a.y) - dist2(unit.x, unit.y, b.x, b.y));
    return cores[0];
  }

  completeBuilding(building) {
    if (!building) return;
    building.completed = true;
    building.buildProgress = 1;
    building.hp = building.maxHp;
    this.recalcSupply(building.team);
    this.nav.rebuild();
    this.audio.structureComplete();
    if (building.team === TEAM.PLAYER) {
      this.stats.structuresBuilt++;
      this.emitAlert(`${BUILDING_TYPES[building.type].name} online.`, "good", "CONSTRUCTION COMPLETE");
    }
    // Newly completed production structures should have a sensible rally.
    if (BUILDING_TYPES[building.type].trains?.length && !building.rally) {
      const core = this.findDropoff(building);
      building.rally = core ? { x: core.x + (building.team === TEAM.PLAYER ? -100 : 100), y: core.y + rand(-50, 50) } : { x: building.x, y: building.y + 100 };
    }
  }

  recalcSupply(team) {
    if (!this.players?.[team]) return;
    let cap = 0;
    for (const b of this.buildings) {
      if (b.team !== team || !b.alive || !b.completed) continue;
      cap += BUILDING_TYPES[b.type]?.supply || 0;
    }
    let used = 0;
    for (const u of this.units) if (u.team === team && u.alive) used += u.supply || 0;
    this.players[team].supplyCap = cap;
    this.players[team].supplyUsed = used;
  }

  // ------------------------------------------------------------- production
  updateBuilding(building, dt) {
    if (!building.completed) return;
    if (building.cooldown > 0) building.cooldown -= dt;
    if (building.attack) {
      if (building.cooldown < 0) building.cooldown = 0;
      const target = this.findTarget(building, building.attack.range, false);
      if (target) {
        building.turretAngle = angleTo(building.x, building.y, target.x, target.y);
        if (building.cooldown <= 0) this.fire(building, target);
      }
    }
    if (!building.queue.length) return;
    const item = building.queue[0];
    item.progress += dt;
    if (item.progress >= item.total) {
      const def = UNIT_TYPES[item.type];
      if (this.players[building.team].supplyUsed + item.supply > this.players[building.team].supplyCap) {
        // Hold production until supply opens up instead of silently losing the unit.
        item.progress = item.total;
        if (building.team === TEAM.PLAYER) {
          this.emitAlert("Unit ready but supply is capped. Construct a Habitat.", "danger", "SUPPLY BLOCKED", 4);
        }
        return;
      }
      building.queue.shift();
      this.spawnFromBuilding(building, item.type);
    }
  }

  spawnFromBuilding(building, type) {
    const def = UNIT_TYPES[type];
    let x, y;
    let spawn = null;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + rand(-0.18, 0.18);
      const r = building.radius + def.radius + 14 + Math.floor(i / 9) * 12;
      const px = building.x + Math.cos(a) * r;
      const py = building.y + Math.sin(a) * r;
      if (!this.nav?.isBlockedPoint(px, py)) {
        x = px;
        y = py;
        spawn = { x, y };
        break;
      }
    }
    if (!spawn) {
      const open = this.nav.nearestOpen(building.x + building.radius + 24, building.y, 18);
      x = open?.x ?? building.x + building.radius + 20;
      y = open?.y ?? building.y;
    }
    const u = this.addUnit(type, building.team, x, y);
    this.recalcSupply(building.team);
    if (building.team === TEAM.PLAYER) {
      this.stats.unitsTrained++;
      this.audio.trainComplete();
      this.emitAlert(`${def.name} deployed.`, "good", null, 0.5);
    }
    if (u.isWorker) {
      let gathering = false;
      if (building.rally?.resourceId) {
        const node = this.resources.find((r) => r.id === building.rally.resourceId && r.alive);
        if (node) {
          this.orderGather(u, node);
          gathering = true;
        } else {
          this.autoGather(u);
          gathering = true;
        }
      } else if (!building.rally) {
        this.autoGather(u);
        gathering = true;
      }
      // A ground rally overrides the default auto-gather, but a resource
      // rally must stay a gather order so the new worker actually mines.
      if (building.rally && !gathering) {
        this.orderMove(u, building.rally.x + rand(-15, 15), building.rally.y + rand(-15, 15));
      }
    } else if (building.rally) {
      this.orderMove(u, building.rally.x + rand(-30, 30), building.rally.y + rand(-30, 30));
    } else {
      const core = this.findDropoff(u);
      if (core) this.orderMove(u, core.x + (u.team === TEAM.PLAYER ? 90 : -90) + rand(-20, 20), core.y + rand(-30, 30));
    }
    this.fogDirty = true;
    return u;
  }

  // ------------------------------------------------------------ unit update
  updateUnit(unit, dt) {
    if (!unit.alive) return;
    if (unit.cooldown > 0) unit.cooldown -= dt;
    if (unit.hitFlash > 0) unit.hitFlash -= dt;
    if (unit.flash > 0) unit.flash -= dt;
    unit.walkCycle += dt * 8;
    unit.wasMoving = false;

    const order = unit.order;
    if (unit.isWorker) {
      if (!order || (order.type !== "build")) this.updateWorker(unit, dt);
      else this.updateWorker(unit, dt);
    }

    if (unit.isWorker && order && (order.type === "gather" || order.type === "build")) {
      this.moveAlongPath(unit, dt);
      if (order.type === "gather") {
        // Mining and deposit animations use the worker update above; movement remains
        // active while returning to base.
      }
      return;
    }

    if (!unit.attack) {
      this.moveAlongPath(unit, dt);
      if (unit.order?.type === "hold") unit.path = [];
      return;
    }

    this.updateCombat(unit, dt);
    this.moveAlongPath(unit, dt);

    if (unit.order?.type === "attackMove") {
      const enemy = this.findTarget(unit, unit.sight * 0.72);
      // Only re-acquire when the current target changes. Resetting the repath
      // timer every frame caused units to re-path to the same nearby waypoint
      // and freeze in place instead of advancing along their path.
      if (enemy && enemy.id !== unit.targetId) {
        unit.targetId = enemy.id;
        unit.repathTimer = 0;
      }
      // If chasing a target emptied the path, resume marching toward the
      // original attack-move destination instead of standing idle forever.
      if (!unit.path.length && !unit.targetId) {
        const dest = unit.order;
        if (dist(unit.x, unit.y, dest.x, dest.y) > unit.radius + 12) {
          unit.repathTimer -= dt;
          if (unit.repathTimer <= 0) {
            unit.repathTimer = 0.7;
            const path = this.nav.findPath(unit.x, unit.y, dest.x, dest.y, unit.radius + 4);
            if (path.length) {
              unit.path = path;
              unit.pathIndex = 0;
            } else {
              unit.order = null;
            }
          }
        }
      }
    }
  }

  moveAlongPath(unit, dt) {
    if (!unit.path.length) {
      if (unit.order?.type === "move" && !unit.targetId) {
        unit.order = null;
        unit.path = [];
      }
      if (unit.order?.type === "hold") unit.path = [];
      return;
    }
    const wp = unit.path[unit.pathIndex];
    if (!wp) {
      unit.path = [];
      return;
    }
    let dx = wp.x - unit.x;
    let dy = wp.y - unit.y;
    let d = Math.hypot(dx, dy);
    const arrive = unit.radius + 7;
    if (d <= arrive) {
      unit.pathIndex++;
      if (unit.pathIndex >= unit.path.length) {
        unit.path = [];
        unit.pathIndex = 0;
        if (unit.order?.type === "move" && !unit.targetId) {
          unit.order = null;
        }
        if (unit.isWorker) {
          if (unit.phase === "toNode" || unit.phase === "toBuild") {
            // worker update notices arrival on the next tick
          }
        }
      }
      return;
    }
    const previousX = unit.x;
    const previousY = unit.y;
    const step = Math.min(unit.speed * dt, d);
    const nx = unit.x + (dx / d) * step;
    const ny = unit.y + (dy / d) * step;
    if (!this.nav?.isBlockedPoint(nx, ny)) {
      unit.x = nx;
      unit.y = ny;
      unit.wasMoving = true;
    } else {
      // Try sliding along one axis, then request a fresh path.
      if (!this.nav?.isBlockedPoint(nx, unit.y)) unit.x = nx;
      else if (!this.nav?.isBlockedPoint(unit.x, ny)) unit.y = ny;
      else {
        unit.path = [];
        if (unit.order?.type === "move" || unit.order?.type === "attackMove" || unit.isWorker) {
          unit.repathTimer = 0;
        }
      }
    }
    if (unit.wasMoving) {
      const targetAngle = Math.atan2(ny - previousY, nx - previousX);
      unit.angle = rotateTowards(unit.angle, targetAngle, dt * 9);
      unit.turretAngle = unit.angle;
    }
  }

  separateUnits(dt) {
    const units = this.units;
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.radius + b.radius) * 0.92;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.001 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.45;
          const nx = dx / d;
          const ny = dy / d;
          const ax = a.x - nx * push;
          const ay = a.y - ny * push;
          const bx = b.x + nx * push;
          const by = b.y + ny * push;
          if (!this.nav?.isBlockedPoint(ax, ay)) {
            a.x = ax;
            a.y = ay;
          }
          if (!this.nav?.isBlockedPoint(bx, by)) {
            b.x = bx;
            b.y = by;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------- AI
  updateAI(dt) {
    if (!this.ai) return;
    this.ai.thinkTimer -= dt;
    this.ai.buildCooldown -= dt;
    this.ai.incomeTimer -= dt;
    this.ai.waveTimer -= dt;
    const difficulty = this.difficulty;
    const enemy = TEAM.ENEMY;
    const p = this.players[enemy];

    if (this.ai.incomeTimer <= 0) {
      this.ai.incomeTimer = 1;
      p.minerals += 3.4 * difficulty.aiIncome;
    }

    if (this.ai.waveTimer <= 0) {
      this.launchWave();
    }

    if (this.ai.thinkTimer > 0) return;
    this.ai.thinkTimer = 1.3 / difficulty.aiAggression;

    const core = this.buildings.find((b) => b.team === enemy && b.type === "nexus" && b.alive);
    if (!core) return;
    const myUnits = this.units.filter((u) => u.team === enemy && u.alive);
    const workers = myUnits.filter((u) => u.isWorker);
    const army = myUnits.filter((u) => !u.isWorker);
    const barracks = this.buildings.find((b) => b.team === enemy && b.type === "barracks" && b.alive && b.completed);
    const foundry = this.buildings.find((b) => b.team === enemy && b.type === "foundry" && b.alive && b.completed);
    const habitatCount = this.buildings.filter((b) => b.team === enemy && b.type === "habitat" && b.alive).length;
    const turretCount = this.buildings.filter((b) => b.team === enemy && b.type === "turret" && b.alive).length;

    // Worker economy.
    if (workers.length < (this.difficultyKey === "overlord" ? 13 : 10)) {
      if (core.queue.length < 1 && p.minerals >= UNIT_TYPES.fabricator.cost && p.supplyUsed < p.supplyCap) {
        this.aiTrain(core, "fabricator");
      }
    }

    // Supply.
    if (p.supplyCap - p.supplyUsed <= 2 && this.ai.buildCooldown <= 0) {
      this.aiBuild("habitat", core);
    }

    // Tech tree.
    if (!barracks && this.ai.buildCooldown <= 0) this.aiBuild("barracks", core);
    if (barracks && !foundry && p.minerals > 300 && this.ai.buildCooldown <= 0) this.aiBuild("foundry", core);
    if (barracks && turretCount < 5 && army.length > 5 && this.ai.buildCooldown <= 0 && Math.random() < 0.35) this.aiBuild("turret", core);
    if (habitatCount < 2 && p.minerals > 220 && this.ai.buildCooldown <= 0 && p.supplyCap - p.supplyUsed < 8) {
      this.aiBuild("habitat", core);
    }

    // Army production.
    if (barracks && barracks.queue.length < 2 && p.supplyUsed < p.supplyCap && p.minerals >= UNIT_TYPES.trooper.cost) {
      let type = "trooper";
      const roll = Math.random();
      if (foundry && p.minerals >= UNIT_TYPES.juggernaut.cost && roll > 0.75) type = "juggernaut";
      else if (p.minerals >= UNIT_TYPES.lancer.cost && roll > 0.45) type = "lancer";
      this.aiTrain(barracks, type);
    }

    // Production buildings occasionally gather their own army units.
    const idleArmy = army.filter((u) => !u.order && u.x > 1900);
    if (idleArmy.length >= 3 && this.ai.waveTimer < 12) {
      for (const u of idleArmy) this.orderAttackMove(u, 1800, 1100 + rand(-250, 250));
    }

    // Reinforce a wave currently marching.
    if (this.ai.attacking) {
      const marching = army.filter((u) => u.order?.type === "attackMove");
      if (marching.length < 2 && this.ai.squad.length === 0) this.ai.attacking = false;
    }
  }

  aiTrain(building, type) {
    const def = UNIT_TYPES[type];
    const p = this.players[TEAM.ENEMY];
    if (!def || !building || !building.alive) return;
    if (building.queue.length >= 3) return;
    if (p.minerals < def.cost) return;
    if (p.supplyUsed + def.supply > p.supplyCap) return;
    p.minerals -= def.cost;
    building.queue.push({ type, progress: 0, total: def.buildTime * this.difficulty.aiBuild, cost: def.cost, supply: def.supply });
  }

  aiBuild(type, core) {
    const def = BUILDING_TYPES[type];
    if (!def || !core) return false;
    if (this.players[TEAM.ENEMY].minerals < def.cost) return false;
    if (def.requires?.some((r) => !this.hasCompletedBuilding(TEAM.ENEMY, r))) return false;
    let site = null;
    for (let i = 0; i < 42; i++) {
      const a = rand(0, TAU);
      const r = rand(150, 380);
      const x = core.x + Math.cos(a) * r;
      const y = core.y + Math.sin(a) * r;
      if (this.canPlaceBuilding(type, x, y, TEAM.ENEMY, false)) {
        site = { x, y };
        break;
      }
    }
    if (!site) {
      for (let r = 100; r < 460 && !site; r += 34) {
        for (let a = 0; a < TAU; a += Math.PI / 5) {
          const x = core.x + Math.cos(a) * r;
          const y = core.y + Math.sin(a) * r;
          if (this.canPlaceBuilding(type, x, y, TEAM.ENEMY, false)) {
            site = { x, y };
            break;
          }
        }
      }
    }
    if (!site) return false;
    this.players[TEAM.ENEMY].minerals -= def.cost;
    const b = this.addBuilding(type, TEAM.ENEMY, site.x, site.y, false);
    const workers = this.units.filter((u) => u.team === TEAM.ENEMY && u.isWorker && u.alive);
    workers.sort((a, b2) => dist2(a.x, a.y, site.x, site.y) - dist2(b2.x, b2.y, site.x, site.y));
    const builder = workers[0];
    if (builder) {
      this.orderBuild(builder, b);
    } else {
      b.buildProgress = 0.94;
      b.hp = b.maxHp * 0.94;
    }
    this.ai.buildCooldown = 5.5 / this.difficulty.aiAggression;
    return true;
  }

  launchWave() {
    const core = this.buildings.find((b) => b.team === TEAM.ENEMY && b.type === "nexus" && b.alive);
    if (!core) return;
    const army = this.units.filter((u) => u.team === TEAM.ENEMY && u.alive && !u.isWorker);
    const ready = army.filter((u) => !u.order || (u.order.type === "attackMove" && dist(u.x, u.y, core.x, core.y) < 700));
    const targetCore = this.buildings.find((b) => b.team === TEAM.PLAYER && b.type === "nexus" && b.alive);
    const target = targetCore || this.units.find((u) => u.team === TEAM.PLAYER && u.alive);
    if (!target) return;
    const threshold = this.difficultyKey === "cadet" ? 3 : this.difficultyKey === "overlord" ? 2 : 3;
    const waveSize = clamp(Math.floor(2 + this.stats.waveCount * 0.55 + this.difficulty.aiAggression * 2), 3, this.difficulty.aiMaxArmy);
    let sent = 0;
    for (const u of ready) {
      if (sent >= waveSize) break;
      this.orderAttackMove(u, target.x + rand(-90, 90), target.y + rand(-110, 110));
      sent++;
    }
    this.stats.waveCount++;
    if (sent >= threshold) {
      this.ai.attacking = true;
      this.ai.waveTimer = this.difficulty.aiWaveGap * (0.9 + Math.random() * 0.2);
      this.emitAlert("Korvax strike group moving on your position.", "danger", "HOSTILE ASSAULT");
      this.audio.alert();
    } else {
      this.ai.waveTimer = 20;
    }
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    if (this.state === "menu") {
      this.menuTime += dt;
      this.camera.x = 1600 + Math.sin(this.menuTime * 0.035) * 250;
      this.camera.y = 1100 + Math.cos(this.menuTime * 0.027) * 130;
      this.camera.zoom = 0.9;
      this.updateEffects(dt);
      return;
    }
    if (this.state !== "playing") return;

    this.gameTime += dt;
    this.updateCamera(dt);
    this.fog.timer -= dt;
    if (this.fog.timer <= 0) {
      this.fog.timer = 0.16;
      this.updateFog();
    }

    for (const b of this.buildings) this.updateBuilding(b, dt);
    for (const u of this.units) this.updateUnit(u, dt);
    this.separateUnits(dt);
    this.updateProjectiles(dt);
    this.updateAI(dt);
    this.updateEffects(dt);

    // Unit idle auto-acquisition for static defenders.
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.team === TEAM.PLAYER && u.isWorker) {
        if (u.lastHitAt && this.gameTime - u.lastHitAt < 1.2) {
          const enemy = this.findTarget(u, 170);
          if (enemy) {
            const core = this.findDropoff(u);
            if (core) this.orderMove(u, core.x + rand(-30, 30), core.y + rand(-30, 30));
          }
        }
      }
    }

    if (Math.floor(this.gameTime) % 2 === 0) this.recalcSupply(TEAM.PLAYER);
    if (this.stats.commands > 0 && this.gameTime > 8) {
      // Command count display is derived in UI; stats APM stays intentionally discrete.
    }
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.life <= 0) {
        this.effects.splice(i, 1);
        continue;
      }
      if (e.vx !== undefined) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.gravity) e.vy += e.gravity * dt;
        if (e.drag) {
          e.vx *= Math.pow(e.drag, dt * 60);
          e.vy *= Math.pow(e.drag, dt * 60);
        }
      }
      if (e.type === "smoke") {
        e.size += dt * 8;
      }
    }
    if (this.effects.length > 600) this.effects.splice(0, this.effects.length - 600);
  }

  finish(result) {
    if (this.state !== "playing") return;
    this.state = result;
    this.buildMode = null;
    this.pendingCommand = null;
    if (result === "won") this.audio.victory();
    else this.audio.defeat();
    if (this.onEnd) this.onEnd(result);
  }

  // ---------------------------------------------------------------- queries
  getPlayerStats() {
    const p = this.players[TEAM.PLAYER];
    const workers = this.units.filter((u) => u.team === TEAM.PLAYER && u.isWorker && u.alive).length;
    const army = this.units.filter((u) => u.team === TEAM.PLAYER && !u.isWorker && u.alive).length;
    return {
      time: this.gameTime,
      minerals: p.minerals,
      supplyUsed: p.supplyUsed,
      supplyCap: p.supplyCap,
      workers,
      army,
      kills: this.stats.kills,
      losses: this.stats.losses,
      unitsTrained: this.stats.unitsTrained,
      mineralsMined: this.stats.mineralsMined,
      structuresBuilt: this.stats.structuresBuilt,
      enemyBuildingsLost: this.stats.enemyBuildingsLost,
      waveCount: this.stats.waveCount,
      apm: this.gameTime > 0 ? Math.round((this.stats.commands / this.gameTime) * 60) : 0,
    };
  }

  getThreatLevel() {
    if (this.state !== "playing") return 0;
    const aiArmy = this.units.filter((u) => u.team === TEAM.ENEMY && !u.isWorker).length;
    const wave = this.ai?.waveTimer ?? 999;
    let score = aiArmy * 0.55 + (wave < 15 ? 3 : wave < 30 ? 2 : wave < 50 ? 1 : 0);
    if (this.stats.waveCount > 3) score += 1;
    return clamp(Math.ceil(score / 4), 1, 5);
  }

  getEnemyCoreHealth() {
    const core = this.buildings.find((b) => b.team === TEAM.ENEMY && b.type === "nexus" && b.alive);
    if (!core) return 0;
    return core.hp / core.maxHp;
  }
}

import { clamp, dist } from "./utils.js";

export class InputController {
  constructor(canvas, game, ui, callbacks = {}) {
    this.canvas = canvas;
    this.game = game;
    this.ui = ui;
    this.callbacks = callbacks;
    this.keys = new Set();
    this.leftDown = false;
    this.dragging = false;
    this.panning = false;
    this.dragStart = { x: 0, y: 0 };
    this.panLast = { x: 0, y: 0 };
    this.pointer = { x: 0, y: 0, inside: false };
    this.lastClick = { id: null, time: 0 };
    this.touchPointers = new Map();
    this.pinch = null;
    this.touchMoved = false;
    this.bind();
  }

  bind() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerenter", () => {
      this.pointer.inside = true;
    });
    c.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
    });
    c.addEventListener("pointermove", (e) => this.onPointerMove(e));
    c.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    c.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => this.onKeyUp(e));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.leftDown = false;
      this.dragging = false;
      this.panning = false;
      this.game.selectionBox = null;
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.game.state === "playing") this.callbacks.onAutoPause?.();
    });
  }

  setScreenPosition(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = e.clientX - rect.left;
    this.pointer.y = e.clientY - rect.top;
    const w = this.game.screenToWorld(this.pointer.x, this.pointer.y);
    this.game.pointer.worldX = w.x;
    this.game.pointer.worldY = w.y;
    this.game.pointer.inside = true;
  }

  onPointerMove(e) {
    this.setScreenPosition(e);
    if (e.pointerType === "touch") {
      this.handleTouchMove(e);
      return;
    }
    if (this.panning) {
      const dx = e.clientX - this.panLast.x;
      const dy = e.clientY - this.panLast.y;
      this.panLast = { x: e.clientX, y: e.clientY };
      this.panCamera(dx, dy);
      return;
    }
    if (this.leftDown && e.buttons & 1) {
      const dx = this.pointer.x - this.dragStart.x;
      const dy = this.pointer.y - this.dragStart.y;
      if (!this.dragging && Math.hypot(dx, dy) > 6) this.dragging = true;
      if (this.dragging) {
        this.game.selectionBox = {
          x1: this.dragStart.x,
          y1: this.dragStart.y,
          x2: this.pointer.x,
          y2: this.pointer.y,
        };
      }
    }
    this.updateCursor();
  }

  updateCursor() {
    if (this.game.state !== "playing") {
      this.canvas.classList.remove("is-building", "is-commanding");
      return;
    }
    if (this.game.buildMode) this.canvas.classList.add("is-building");
    else this.canvas.classList.remove("is-building");
    if (this.game.pendingCommand === "attack") this.canvas.classList.add("is-commanding");
    else this.canvas.classList.remove("is-commanding");
  }

  panCamera(dx, dy) {
    const z = this.game.camera.zoom;
    this.game.cameraTarget.x -= dx / z;
    this.game.cameraTarget.y -= dy / z;
    this.game.camera.x -= dx / z;
    this.game.camera.y -= dy / z;
    this.game.clampCamera();
  }

  onPointerDown(e) {
    this.setScreenPosition(e);
    if (this.game.state === "menu") return;
    if (e.pointerType === "touch") {
      this.onTouchDown(e);
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
      this.panning = true;
      this.panLast = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      this.handleRightClick();
      return;
    }
    if (e.button === 0) {
      if (this.game.state !== "playing") return;
      this.leftDown = true;
      this.dragging = false;
      this.dragStart = { x: this.pointer.x, y: this.pointer.y };
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  onPointerUp(e) {
    if (e.pointerType === "touch") {
      this.onTouchUp(e);
      return;
    }
    if (e.button === 1) {
      this.panning = false;
      return;
    }
    if (e.button !== 0) return;
    if (e.pointerType === "touch") return;
    const wasDragging = this.dragging;
    this.leftDown = false;
    if (this.game.state !== "playing") {
      this.dragging = false;
      this.game.selectionBox = null;
      return;
    }
    if (wasDragging) {
      const a = this.game.screenToWorld(this.dragStart.x, this.dragStart.y);
      const b = this.game.screenToWorld(this.pointer.x, this.pointer.y);
      this.game.boxSelect(a.x, a.y, b.x, b.y, e.shiftKey);
      this.dragging = false;
      this.game.selectionBox = null;
      return;
    }
    this.dragging = false;
    this.game.selectionBox = null;
    const w = this.game.screenToWorld(this.pointer.x, this.pointer.y);
    if (this.game.buildMode) {
      this.game.placeBuilding(w.x, w.y);
      return;
    }
    if (this.game.pendingCommand === "attack") {
      this.game.executeAttackMove(w.x, w.y);
      return;
    }
    if (e.shiftKey) {
      this.game.selectAt(w.x, w.y, true);
      return;
    }
    const before = this.game.entityAt(w.x, w.y);
    const now = performance.now();
    if (before && this.lastClick.id === before.id && now - this.lastClick.time < 330) {
      this.game.selectAllOfType(before);
      this.lastClick = { id: null, time: 0 };
      return;
    }
    this.lastClick = { id: before?.id || null, time: now };
    this.game.selectAt(w.x, w.y, false);
  }

  handleRightClick() {
    const game = this.game;
    const w = game.screenToWorld(this.pointer.x, this.pointer.y);
    if (game.buildMode || game.pendingCommand) {
      game.cancelMode();
      return;
    }
    game.issueContextOrder(w.x, w.y);
  }

  onWheel(e) {
    if (this.game.state !== "playing") return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const anchor = this.game.screenToWorld(sx, sy);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this.game.setZoom(this.game.camera.zoom * factor, anchor);
    this.game.cameraTarget.x = this.game.camera.x;
    this.game.cameraTarget.y = this.game.camera.y;
  }

  // --------------------------------------------------------------- touch
  onTouchDown(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.touchMoved = false;
    if (this.touchPointers.size === 1) {
      this.touchStart = { x: e.clientX, y: e.clientY, time: performance.now() };
      this.touchLast = { x: e.clientX, y: e.clientY };
      this.touchPanning = false;
    } else if (this.touchPointers.size === 2) {
      const pts = [...this.touchPointers.values()];
      this.pinch = {
        dist: dist(pts[0].x, pts[0].y, pts[1].x, pts[1].y),
        zoom: this.game.camera.zoom,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
      };
      this.touchPanning = false;
    }
  }

  handleTouchMove(e) {
    if (!this.touchPointers.has(e.pointerId)) return;
    this.touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touchPointers.size >= 2 && this.pinch) {
      const pts = [...this.touchPointers.values()];
      const d = dist(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const rect = this.canvas.getBoundingClientRect();
      const worldAnchor = this.game.screenToWorld(cx - rect.left, cy - rect.top);
      this.game.setZoom(this.pinch.zoom * (d / Math.max(1, this.pinch.dist)), worldAnchor);
      const dx = cx - this.pinch.cx;
      const dy = cy - this.pinch.cy;
      this.panCamera(-dx, -dy);
      this.pinch.cx = cx;
      this.pinch.cy = cy;
      this.touchMoved = true;
      return;
    }
    if (this.touchPointers.size === 1 && this.touchStart) {
      const dx = e.clientX - this.touchLast.x;
      const dy = e.clientY - this.touchLast.y;
      if (Math.hypot(e.clientX - this.touchStart.x, e.clientY - this.touchStart.y) > 9) {
        this.touchMoved = true;
        this.touchPanning = true;
      }
      if (this.touchPanning) this.panCamera(dx, dy);
      this.touchLast = { x: e.clientX, y: e.clientY };
    }
  }

  onTouchUp(e) {
    const had = this.touchPointers.has(e.pointerId);
    this.touchPointers.delete(e.pointerId);
    if (!had) return;
    if (this.touchPointers.size === 1) {
      const p = [...this.touchPointers.values()][0];
      this.touchLast = { x: p.x, y: p.y };
      this.pinch = null;
      this.touchStart = { x: p.x, y: p.y, time: performance.now() };
      this.touchPanning = false;
      this.touchMoved = false;
      return;
    }
    if (this.touchPointers.size > 0) return;
    const wasPinch = !!this.pinch || this.touchPointers.size > 0;
    this.pinch = null;
    if (this.touchMoved || this.game.state !== "playing") {
      this.touchMoved = false;
      return;
    }
    // A tap: select friendly units; if something is already selected, tap issues orders.
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = this.game.screenToWorld(sx, sy);
    const hit = this.game.entityAt(w.x, w.y);
    if (hit && hit.team === 0) {
      const now = performance.now();
      if (this.lastClick.id === hit.id && now - this.lastClick.time < 360) {
        this.game.selectAllOfType(hit);
        this.lastClick = { id: null, time: 0 };
        return;
      }
      this.lastClick = { id: hit.id, time: now };
      this.game.selectAt(w.x, w.y, false);
      return;
    }
    if (this.game.selection.length) {
      if (this.game.buildMode) this.game.placeBuilding(w.x, w.y);
      else if (this.game.pendingCommand === "attack") this.game.executeAttackMove(w.x, w.y);
      else if (hit?.team === 1) this.game.issueContextOrder(w.x, w.y);
      else if (this.game.resourceAt(w.x, w.y)) this.game.issueContextOrder(w.x, w.y);
      else if (hit?.team === 2 || hit?.team === 1) this.game.issueContextOrder(w.x, w.y);
      else this.game.issueContextOrder(w.x, w.y);
      return;
    }
    this.game.selectAt(w.x, w.y, false);
  }

  // -------------------------------------------------------------- keyboard
  onKeyDown(e) {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const key = e.key;
    const lower = key.toLowerCase();
    if (key === "Tab" || key === " " || key.startsWith("Arrow")) e.preventDefault();
    if (key === "Escape") {
      if (this.ui.pauseVisible) {
        this.callbacks.onResume?.();
        return;
      }
      if (this.game.buildMode || this.game.pendingCommand) {
        this.game.cancelMode();
        return;
      }
      if (this.game.state === "playing") this.callbacks.onPauseToggle?.();
      return;
    }
    if (this.game.state === "menu") {
      if (key === "Enter") this.ui.dom.deployButton.click();
      return;
    }
    if (key === "p" || key === "P") {
      if (this.game.state === "playing" || this.game.state === "paused") this.callbacks.onPauseToggle?.();
      return;
    }
    if (key === "m" || key === "M") {
      this.ui.dom.soundButton.click();
      return;
    }
    if (this.game.state !== "playing") return;

    if (e.ctrlKey && /^[1-9]$/.test(key)) {
      e.preventDefault();
      this.game.setControlGroup(Number(key));
      return;
    }
    if (!e.ctrlKey && /^[1-9]$/.test(key)) {
      this.game.recallControlGroup(Number(key));
      return;
    }
    if (key === "F1") {
      e.preventDefault();
      this.game.cycleIdleWorker();
      return;
    }
    if (key === "F2") {
      e.preventDefault();
      this.game.selectAllArmy();
      return;
    }
    if (key === "F3") {
      e.preventDefault();
      this.game.selectAllWorkers();
      return;
    }
    if (key === " ") {
      this.game.selectBase();
      return;
    }
    if (key === "+" || key === "=") {
      this.game.setZoom(this.game.camera.zoom * 1.12);
      return;
    }
    if (key === "-" || key === "_") {
      this.game.setZoom(this.game.camera.zoom * 0.89);
      return;
    }
    if (["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key) || ["w", "a", "s", "d"].includes(lower)) {
      this.keys.add(lower === "arrowup" ? "w" : lower === "arrowdown" ? "s" : lower === "arrowleft" ? "a" : lower === "arrowright" ? "d" : lower);
      // Still allow A and S command hotkeys when modifiers aren't held and the
      // player has a selection; camera keys follow the standard RTS compromise.
      if ((lower === "a" || lower === "s") && !e.repeat) {
        const handled = this.ui.triggerHotkey(lower);
        if (handled) {
          // Do not keep the camera scrolling if the key was consumed as a command.
          this.keys.delete(lower);
          e.preventDefault();
          return;
        }
      }
      return;
    }
    if (lower === "h" || lower === "g" || lower === "q" || lower === "e" || lower === "r" || lower === "t" || lower === "l" || lower === "j" || lower === "f" || lower === "x") {
      if (this.ui.triggerHotkey(lower)) {
        e.preventDefault();
        return;
      }
    }
    if (lower === "b") {
      if (this.game.selection.length) this.game.beginAttackMove();
      return;
    }
  }

  onKeyUp(e) {
    const key = e.key;
    const lower = key.toLowerCase();
    if (key.startsWith("Arrow")) {
      this.keys.delete(key === "ArrowUp" ? "w" : key === "ArrowDown" ? "s" : key === "ArrowLeft" ? "a" : "d");
    } else {
      this.keys.delete(lower);
    }
  }

  update(dt) {
    if (this.game.state !== "playing") return;
    let dx = 0;
    let dy = 0;
    const speed = 620 / this.game.camera.zoom;
    if (this.keys.has("w")) dy -= 1;
    if (this.keys.has("s")) dy += 1;
    if (this.keys.has("a")) dx -= 1;
    if (this.keys.has("d")) dx += 1;
    if (this.pointer.inside && !this.dragging && !this.panning) {
      const edge = 10;
      const bottomSafe = this.game.viewH - 190;
      if (this.pointer.x < edge) dx -= 1;
      if (this.pointer.x > this.game.viewW - edge) dx += 1;
      if (this.pointer.y < edge) dy -= 1;
      if (this.pointer.y > bottomSafe && this.pointer.y < bottomSafe + 16) {
        // Intentionally no bottom edge scroll over the command console.
      }
    }
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      this.game.cameraTarget.x += (dx / len) * speed * dt;
      this.game.cameraTarget.y += (dy / len) * speed * dt;
      this.game.camera.x += (dx / len) * speed * dt;
      this.game.camera.y += (dy / len) * speed * dt;
      this.game.clampCamera();
      this.game.cameraTarget.x = this.game.camera.x;
      this.game.cameraTarget.y = this.game.camera.y;
    }
    this.updateCursor();
  }
}

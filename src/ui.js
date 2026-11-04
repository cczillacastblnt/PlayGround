import {
  UNIT_TYPES,
  BUILDING_TYPES,
  BUILD_ORDER,
  KEY_LABELS,
  DIFFICULTIES,
  TEAM,
  TEAM_DATA,
  formatTime,
} from "./config.js";
import { clamp, colorWithAlpha } from "./utils.js";

const ICONS = {
  fabricator: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 17 10 10h12l2 7-5 4h-6z"/><circle cx="16" cy="14" r="4"/><path d="M8 17 4 21l2 4 6-3M24 17l4 4-2 4-6-3M16 21v6"/><path d="M13 28h6" stroke-width="2"/></svg>`,
  trooper: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 8h10l3 7-3 13H11L8 15z"/><circle cx="16" cy="12" r="4"/><path d="M13 12h6" stroke-width="2"/><path d="M18 18h10M25 16l4 2-4 2"/><path d="M11 10 7 8M11 7l-3-2"/></svg>`,
  lancer: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 7h12l3 8-2 12H10L7 15z"/><circle cx="16" cy="12" r="4.5"/><path d="M18 17h11M26 14l3 3-3 3"/><path d="M9 10 5 8l-1 5 5 2" fill="currentColor" opacity=".3"/></svg>`,
  juggernaut: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 10h14l5 5-5 5H8l-3-5z"/><path d="M22 13h7v4h-7M9 20l-4 7M13 20l-1 8M21 20l2 8M24 20l4 7"/><circle cx="12" cy="15" r="2.5"/><path d="M8 15h4" stroke-width="2"/></svg>`,
  habitat: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 21c0-5 4-9 9-9s8 3 9 7"/><path d="M20 22c0-4 3-7 6-7s3 2 3 5"/><path d="M3 22h27v4H3z"/><circle cx="12" cy="16" r="2"/><path d="M17 12v8M6 24v3M25 24v3"/></svg>`,
  barracks: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 9h20l3 5v13H4V14z"/><path d="M11 14v9M17 14v9M23 14v9" opacity=".55"/><path d="M4 14h25M16 9V4M13 4h6"/><path d="M7 20h5v5H7z" fill="currentColor" opacity=".22"/></svg>`,
  foundry: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 12h20l3 6v10H4V19z"/><path d="M9 12V6h6v6M18 12V4h5v8"/><path d="M8 23h17" opacity=".5"/><path d="M10 19h3v3h-3zM17 19h5v3h-5z" fill="currentColor" opacity=".35"/><path d="M23 6c3 0 5-2 5-4" opacity=".6"/></svg>`,
  turret: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m16 4 9 5v10l-9 5-9-5V9z"/><circle cx="16" cy="15" r="5"/><path d="M18 12h10v4H18M22 11v6" stroke-width="2"/><path d="M9 26h14M12 22v4M20 22v4" opacity=".6"/></svg>`,
  attack: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="16" cy="16" r="8"/><circle cx="16" cy="16" r="2" fill="currentColor"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8"/><path d="m8 8 4 4M24 24l-4-4M24 8l-4 4M8 24l4-4" opacity=".5"/></svg>`,
  stop: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="7" width="18" height="18" rx="1"/><path d="M11 11h10v10H11z" fill="currentColor" opacity=".28"/><path d="M2 16h4M26 16h4" opacity=".5"/></svg>`,
  hold: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 3 27 8v8c0 6-5 10-11 13C10 26 5 22 5 16V8z"/><path d="M11 12h10v8H11z" fill="currentColor" opacity=".24"/><path d="M16 8v4" opacity=".6"/></svg>`,
  gather: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m16 4 8 6v12l-8 6-8-6V10z"/><path d="m16 9 4 4-4 8-4-8z" fill="currentColor" opacity=".35"/><path d="M3 25h8M21 25h8" opacity=".4"/></svg>`,
  cancel: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 9 14 14M23 9 9 23"/><circle cx="16" cy="16" r="13" opacity=".3"/></svg>`,
  army: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="4"/><circle cx="22" cy="12" r="3.5"/><path d="M3 27c0-5 3.5-8 8-8s8 3 8 8M18 25c.2-4 2-6.5 5-6.5s5 2.5 5 6.5"/></svg>`,
  workers: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="16" cy="16" r="5"/><path d="M16 3v5M16 24v5M3 16h5M24 16h5M6 6l4 4M22 22l4 4M26 6l-4 4M10 22l-4 4"/></svg>`,
  base: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m16 3 11 6v14l-11 6-11-6V9z"/><circle cx="16" cy="16" r="5"/><path d="M16 8v3M16 21v3M8 16h3M21 16h3"/><path d="m11 11 3 3M21 21l-3-3M21 11l-3 3M11 21l3-3" opacity=".5"/></svg>`,
  idle: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="16" cy="16" r="10"/><path d="M16 9v7l5 3"/><path d="M6 6 2 10M26 6l4 4" opacity=".6"/></svg>`,
};

const SHORT_NAMES = {
  fabricator: "Fabricator",
  trooper: "Trooper",
  lancer: "Lancer",
  juggernaut: "Juggernaut",
  habitat: "Habitat",
  barracks: "Barracks",
  foundry: "Foundry",
  turret: "Turret",
  nexus: "Nexus",
};

export class UI {
  constructor(game, audio, renderer, callbacks = {}) {
    this.game = game;
    this.audio = audio;
    this.renderer = renderer;
    this.callbacks = callbacks;
    this.hudTimer = 0;
    this.menuDifficulty = localStorage.getItem("starfall.difficulty") || "veteran";
    this.muted = localStorage.getItem("starfall.muted") === "1";
    this.commandSignature = "";
    this.alertTimers = [];
    this.notificationTimer = null;
    this.pauseVisible = false;
    this.tooltip = null;
    this.cacheDom();
    this.bindMenu();
    this.bindHud();
    this.bindMinimap();
    this.bindTooltip();
    this.applySoundState();
    this.selectDifficulty(this.menuDifficulty);
    this.updateBestTime();
    this.game.onAlert = (a) => this.showAlert(a);
    this.game.onEnd = (result) => this.showEnd(result);
  }

  cacheDom() {
    const $ = (id) => document.getElementById(id);
    this.dom = {
      hud: $("hud"),
      menu: $("menu"),
      pause: $("pause-screen"),
      end: $("end-screen"),
      endCard: document.querySelector("#end-screen .modal-card"),
      endChevrons: $("end-chevrons"),
      endKicker: $("end-kicker"),
      endTitle: $("end-title"),
      endCopy: $("end-copy"),
      endStats: $("end-stats"),
      mineral: $("mineral-value"),
      supply: $("supply-value"),
      workers: $("worker-value"),
      supplyResource: document.querySelectorAll(".resource")[1],
      clock: $("clock"),
      objectiveTitle: $("objective-title"),
      objectiveSub: $("objective-sub"),
      objectiveProgress: $("objective-progress"),
      threatPips: $("threat-pips"),
      threatLabel: $("threat-label"),
      selectionName: $("selection-name"),
      selectionRole: $("selection-role"),
      selectionTeam: $("selection-team"),
      selectionHp: $("selection-hp"),
      selectionHealth: $("selection-health"),
      selectionStats: $("selection-stats"),
      healthBlock: $("health-block"),
      queueRow: $("queue-row"),
      portrait: $("portrait"),
      portraitFrame: $("portrait-frame"),
      commandGrid: $("command-grid"),
      commandTitle: $("command-title"),
      commandHint: $("command-hint"),
      commandMinerals: $("command-minerals"),
      selectionCount: $("selection-count"),
      sensorCoords: $("sensor-coords"),
      alertStack: $("alert-stack"),
      notification: $("notification-panel"),
      notificationTitle: $("notification-title"),
      notificationBody: $("notification-body"),
      notificationIcon: $("notification-icon"),
      soundButton: $("sound-button"),
      pauseButton: $("pause-button"),
      controlHint: $("control-hint-bar"),
      mobileControls: $("mobile-controls"),
      deployButton: $("deploy-button"),
      difficultyPicker: $("difficulty-picker"),
      bestTime: $("best-time"),
      resumeButton: $("resume-button"),
      restartButton: $("restart-button"),
      quitButton: $("quit-button"),
      replayButton: $("replay-button"),
      menuButton: $("menu-button"),
    };
  }

  bindMenu() {
    const picker = this.dom.difficultyPicker;
    picker.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-difficulty]");
      if (!btn) return;
      this.selectDifficulty(btn.dataset.difficulty);
      this.audio.uiClick();
    });
    this.dom.deployButton.addEventListener("click", () => {
      this.audio.unlock();
      this.audio.setMuted(this.muted);
      localStorage.setItem("starfall.difficulty", this.menuDifficulty);
      this.callbacks.onDeploy?.(this.menuDifficulty);
    });
    this.dom.resumeButton.addEventListener("click", () => this.callbacks.onResume?.());
    this.dom.restartButton.addEventListener("click", () => this.callbacks.onRestart?.());
    this.dom.quitButton.addEventListener("click", () => this.callbacks.onQuit?.());
    this.dom.replayButton.addEventListener("click", () => this.callbacks.onReplay?.());
    this.dom.menuButton.addEventListener("click", () => this.callbacks.onQuit?.());
  }

  bindHud() {
    this.dom.soundButton.addEventListener("click", () => {
      this.muted = !this.muted;
      localStorage.setItem("starfall.muted", this.muted ? "1" : "0");
      this.applySoundState();
      this.audio.uiClick();
    });
    this.dom.pauseButton.addEventListener("click", () => this.callbacks.onPauseToggle?.());
    this.dom.commandGrid.addEventListener("click", (e) => {
      const btn = e.target.closest(".command-button");
      if (!btn) return;
      this.executeCommand(btn.dataset);
    });
    this.dom.queueRow.addEventListener("click", (e) => {
      const chip = e.target.closest(".queue-chip");
      if (!chip) return;
      const building = this.game.primarySelection;
      if (building?.kind === "building") this.game.cancelQueue(building, Number(chip.dataset.queueIndex));
      this.audio.uiClick();
    });
    this.dom.mobileControls.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mobile]");
      if (!btn) return;
      this.audio.unlock();
      this.handleMobile(btn.dataset.mobile);
      this.audio.uiClick();
    });
    // Generic hotkey bridge used by the keyboard handler.
    this.dom.hud.addEventListener("pointerdown", () => this.audio.unlock(), { once: true });
  }

  bindMinimap() {
    const shell = document.getElementById("minimap-shell");
    const canvas = document.getElementById("minimap");
    let dragging = false;
    const moveCamera = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      this.game.focus(x * 3200, y * 2200);
    };
    const issue = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      this.game.issueContextOrder(x * 3200, y * 2200);
    };
    shell.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) {
        issue(e);
      } else {
        dragging = true;
        canvas.setPointerCapture(e.pointerId);
        moveCamera(e);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (dragging) moveCamera(e);
    });
    canvas.addEventListener("pointerup", (e) => {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    });
    canvas.addEventListener("pointercancel", () => { dragging = false; });
  }

  bindTooltip() {
    this.tooltip = document.createElement("div");
    this.tooltip.id = "tooltip";
    document.body.appendChild(this.tooltip);
    document.addEventListener("pointerover", (e) => {
      const btn = e.target.closest?.(".command-button");
      if (!btn) return;
      const title = btn.dataset.tipTitle;
      if (!title) return;
      this.tooltip.innerHTML = `<b>${title}</b>${btn.dataset.tipBody || ""}${btn.dataset.tipCost ? `<div class="tt-cost">${btn.dataset.tipCost}</div>` : ""}${btn.dataset.tipWarn ? `<div class="tt-warn">${btn.dataset.tipWarn}</div>` : ""}`;
      const r = btn.getBoundingClientRect();
      this.tooltip.style.left = `${clamp(r.left, 8, window.innerWidth - 252)}px`;
      this.tooltip.style.top = `${Math.max(8, r.top - 12 - this.tooltip.offsetHeight)}px`;
      this.tooltip.classList.add("show");
    });
    document.addEventListener("pointerout", (e) => {
      if (e.target.closest?.(".command-button")) this.tooltip.classList.remove("show");
    });
  }

  applySoundState() {
    this.dom.soundButton.classList.toggle("muted", this.muted);
    this.audio.setMuted(this.muted);
  }

  selectDifficulty(key) {
    if (!DIFFICULTIES[key]) key = "veteran";
    this.menuDifficulty = key;
    for (const btn of this.dom.difficultyPicker.querySelectorAll("button")) {
      btn.classList.toggle("active", btn.dataset.difficulty === key);
    }
  }

  updateBestTime() {
    const best = localStorage.getItem("starfall.bestTime");
    if (best) {
      const sec = Number(best);
      this.dom.bestTime.textContent = `BEST: ${formatTime(sec)}`;
    } else {
      this.dom.bestTime.textContent = "BEST: —";
    }
  }

  showMenu() {
    this.dom.menu.classList.remove("is-hidden");
    this.dom.hud.classList.add("is-hidden");
    this.dom.pause.classList.add("is-hidden");
    this.dom.end.classList.add("is-hidden");
    this.pauseVisible = false;
    this.hideAlert();
    this.game.setMenuScene();
    this.renderer.buildTerrain();
  }

  enterGame() {
    this.dom.menu.classList.add("is-hidden");
    this.dom.hud.classList.remove("is-hidden");
    this.dom.pause.classList.add("is-hidden");
    this.dom.end.classList.add("is-hidden");
    this.pauseVisible = false;
    this.commandSignature = "";
    this.hideAlert();
    this.updateHud(true);
  }

  showPause() {
    this.pauseVisible = true;
    this.dom.pause.classList.remove("is-hidden");
    this.dom.hud.style.opacity = "0.45";
  }

  hidePause() {
    this.pauseVisible = false;
    this.dom.pause.classList.add("is-hidden");
    this.dom.hud.style.opacity = "1";
  }

  showEnd(result) {
    const won = result === "won";
    this.dom.end.classList.remove("is-hidden");
    this.dom.endCard.classList.toggle("defeat", !won);
    this.dom.endKicker.textContent = won ? "MISSION COMPLETE" : "MISSION FAILED";
    this.dom.endTitle.textContent = won ? "SECTOR SECURED" : "NEXUS LOST";
    this.dom.endCopy.textContent = won
      ? "The Korvax command Nexus is ash. The ionium shelf belongs to the Aegis Compact."
      : "Your Command Nexus has fallen. Korvax forces now control the K-17 shelf.";
    this.dom.endChevrons.innerHTML = "<i></i><i></i><i></i>";
    const s = this.game.getPlayerStats();
    const stats = [
      ["MISSION TIME", formatTime(s.time)],
      ["COMBAT KILLS", String(s.kills)],
      ["UNITS LOST", String(s.losses)],
      ["UNITS DEPLOYED", String(s.unitsTrained)],
      ["IONIUM MINED", String(s.mineralsMined)],
      ["APM", String(s.apm)],
    ];
    this.dom.endStats.innerHTML = stats
      .map(([label, value]) => `<div class="end-stat"><span>${label}</span><b>${value}</b></div>`)
      .join("");
    if (won) {
      const best = Number(localStorage.getItem("starfall.bestTime") || Infinity);
      if (s.time < best) localStorage.setItem("starfall.bestTime", String(Math.floor(s.time)));
      this.updateBestTime();
    }
    this.dom.hud.style.opacity = "0.3";
  }

  hideEnd() {
    this.dom.end.classList.add("is-hidden");
    this.dom.hud.style.opacity = "1";
  }

  update(dt) {
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.095;
      this.updateHud();
    }
  }

  updateHud(force = false) {
    const game = this.game;
    if (game.state === "menu") return;
    const p = game.players?.[TEAM.PLAYER];
    if (!p) return;
    const stats = game.getPlayerStats();
    this.dom.mineral.textContent = Math.floor(p.minerals);
    this.dom.supply.textContent = `${p.supplyUsed}/${p.supplyCap}`;
    this.dom.workers.textContent = stats.workers;
    this.dom.clock.textContent = formatTime(game.gameTime);
    this.dom.commandMinerals.textContent = Math.floor(p.minerals);
    this.dom.supplyResource.classList.toggle("warning", p.supplyUsed >= p.supplyCap);
    this.dom.selectionCount.textContent = `${game.selection.length} SELECTED`;
    this.dom.sensorCoords.textContent = `X:${String(Math.floor(game.pointer.worldX)).padStart(4, "0")} Y:${String(Math.floor(game.pointer.worldY)).padStart(4, "0")}`;

    const enemyCore = game.buildings.find((b) => b.team === TEAM.ENEMY && b.type === "nexus" && b.alive);
    if (enemyCore) {
      const ratio = enemyCore.hp / enemyCore.maxHp;
      this.dom.objectiveTitle.textContent = "Destroy the Korvax Nexus";
      this.dom.objectiveSub.textContent = `Enemy core integrity ${Math.ceil(ratio * 100)}%. Break the defenses and level the structure.`;
      this.dom.objectiveProgress.style.width = `${Math.max(2, (1 - ratio) * 100)}%`;
    } else {
      this.dom.objectiveTitle.textContent = "Sector secured";
      this.dom.objectiveSub.textContent = "Enemy command structure destroyed.";
      this.dom.objectiveProgress.style.width = "100%";
    }

    const threat = game.getThreatLevel();
    const labels = ["", "LOW", "GUARDED", "ELEVATED", "HIGH", "CRITICAL"];
    this.dom.threatPips.innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < threat ? "on" : ""}"></i>`).join("");
    this.dom.threatLabel.textContent = labels[threat] || "LOW";

    this.updateSelection();
    this.updateCommands(force);
    this.updateTag();
  }

  updateTag() {
    const primary = this.game.primarySelection;
    if (!primary) {
      this.dom.selectionTeam.textContent = "AEGIS";
      this.dom.selectionTeam.classList.remove("enemy");
      return;
    }
    const team = TEAM_DATA[primary.team];
    this.dom.selectionTeam.textContent = team.short;
    this.dom.selectionTeam.classList.toggle("enemy", primary.team === TEAM.ENEMY);
  }

  updateSelection() {
    const game = this.game;
    const selected = game.selectedEntities;
    const primary = selected[0] || null;
    this.dom.queueRow.innerHTML = "";

    if (!selected.length) {
      this.dom.selectionName.textContent = "NO SELECTION";
      this.dom.selectionRole.textContent = "Select a unit or structure";
      this.dom.selectionHp.textContent = "—";
      this.dom.selectionHealth.style.width = "0%";
      this.dom.selectionStats.innerHTML = "";
      this.dom.healthBlock.style.opacity = "0.35";
      return;
    }
    this.dom.healthBlock.style.opacity = "1";

    if (selected.length > 1) {
      const own = selected.filter((e) => e.kind === "unit" || e.kind === "building");
      const totalHp = own.reduce((sum, e) => sum + e.hp, 0);
      const totalMax = own.reduce((sum, e) => sum + e.maxHp, 0);
      const ratio = totalMax ? totalHp / totalMax : 0;
      const countUnits = selected.filter((e) => e.kind === "unit").length;
      const countBuildings = selected.filter((e) => e.kind === "building").length;
      this.dom.selectionName.textContent = `${selected.length} SELECTED`;
      this.dom.selectionRole.textContent = `${countUnits} units // ${countBuildings} structures`;
      this.dom.selectionHp.textContent = `${Math.ceil(totalHp)} / ${totalMax}`;
      this.setHealth(ratio, primary.team);
      this.dom.selectionStats.innerHTML = [
        this.stat("FORMATION", "GROUPED"),
        this.stat("MOVE SPEED", countUnits ? "MIXED" : "STATIC"),
        this.stat("TEAM", TEAM_DATA[primary.team].short),
      ].join("");
      return;
    }

    const e = primary;
    const isBuilding = e.kind === "building";
    const def = isBuilding ? BUILDING_TYPES[e.type] : UNIT_TYPES[e.type];
    if (!def) return;
    const hpRatio = clamp(e.hp / e.maxHp, 0, 1);
    this.dom.selectionName.textContent = def.name;
    this.dom.selectionRole.textContent = isBuilding && !e.completed ? "UNDER CONSTRUCTION" : def.role;
    this.dom.selectionHp.textContent = `${Math.ceil(e.hp)} / ${e.maxHp}`;
    this.setHealth(hpRatio, e.team);

    if (isBuilding) {
      const supply = BUILDING_TYPES[e.type].supply || 0;
      const queueText = e.queue.length ? `${e.queue.length}/5` : "IDLE";
      this.dom.selectionStats.innerHTML = [
        this.stat("ARMOR", String(e.armor)),
        supply ? this.stat("SUPPLY", `+${supply}`) : this.stat("QUEUE", queueText),
        this.stat("SIGHT", String(e.sight)),
      ].join("");
      if (e.queue.length) this.renderQueue(e);
    } else if (e.isWorker) {
      this.dom.selectionStats.innerHTML = [
        this.stat("CARGO", `${e.carrying}/${e.carryCap}`),
        this.stat("SPEED", String(e.speed)),
        this.stat("STATE", e.order?.type ? e.order.type.toUpperCase() : "IDLE"),
      ].join("");
    } else {
      this.dom.selectionStats.innerHTML = [
        this.stat("DAMAGE", String(e.attack?.damage || 0)),
        this.stat("RANGE", String(e.attack?.range || 0)),
        this.stat("ARMOR", String(e.armor)),
      ].join("");
    }
  }

  setHealth(ratio, team) {
    this.dom.selectionHealth.style.width = `${clamp(ratio, 0, 1) * 100}%`;
    this.dom.selectionHealth.classList.toggle("low", ratio < 0.3);
    this.dom.selectionHealth.classList.toggle("enemy", team === TEAM.ENEMY);
  }

  stat(label, value) {
    return `<div class="stat"><span>${label}</span><b>${value}</b></div>`;
  }

  renderQueue(building) {
    const html = building.queue.map((item, i) => {
      const ratio = clamp(item.progress / item.total, 0, 1);
      return `<div class="queue-chip" data-queue-index="${i}" title="Cancel ${UNIT_TYPES[item.type].name}">
        ${ICONS[item.type]}
        <i style="width:${ratio * 100}%"></i>
        <span class="queue-cancel">×</span>
      </div>`;
    }).join("");
    this.dom.queueRow.innerHTML = `<span class="queue-label">QUEUE</span>${html}`;
  }

  updateCommands(force = false) {
    const game = this.game;
    const selected = game.selectedEntities;
    const own = selected.filter((e) => e.team === TEAM.PLAYER);
    const primary = selected[0] || null;
    const unit = own.find((e) => e.kind === "unit");
    const worker = own.find((e) => e.kind === "unit" && e.isWorker);
    const building = own.find((e) => e.kind === "building");
    const combatUnits = own.filter((e) => e.kind === "unit" && e.attack);
    const selectedUnits = own.filter((e) => e.kind === "unit");
    let buttons = [];
    let title = "COMMAND";
    let hint = "Awaiting orders";

    if (game.buildMode) {
      title = "DEPLOYMENT";
      hint = "Click valid terrain to deploy // ESC to cancel";
      buttons = [{ action: "cancelMode", label: "CANCEL", hotkey: "ESC", icon: "cancel", body: "Abort structure placement." }];
    } else if (game.pendingCommand === "attack") {
      title = "TARGETING";
      hint = "Click a destination for attack-move";
      buttons = [{ action: "cancelMode", label: "CANCEL", hotkey: "ESC", icon: "cancel", body: "Cancel attack-move." }];
    } else if (!selected.length) {
      title = "COMMAND";
      hint = "Select a Fabricator to build // production to deploy units";
      buttons = [
        { action: "selectArmy", label: "ARMY", hotkey: "F2", icon: "army", body: "Select all combat units." },
        { action: "selectWorkers", label: "HARVESTERS", hotkey: "F3", icon: "workers", body: "Select all Fabricators." },
        { action: "selectBase", label: "BASE", hotkey: "SPACE", icon: "base", body: "Center camera on your Command Nexus." },
        { action: "idleWorker", label: "IDLE", hotkey: "F1", icon: "idle", body: "Jump to the next idle Fabricator." },
      ];
    } else if (primary.team === TEAM.ENEMY) {
      title = "HOSTILE SIGNAL";
      hint = "Enemy selected // intelligence only";
      buttons = [];
    } else if (worker && !building) {
      title = "FABRICATOR";
      hint = "Q/W/E/R build // G harvest // S stop";
      for (const type of BUILD_ORDER) {
        const def = BUILDING_TYPES[type];
        const reqMissing = def.requires?.find((r) => !game.hasCompletedBuilding(TEAM.PLAYER, r));
        const costBlocked = game.players[TEAM.PLAYER].minerals < def.cost;
        buttons.push({
          action: "build",
          type,
          label: SHORT_NAMES[type],
          hotkey: KEY_LABELS[type],
          icon: type,
          cost: def.cost,
          body: def.desc,
          warn: reqMissing ? `Requires ${BUILDING_TYPES[reqMissing].name}` : costBlocked ? "Insufficient ionium" : "",
          disabled: !!reqMissing || costBlocked,
        });
      }
      buttons.push({ action: "gather", label: "HARVEST", hotkey: "G", icon: "gather", body: "Send selected Fabricators to the nearest ionium field." });
      buttons.push({ action: "stop", label: "STOP", hotkey: "S", icon: "stop", body: "Cancel current orders." });
    } else if (building && !unit) {
      const def = BUILDING_TYPES[building.type];
      title = def.name.toUpperCase();
      hint = "Right-click terrain to set rally // X cancel";
      if (def.trains?.length && building.completed) {
        for (const type of def.trains) {
          const ud = UNIT_TYPES[type];
          const queued = building.queue.filter((q) => q.type === type).length;
          const supplyBlocked = game.players[TEAM.PLAYER].supplyUsed + ud.supply > game.players[TEAM.PLAYER].supplyCap;
          const costBlocked = game.players[TEAM.PLAYER].minerals < ud.cost;
          buttons.push({
            action: "train",
            type,
            label: SHORT_NAMES[type],
            hotkey: KEY_LABELS[type],
            icon: type,
            cost: ud.cost,
            body: ud.desc,
            warn: supplyBlocked ? "Supply capped" : costBlocked ? "Insufficient ionium" : "",
            disabled: supplyBlocked || costBlocked || building.queue.length >= 5,
            queue: queued,
          });
        }
      }
      if (building.queue.length) {
        buttons.push({ action: "cancelQueue", label: "CANCEL", hotkey: "X", icon: "cancel", body: "Cancel the last unit in this production queue." });
      }
      buttons.push({ action: "selectBase", label: "BASE", hotkey: "SPACE", icon: "base", body: "Center camera on your Command Nexus." });
    } else if (combatUnits.length || selectedUnits.length) {
      title = "STRIKE GROUP";
      hint = "A attack-move // S stop // H hold";
      if (combatUnits.length) {
        buttons.push({ action: "attackMove", label: "ATTACK", hotkey: "A", icon: "attack", body: "Arm attack-move. Units engage everything on the way." });
        buttons.push({ action: "hold", label: "HOLD", hotkey: "H", icon: "hold", body: "Hold position and return fire." });
      }
      if (worker) {
        buttons.push({ action: "gather", label: "HARVEST", hotkey: "G", icon: "gather", body: "Send selected Fabricators to the nearest ionium field." });
      }
      buttons.push({ action: "stop", label: "STOP", hotkey: "S", icon: "stop", body: "Cancel current orders." });
      buttons.push({ action: "selectArmy", label: "ARMY", hotkey: "F2", icon: "army", body: "Select all combat units." });
    }

    const signature = buttons.map((b) => `${b.action}:${b.type || ""}:${b.disabled ? 1 : 0}:${b.queue || 0}`).join("|") + `|${title}|${hint}`;
    if (signature === this.commandSignature && !force) {
      return;
    }
    this.commandSignature = signature;
    this.dom.commandTitle.textContent = title;
    this.dom.commandHint.textContent = hint;
    this.dom.commandHint.classList.toggle("warn", hint.toLowerCase().includes("blocked"));
    if (!buttons.length) {
      this.dom.commandGrid.innerHTML = `<div class="command-empty">HOSTILE SIGNAL // NO COMMAND AUTHORITY</div>`;
      return;
    }
    this.dom.commandGrid.innerHTML = buttons.map((b) => {
      const warn = b.warn ? `<div class="tt-warn">${b.warn}</div>` : "";
      return `<button class="command-button ${b.disabled ? "disabled" : ""}" data-action="${b.action}" ${b.type ? `data-type="${b.type}"` : ""} data-hotkey="${b.hotkey}" data-tip-title="${b.label}" data-tip-body="${b.body || ""}" data-tip-cost="${b.cost ? `${b.cost} IONIUM` : ""}" data-tip-warn="${warn.replace(/"/g, "&quot;")}">
        <span class="hotkey">${b.hotkey}</span>
        <span class="cmd-icon">${ICONS[b.icon] || ICONS.army}</span>
        <strong>${b.label}</strong>
        ${b.cost ? `<small><span class="cost">${b.cost}</span> IONIUM</small>` : `<small>${b.action === "attackMove" ? "ARMED COMMAND" : "TACTICAL"}</small>`}
        ${b.queue ? `<span class="queue-count">×${b.queue}</span>` : ""}
      </button>`;
    }).join("");
  }

  executeCommand(data) {
    const game = this.game;
    const action = data.action;
    this.audio.unlock();
    this.audio.uiClick();
    switch (action) {
      case "build": game.beginBuild(data.type); break;
      case "train": {
        const building = game.selectedBuildings.find((b) => b.completed && BUILDING_TYPES[b.type]?.trains?.includes(data.type));
        if (building) game.queueUnit(building, data.type);
        break;
      }
      case "attackMove": game.beginAttackMove(); break;
      case "stop": game.stopSelected(); break;
      case "hold": game.holdSelected(); break;
      case "gather": game.gatherSelected(); break;
      case "cancelMode": game.cancelMode(); break;
      case "cancelQueue": {
        const building = game.selectedBuildings[0];
        if (building) game.cancelQueueLast(building);
        break;
      }
      case "selectArmy": game.selectAllArmy(); break;
      case "selectWorkers": game.selectAllWorkers(); break;
      case "selectBase": game.selectBase(); break;
      case "idleWorker": game.cycleIdleWorker(); break;
      default: break;
    }
    this.updateHud(true);
  }

  handleMobile(kind) {
    const game = this.game;
    if (kind === "army") game.selectAllArmy();
    else if (kind === "workers") game.selectAllWorkers();
    else if (kind === "base") game.selectBase();
    else if (kind === "stop") game.stopSelected();
    this.updateHud(true);
  }

  triggerHotkey(key) {
    const buttons = [...this.dom.commandGrid.querySelectorAll(".command-button")];
    const button = buttons.find((b) => (b.dataset.hotkey || "").toLowerCase() === key.toLowerCase());
    if (button) {
      this.executeCommand(button.dataset);
      return true;
    }
    return false;
  }

  showAlert({ message, tone = "info", title = null }) {
    const el = document.createElement("div");
    el.className = `alert ${tone}`;
    el.textContent = message;
    this.dom.alertStack.appendChild(el);
    while (this.dom.alertStack.children.length > 4) this.dom.alertStack.removeChild(this.dom.alertStack.firstElementChild);
    const timer = setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 260);
    }, 3700);
    this.alertTimers.push(timer);

    if (title) {
      this.dom.notificationTitle.textContent = title;
      this.dom.notificationBody.textContent = message;
      this.dom.notificationIcon.textContent = tone === "danger" ? "!" : tone === "good" ? "✓" : "i";
      this.dom.notification.classList.add("show");
      clearTimeout(this.notificationTimer);
      this.notificationTimer = setTimeout(() => this.dom.notification.classList.remove("show"), 4800);
    }
  }

  hideAlert() {
    this.dom.alertStack.innerHTML = "";
    this.dom.notification.classList.remove("show");
    for (const t of this.alertTimers) clearTimeout(t);
    this.alertTimers = [];
  }
}

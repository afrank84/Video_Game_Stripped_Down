"use strict";

/*
Idle Tower Defense (Squares)
- Tower auto-attacks nearest enemy
- Click enemies for extra damage with cooldown
- Text-based tech tree with prerequisites
- Enemies spawn from edges and walk to center
*/

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const SAVE_KEY = "idle_tower_meta_v1";


const ui = {
	gold: document.getElementById("gold"),
	wave: document.getElementById("wave"),
	enemyCount: document.getElementById("enemyCount"),
	towerHp: document.getElementById("towerHp"),
	towerHpMax: document.getElementById("towerHpMax"),
	towerDps: document.getElementById("towerDps"),
	clickCd: document.getElementById("clickCd"),
	techTree: document.getElementById("techTree"),
	summary: document.getElementById("summary"),
	log: document.getElementById("log"),
	toggleTech: document.getElementById("toggleTech"),
	restart: document.getElementById("restart"),
};

function nowSec() {
	return performance.now() / 1000;
}

function clamp(v, a, b) {
	return Math.max(a, Math.min(b, v));
}

function dist(ax, ay, bx, by) {
	const dx = ax - bx;
	const dy = ay - by;
	return Math.sqrt(dx * dx + dy * dy);
}

function fmt1(x) {
	return (Math.round(x * 10) / 10).toFixed(1);
}

function rand01() {
	return Math.random();
}

function pick(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

function logLine(s) {
	const t = new Date();
	const hh = String(t.getHours()).padStart(2, "0");
	const mm = String(t.getMinutes()).padStart(2, "0");
	const ss = String(t.getSeconds()).padStart(2, "0");
	ui.log.textContent = `[${hh}:${mm}:${ss}] ${s}\n` + ui.log.textContent;
}

// ----------------------------
// Game State
// ----------------------------
const state = {
	running: true,
	lastT: nowSec(),
	gold: 0,
	wave: 1,

	// click damage & cooldown
	clickDamage: 10,
	clickCooldown: 0.50,
	clickReadyAt: 0,

	// passive income
	passiveGoldPerSec: 0,

	// tower
	tower: {
		x: canvas.width / 2,
		y: canvas.height / 2,
		size: 30,
		hpMax: 100,
		hp: 100,

		// auto attack modeled as DPS; we apply continuous damage to a target with a "lock" and range
		dps: 10,
		range: 260,
		targetId: null,

		// when enemies are touching the tower, they deal damage per second to tower
		contactDpsTaken: 12,
	},

	// spawn pacing
	spawn: {
		baseInterval: 0.9,
		timer: 0,
		perWaveExtra: 0.06, // slightly faster each wave (interval reduces)
	},

	// enemies
	enemies: [],
	nextEnemyId: 1,

	// VFX (simple hit markers)
	pops: [],

	// tech tree
	bought: new Set(),
};

// Enemy archetypes
const ENEMY_TYPES = [
	{
		key: "red",
		name: "Red",
		color: "#ff4b4b",
		hp: 22,
		speed: 65,
		gold: 4,
		touchDps: 10,
	},
	{
		key: "blue",
		name: "Blue",
		color: "#4ba3ff",
		hp: 45,
		speed: 48,
		gold: 7,
		touchDps: 14,
	},
	{
		key: "green",
		name: "Green",
		color: "#58ff86",
		hp: 120,
		speed: 28,
		gold: 14,
		touchDps: 18,
	},
	{
		key: "yellow",
		name: "Yellow",
		color: "#ffd34b",
		hp: 70,
		speed: 80,
		gold: 10,
		touchDps: 16,
	},
];

// Tech tree items
// Note: This is intentionally text-based and menu-like (no icons).
const TECH = [
	{
		id: "click1",
		name: "Click Calibration I",
		cost: 25,
		prereq: [],
		desc: "+8 click damage",
		apply() { state.clickDamage += 8; }
	},
	{
		id: "click2",
		name: "Click Calibration II",
		cost: 80,
		prereq: ["click1"],
		desc: "+15 click damage",
		apply() { state.clickDamage += 15; }
	},
	{
		id: "cooldown1",
		name: "Finger Training I",
		cost: 40,
		prereq: [],
		desc: "-0.10s click cooldown (min 0.15s)",
		apply() { state.clickCooldown = Math.max(0.15, state.clickCooldown - 0.10); }
	},
	{
		id: "cooldown2",
		name: "Finger Training II",
		cost: 120,
		prereq: ["cooldown1"],
		desc: "-0.10s click cooldown (min 0.15s)",
		apply() { state.clickCooldown = Math.max(0.15, state.clickCooldown - 0.10); }
	},
	{
		id: "dps1",
		name: "Turret Motor I",
		cost: 35,
		prereq: [],
		desc: "+6 tower DPS",
		apply() { state.tower.dps += 6; }
	},
	{
		id: "dps2",
		name: "Turret Motor II",
		cost: 120,
		prereq: ["dps1"],
		desc: "+12 tower DPS",
		apply() { state.tower.dps += 12; }
	},
	{
		id: "range1",
		name: "Range Optics I",
		cost: 55,
		prereq: [],
		desc: "+60 tower range",
		apply() { state.tower.range += 60; }
	},
	{
		id: "range2",
		name: "Range Optics II",
		cost: 160,
		prereq: ["range1"],
		desc: "+80 tower range",
		apply() { state.tower.range += 80; }
	},
	{
		id: "armor1",
		name: "Reinforced Plating I",
		cost: 70,
		prereq: [],
		desc: "+40 tower max HP (heal to full)",
		apply() {
			state.tower.hpMax += 40;
			state.tower.hp = state.tower.hpMax;
		}
	},
	{
		id: "income1",
		name: "Salvage Drones I",
		cost: 90,
		prereq: [],
		desc: "+0.8 gold/sec passive income",
		apply() { state.passiveGoldPerSec += 0.8; }
	},
	{
		id: "income2",
		name: "Salvage Drones II",
		cost: 220,
		prereq: ["income1"],
		desc: "+1.5 gold/sec passive income",
		apply() { state.passiveGoldPerSec += 1.5; }
	},
	{
		id: "killbonus1",
		name: "Bounty Protocol I",
		cost: 150,
		prereq: ["dps1"],
		desc: "+25% gold from kills",
		apply() { state.killGoldMultiplier *= 1.25; }
	},
	{
		id: "killbonus2",
		name: "Bounty Protocol II",
		cost: 320,
		prereq: ["killbonus1", "dps2"],
		desc: "+30% gold from kills",
		apply() { state.killGoldMultiplier *= 1.30; }
	},
];

function saveProgression() {
	const data = {
		bought: Array.from(state.bought),
		meta: {
			clickDamage: state.clickDamage,
			clickCooldown: state.clickCooldown,
			towerDps: state.tower.dps,
			towerRange: state.tower.range,
			towerHpMax: state.tower.hpMax,
			passiveGoldPerSec: state.passiveGoldPerSec,
			killGoldMultiplier: state.killGoldMultiplier,
		},
	};

	localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function loadProgression() {
	const raw = localStorage.getItem(SAVE_KEY);
	if (!raw) return;

	try {
		const data = JSON.parse(raw);

		state.bought = new Set(data.bought ?? []);

		if (data.meta) {
			state.clickDamage = data.meta.clickDamage ?? state.clickDamage;
			state.clickCooldown = data.meta.clickCooldown ?? state.clickCooldown;
			state.tower.dps = data.meta.towerDps ?? state.tower.dps;
			state.tower.range = data.meta.towerRange ?? state.tower.range;
			state.tower.hpMax = data.meta.towerHpMax ?? state.tower.hpMax;
			state.passiveGoldPerSec = data.meta.passiveGoldPerSec ?? state.passiveGoldPerSec;
			state.killGoldMultiplier = data.meta.killGoldMultiplier ?? state.killGoldMultiplier;
		}

		state.tower.hp = state.tower.hpMax;
		logLine("Progression loaded.");
	} catch (e) {
		console.warn("Failed to load save:", e);
	}
}



// additional multipliers
state.killGoldMultiplier = 1.0;

// ----------------------------
// Spawning
// ----------------------------
function spawnEnemy() {
	const t = pick(ENEMY_TYPES);

	// spawn at random edge with random position
	const w = canvas.width;
	const h = canvas.height;
	const edge = Math.floor(rand01() * 4);

	let x = 0;
	let y = 0;
	const pad = 10;

	if (edge === 0) { // top
		x = pad + rand01() * (w - pad * 2);
		y = pad;
	} else if (edge === 1) { // right
		x = w - pad;
		y = pad + rand01() * (h - pad * 2);
	} else if (edge === 2) { // bottom
		x = pad + rand01() * (w - pad * 2);
		y = h - pad;
	} else { // left
		x = pad;
		y = pad + rand01() * (h - pad * 2);
	}

	// wave scaling
	const wave = state.wave;
	const hpScale = 1 + (wave - 1) * 0.10;
	const speedScale = 1 + (wave - 1) * 0.03;

	const enemy = {
		id: state.nextEnemyId++,
		typeKey: t.key,
		color: t.color,
		size: 18,
		x,
		y,
		hpMax: Math.round(t.hp * hpScale),
		hp: Math.round(t.hp * hpScale),
		speed: t.speed * speedScale,
		goldValue: t.gold,
		touchDps: t.touchDps,
		alive: true,
		flashT: 0, // click-damage visual feedback
	};

	state.enemies.push(enemy);
}

// ----------------------------
// Tech Tree UI
// ----------------------------
function canBuy(item) {
	if (state.bought.has(item.id)) return false;
	if (state.gold < item.cost) return false;
	for (const p of item.prereq) {
		if (!state.bought.has(p)) return false;
	}
	return true;
}

function prereqMet(item) {
	for (const p of item.prereq) {
		if (!state.bought.has(p)) return false;
	}
	return true;
}

function buy(itemId) {
	const item = TECH.find(x => x.id === itemId);
	if (!item) return;

	if (!prereqMet(item)) {
		logLine(`Cannot buy "${item.name}": prerequisites not met.`);
		return;
	}
	if (state.bought.has(item.id)) {
		logLine(`Already owned: "${item.name}".`);
		return;
	}
	if (state.gold < item.cost) {
		logLine(`Not enough gold for "${item.name}".`);
		return;
	}

	state.gold -= item.cost;
	state.bought.add(item.id);

	item.apply();
	saveProgression(); // ✅ persist meta progression

	logLine(`Purchased: ${item.name}`);
	renderTechTree();
	renderSummary();
}

function renderTechTree() {
	ui.techTree.innerHTML = "";

	for (const item of TECH) {
		const owned = state.bought.has(item.id);
		const met = prereqMet(item);
		const affordable = state.gold >= item.cost;

		const card = document.createElement("div");
		card.className = "techItem";

		const top = document.createElement("div");
		top.className = "techTop";

		const name = document.createElement("div");
		name.className = "techName";
		name.textContent = item.name;

		const meta = document.createElement("div");
		meta.className = "techMeta";

		const cost = document.createElement("span");
		cost.className = "badge";
		cost.textContent = `Cost: ${item.cost}`;

		const prereq = document.createElement("span");
		prereq.className = "badge " + (met ? "ok" : "no");
		prereq.textContent = item.prereq.length ? `Prereq: ${item.prereq.join(", ")}` : "Prereq: none";

		const status = document.createElement("span");
		if (owned) status.className = "badge ok";
		else if (!met) status.className = "badge no";
		else if (!affordable) status.className = "badge warn";
		else status.className = "badge ok";

		status.textContent = owned ? "Owned" : (met ? (affordable ? "Available" : "Need gold") : "Locked");

		meta.appendChild(cost);
		meta.appendChild(prereq);
		meta.appendChild(status);

		top.appendChild(name);
		top.appendChild(meta);

		const desc = document.createElement("div");
		desc.className = "techDesc";
		desc.textContent = item.desc;

		const actions = document.createElement("div");
		actions.className = "techActions";

		const btn = document.createElement("button");
		btn.className = "btn";
		btn.textContent = owned ? "Owned" : "Buy";
		btn.disabled = owned || !canBuy(item);

		btn.addEventListener("click", () => buy(item.id));
		actions.appendChild(btn);

		card.appendChild(top);
		card.appendChild(desc);
		card.appendChild(actions);

		ui.techTree.appendChild(card);
	}
}

function renderSummary() {
	const lines = [];
	lines.push(`Click damage: ${state.clickDamage}`);
	lines.push(`Click cooldown: ${state.clickCooldown.toFixed(2)}s`);
	lines.push(`Tower DPS: ${fmt1(state.tower.dps)}`);
	lines.push(`Tower range: ${Math.round(state.tower.range)} px`);
	lines.push(`Tower HP: ${Math.round(state.tower.hp)} / ${Math.round(state.tower.hpMax)}`);
	lines.push(`Passive income: ${fmt1(state.passiveGoldPerSec)} gold/sec`);
	lines.push(`Kill gold multiplier: x${fmt1(state.killGoldMultiplier)}`);

	ui.summary.textContent = lines.join("\n");
}

// ----------------------------
// Click Handling
// ----------------------------
function canvasToWorld(e) {
	const r = canvas.getBoundingClientRect();
	const sx = canvas.width / r.width;
	const sy = canvas.height / r.height;
	return {
		x: (e.clientX - r.left) * sx,
		y: (e.clientY - r.top) * sy,
	};
}

function findEnemyAt(x, y) {
	// pick topmost by lowest distance to center of enemy square
	let best = null;
	let bestD = Infinity;

	for (const en of state.enemies) {
		if (!en.alive) continue;
		const half = en.size / 2;
		if (x >= en.x - half && x <= en.x + half && y >= en.y - half && y <= en.y + half) {
			const d = dist(x, y, en.x, en.y);
			if (d < bestD) {
				bestD = d;
				best = en;
			}
		}
	}
	return best;
}

function damageEnemy(en, dmg, source) {
	en.hp -= dmg;
	state.pops.push({
		x: en.x,
		y: en.y - 14,
		t: 0,
		text: `-${Math.round(dmg)}`,
		source,
	});

	if (en.hp <= 0) {
		en.alive = false;
		const raw = en.goldValue;
		const gained = raw * state.killGoldMultiplier;
		state.gold += gained;
		logLine(`Enemy down (${en.typeKey}). +${fmt1(gained)} gold`);
	}
}

canvas.addEventListener("mousedown", (e) => {
	const t = nowSec();
	if (t < state.clickReadyAt) return;

	const p = canvasToWorld(e);
	const en = findEnemyAt(p.x, p.y);
	if (!en) return;

	state.clickReadyAt = t + state.clickCooldown;
	damageEnemy(en, state.clickDamage, "click");
});

// ----------------------------
// Tower Auto Attack
// ----------------------------
function pickTowerTarget() {
	const tx = state.tower.x;
	const ty = state.tower.y;
	const r = state.tower.range;

	let best = null;
	let bestD = Infinity;

	for (const en of state.enemies) {
		if (!en.alive) continue;
		const d = dist(tx, ty, en.x, en.y);
		if (d <= r && d < bestD) {
			bestD = d;
			best = en;
		}
	}
	return best;
}

// ----------------------------
// Update / Draw
// ----------------------------
function update(dt) {
	if (!state.running) return;

	// passive income
	if (state.passiveGoldPerSec > 0) {
		state.gold += state.passiveGoldPerSec * dt;
	}

	// spawn logic
	// interval gets a little smaller as wave increases
	const interval = Math.max(0.20, state.spawn.baseInterval - (state.wave - 1) * state.spawn.perWaveExtra);
	state.spawn.timer += dt;

	while (state.spawn.timer >= interval) {
		state.spawn.timer -= interval;
		spawnEnemy();
	}

	// wave progression (simple: increase wave every N seconds, and also if enemy count is high)
	// This keeps pressure up in an idle game.
	state.waveTimer = (state.waveTimer || 0) + dt;
	const waveUpEvery = 25; // seconds
	if (state.waveTimer >= waveUpEvery) {
		state.waveTimer -= waveUpEvery;
		state.wave += 1;
		logLine(`Wave ${state.wave}`);
	}

	// move enemies toward tower
	const tx = state.tower.x;
	const ty = state.tower.y;

	let touchingCount = 0;
	let touchDpsTotal = 0;

	for (const en of state.enemies) {
		if (!en.alive) continue;

		const dx = tx - en.x;
		const dy = ty - en.y;
		const d = Math.max(0.0001, Math.sqrt(dx * dx + dy * dy));

		const vx = (dx / d) * en.speed;
		const vy = (dy / d) * en.speed;

		en.x += vx * dt;
		en.y += vy * dt;

		// touching tower?
		const towerHalf = state.tower.size / 2;
		const enemyHalf = en.size / 2;

		const closeX = Math.abs(en.x - tx) <= (towerHalf + enemyHalf);
		const closeY = Math.abs(en.y - ty) <= (towerHalf + enemyHalf);

		if (closeX && closeY) {
			touchingCount += 1;
			touchDpsTotal += en.touchDps;
		}
	}

	// enemies damage tower if touching
	if (touchingCount > 0) {
		const dps = touchDpsTotal; // sum of touch damage
		state.tower.hp -= dps * dt;
		state.pops.push({
			x: tx,
			y: ty + 40,
			t: 0,
			text: `-${Math.round(dps * dt)}`,
			source: "tower",
		});
	}

	// tower auto-attacks nearest target in range (continuous damage)
	let target = null;
	if (state.tower.targetId != null) {
		target = state.enemies.find(e => e.id === state.tower.targetId && e.alive);
		if (target) {
			const d = dist(tx, ty, target.x, target.y);
			if (d > state.tower.range) target = null;
		}
	}
	if (!target) {
		target = pickTowerTarget();
		state.tower.targetId = target ? target.id : null;
	}
	if (target) {
		const dmg = state.tower.dps * dt;
		damageEnemy(target, dmg, "tower");
	}

	// cleanup dead enemies periodically
	state.cleanupTimer = (state.cleanupTimer || 0) + dt;
	if (state.cleanupTimer >= 0.5) {
		state.cleanupTimer = 0;
		state.enemies = state.enemies.filter(e => e.alive);
	}

	// update pops (hit text)
	for (const p of state.pops) p.t += dt;
	state.pops = state.pops.filter(p => p.t < 0.75);

	// game over
	if (state.tower.hp <= 0) {
		state.tower.hp = 0;
		state.running = false;
		logLine("Tower destroyed. Restart to try again.");
	}
}

function draw() {
	// background
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	// subtle grid
	ctx.save();
	ctx.globalAlpha = 0.18;
	ctx.strokeStyle = "#1b2a3a";
	ctx.lineWidth = 1;
	const step = 36;
	for (let x = 0; x <= canvas.width; x += step) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, canvas.height);
		ctx.stroke();
	}
	for (let y = 0; y <= canvas.height; y += step) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(canvas.width, y);
		ctx.stroke();
	}
	ctx.restore();

	// tower range ring
	ctx.save();
	ctx.globalAlpha = 0.18;
	ctx.strokeStyle = "#9fb0c7";
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(state.tower.x, state.tower.y, state.tower.range, 0, Math.PI * 2);
	ctx.stroke();
	ctx.restore();

	// tower
	const tw = state.tower.size;
	ctx.save();
	ctx.fillStyle = "#e7f1ff";
	ctx.strokeStyle = "#2a3a52";
	ctx.lineWidth = 2;
	ctx.fillRect(state.tower.x - tw / 2, state.tower.y - tw / 2, tw, tw);
	ctx.strokeRect(state.tower.x - tw / 2, state.tower.y - tw / 2, tw, tw);
	ctx.restore();

	// tower auto target line
	const tid = state.tower.targetId;
	if (tid != null) {
		const target = state.enemies.find(e => e.id === tid && e.alive);
		if (target) {
			ctx.save();
			ctx.globalAlpha = 0.6;
			ctx.strokeStyle = "#cfe2ff";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(state.tower.x, state.tower.y);
			ctx.lineTo(target.x, target.y);
			ctx.stroke();
			ctx.restore();
		}
	}

	// enemies
	for (const en of state.enemies) {
		if (!en.alive) continue;

		const s = en.size;
		ctx.save();
		ctx.fillStyle = en.color;
		ctx.fillRect(en.x - s / 2, en.y - s / 2, s, s);

		// HP bar
		const barW = 30;
		const barH = 4;
		const hpPct = clamp(en.hp / en.hpMax, 0, 1);
		ctx.globalAlpha = 0.9;
		ctx.fillStyle = "#0a1018";
		ctx.fillRect(en.x - barW / 2, en.y - s / 2 - 10, barW, barH);
		ctx.fillStyle = "#d7e2f0";
		ctx.fillRect(en.x - barW / 2, en.y - s / 2 - 10, barW * hpPct, barH);

		ctx.restore();
	}

	// floating damage text
	for (const p of state.pops) {
		const k = p.t / 0.75;
		const y = p.y - k * 18;
		const a = 1 - k;
		ctx.save();
		ctx.globalAlpha = a;
		ctx.fillStyle = p.source === "tower" ? "#ffd26f" : "#d7e2f0";
		ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
		ctx.fillText(p.text, p.x - 10, y);
		ctx.restore();
	}

	// overlay game over
	if (!state.running) {
		ctx.save();
		ctx.globalAlpha = 0.85;
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.globalAlpha = 1;
		ctx.fillStyle = "#ffd7e0";
		ctx.font = "24px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
		ctx.fillText("Game Over", canvas.width / 2 - 60, canvas.height / 2 - 10);
		ctx.fillStyle = "#d7e2f0";
		ctx.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
		ctx.fillText("Press Restart to play again.", canvas.width / 2 - 92, canvas.height / 2 + 18);
		ctx.restore();
	}
}

function updateUI() {
	ui.gold.textContent = fmt1(state.gold);
	ui.wave.textContent = String(state.wave);
	ui.enemyCount.textContent = String(state.enemies.length);

	ui.towerHp.textContent = String(Math.round(state.tower.hp));
	ui.towerHpMax.textContent = String(Math.round(state.tower.hpMax));
	ui.towerDps.textContent = fmt1(state.tower.dps);
	ui.clickCd.textContent = state.clickCooldown.toFixed(2);
}

// ----------------------------
// Main Loop
// ----------------------------
function frame() {
	const t = nowSec();
	const dt = clamp(t - state.lastT, 0, 0.05);
	state.lastT = t;

	update(dt);
	draw();
	updateUI();

	requestAnimationFrame(frame);
}

// ----------------------------
// Controls
// ----------------------------
ui.toggleTech.addEventListener("click", () => {
	const isHidden = ui.techTree.style.display === "none";
	ui.techTree.style.display = isHidden ? "grid" : "none";
	ui.toggleTech.textContent = isHidden ? "Hide" : "Show";
});

ui.restart.addEventListener("click", () => {
	restartGame();
});

function restartGame() {
	state.running = true;
	state.lastT = nowSec();

	// run-only reset
	state.gold = 0;
	state.wave = 1;
	state.waveTimer = 0;
	state.spawn.timer = 0;

	state.tower.hp = state.tower.hpMax;
	state.tower.targetId = null;

	state.enemies = [];
	state.nextEnemyId = 1;
	state.pops = [];

	ui.log.textContent = "";
	logLine("Restarted run.");

	renderTechTree();
	renderSummary();
}


// initial render
renderTechTree();
renderSummary();
logLine("Ready. Buy upgrades as you earn gold.");
requestAnimationFrame(frame);
loadProgression();

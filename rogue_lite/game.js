/* Stripped Rogue-lite Webgame
   - canvas-only
   - delta-time
   - waves (levels)
   - data-driven upgrades
   - controller support via Web Gamepad API
   - live controller debug (axes + pressed buttons)
*/

(() => {
  'use strict';

  // DOM
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const hudLevel = document.getElementById('hudLevel');
  const hudHP = document.getElementById('hudHP');
  const hudEnemies = document.getElementById('hudEnemies');
  const hudUpgrades = document.getElementById('hudUpgrades');
  const hudPad = document.getElementById('hudPad');

  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayBody = document.getElementById('overlayBody');
  const overlayActions = document.getElementById('overlayActions');

  // Utilities
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const randFloat = (a, b) => Math.random() * (b - a) + a;

  const vecLen = (x, y) => Math.hypot(x, y);
  const norm = (x, y) => {
    const l = vecLen(x, y) || 1;
    return { x: x / l, y: y / l };
  };

  const degToRad = (d) => d * Math.PI / 180;

  // Input (keyboard + mouse)
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.key.toLowerCase());

    if (e.key.toLowerCase() === 'p') {
      togglePause();
    }
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.key.toLowerCase());
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    mouse.x = (e.clientX - rect.left) * sx;
    mouse.y = (e.clientY - rect.top) * sy;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouse.down = true;
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.down = false;
  });

  // Gamepad (controller)
  const pad = {
    active: false,
    index: null,
    id: '',
    mapping: '',

    // analog
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,

    // dpad fallback
    dpadX: 0,
    dpadY: 0,

    // actions
    shoot: false,
    pausePressed: false,

    lastPause: false,

    // debug
    buttonsCount: 0,
    axesCount: 0,
    axesRaw: [],
    pressedButtons: [] // indices
  };

  // Lower deadzones (common fix for “nothing happens”)
  const MOVE_DEADZONE = 0.10;
  const AIM_DEADZONE  = 0.14;

  function deadzone(v, dz) {
    return Math.abs(v) < dz ? 0 : v;
  }

  function readGamepad() {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];

    if (!gps || gps.length === 0) {
      pad.active = false;
      pad.index = null;
      pad.id = '';
      pad.mapping = '';
      pad.moveX = pad.moveY = pad.aimX = pad.aimY = 0;
      pad.dpadX = pad.dpadY = 0;
      pad.shoot = false;
      pad.pausePressed = false;
      pad.lastPause = false;
      pad.buttonsCount = 0;
      pad.axesCount = 0;
      pad.axesRaw = [];
      pad.pressedButtons = [];
      return;
    }

    // Keep current pad if possible, otherwise pick first non-null.
    let gp = null;
    if (pad.index !== null && gps[pad.index]) gp = gps[pad.index];
    if (!gp) {
      for (let i = 0; i < gps.length; i++) {
        if (gps[i]) { gp = gps[i]; pad.index = i; break; }
      }
    }

    if (!gp) {
      pad.active = false;
      pad.index = null;
      pad.id = '';
      pad.mapping = '';
      return;
    }

    pad.active = true;
    pad.id = gp.id || '';
    pad.mapping = gp.mapping || '';
    pad.buttonsCount = gp.buttons ? gp.buttons.length : 0;
    pad.axesCount = gp.axes ? gp.axes.length : 0;

    // Debug snapshot of axes (rounded)
    pad.axesRaw = (gp.axes || []).map(v => Math.round(v * 100) / 100);

    // Pressed buttons list
    pad.pressedButtons = [];
    if (gp.buttons) {
      for (let i = 0; i < gp.buttons.length; i++) {
        if (gp.buttons[i]?.pressed) pad.pressedButtons.push(i);
      }
    }

    // Standard mapping (Xbox-like): axes 0/1 left stick, 2/3 right stick
    const ax0 = gp.axes[0] ?? 0;
    const ax1 = gp.axes[1] ?? 0;
    const ax2 = gp.axes[2] ?? 0;
    const ax3 = gp.axes[3] ?? 0;

    pad.moveX = deadzone(ax0, MOVE_DEADZONE);
    pad.moveY = deadzone(ax1, MOVE_DEADZONE);

    pad.aimX = deadzone(ax2, AIM_DEADZONE);
    pad.aimY = deadzone(ax3, AIM_DEADZONE);

    // D-pad (standard buttons): 12 up, 13 down, 14 left, 15 right
    const up    = gp.buttons[12]?.pressed ?? false;
    const down  = gp.buttons[13]?.pressed ?? false;
    const left  = gp.buttons[14]?.pressed ?? false;
    const right = gp.buttons[15]?.pressed ?? false;

    pad.dpadX = (right ? 1 : 0) + (left ? -1 : 0);
    pad.dpadY = (down ? 1 : 0) + (up ? -1 : 0);

    // Shoot:
    // Standard: RT is button 7 (analog); A is 0.
    const btnA = gp.buttons[0]?.pressed ?? false;
    const rtVal = gp.buttons[7]?.value ?? 0;
    const rtPressed = gp.buttons[7]?.pressed ?? (rtVal > 0.25);

    pad.shoot = rtPressed || btnA;

    // Pause: Start is button 9
    const btnStart = gp.buttons[9]?.pressed ?? false;
    pad.pausePressed = btnStart && !pad.lastPause;
    pad.lastPause = btnStart;
  }

  window.addEventListener('gamepadconnected', (e) => {
    pad.active = true;
    pad.index = e.gamepad.index;
    pad.id = e.gamepad.id || '';
    pad.mapping = e.gamepad.mapping || '';
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    if (pad.index === e.gamepad.index) {
      pad.active = false;
      pad.index = null;
      pad.id = '';
      pad.mapping = '';
    }
  });

  // Game config
  const MAX_LEVEL_DEFAULT = 20; // user-configurable later
  const ARENA_PAD = 18;

  // State
  let upgradesDb = [];
  let lastTs = 0;

  const state = {
    running: false,
    paused: false,
    level: 1,
    maxLevel: MAX_LEVEL_DEFAULT,
    pickedUpgrades: 0,

    player: null,
    bullets: [],
    enemies: [],
    particles: [],

    overlayMode: 'none' // 'none' | 'upgrade' | 'gameover' | 'start'
  };

  function makePlayer() {
    return {
      x: canvas.width / 2,
      y: canvas.height / 2,
      size: 18,

      hp: 100,
      maxHP: 100,

      baseMoveSpeed: 220,
      baseFireCooldown: 0.22,
      baseDamage: 18,
      baseBulletSpeed: 520,

      moveSpeedMult: 1.0,
      fireRateMult: 1.0,
      damageMult: 1.0,
      bulletSpeedMult: 1.0,

      projectileCount: 1,
      spreadDeg: 0,

      hpRegenPerSec: 0,

      shootTimer: 0
    };
  }

  function resetRun() {
    state.level = 1;
    state.maxLevel = MAX_LEVEL_DEFAULT;
    state.pickedUpgrades = 0;
    state.bullets = [];
    state.enemies = [];
    state.particles = [];
    state.player = makePlayer();
    state.paused = false;
    state.running = true;

    spawnWave(state.level);
    hideOverlay();
  }

  function startGame() {
    showStartOverlay();
    state.running = false;
    state.paused = false;
    lastTs = 0;
    requestAnimationFrame(loop);
  }

  function spawnWave(level) {
    state.enemies = [];
    state.bullets = [];
    state.particles = [];

    const count = clamp(3 + Math.floor(level * 1.25), 3, 60);
    const enemyHP = 28 + level * 8;
    const enemySpeed = 70 + level * 2.5;

    for (let i = 0; i < count; i++) {
      const edge = randInt(0, 3);
      let x = 0, y = 0;

      if (edge === 0) { x = randFloat(0, canvas.width); y = -20; }
      if (edge === 1) { x = canvas.width + 20; y = randFloat(0, canvas.height); }
      if (edge === 2) { x = randFloat(0, canvas.width); y = canvas.height + 20; }
      if (edge === 3) { x = -20; y = randFloat(0, canvas.height); }

      state.enemies.push({
        x, y,
        r: 14,
        hp: enemyHP,
        maxHP: enemyHP,
        speed: enemySpeed,
        touchDps: 18,
        wobble: randFloat(0, Math.PI * 2),
        kind: (level >= 6 && Math.random() < 0.25) ? 'sprinter' : 'chaser'
      });
    }
  }

  function advanceLevel() {
    state.level += 1;

    if (state.level > state.maxLevel) {
      showGameOverOverlay(true);
      return;
    }

    showUpgradeOverlay();
  }

  function tryShoot(dt) {
    const p = state.player;
    if (!p) return;

    const cooldown = p.baseFireCooldown / p.fireRateMult;
    p.shootTimer -= dt;

    const wantShoot = mouse.down || (pad.active && pad.shoot);
    if (!wantShoot) return;
    if (p.shootTimer > 0) return;

    p.shootTimer = cooldown;

    const dx = mouse.x - p.x;
    const dy = mouse.y - p.y;
    const dir = norm(dx, dy);

    const n = Math.max(1, Math.floor(p.projectileCount));
    const spread = Math.max(0, p.spreadDeg);

    const baseAngle = Math.atan2(dir.y, dir.x);
    const totalSpread = (n === 1) ? 0 : spread;
    const start = baseAngle - degToRad(totalSpread / 2);
    const step = (n === 1) ? 0 : degToRad(totalSpread / (n - 1));

    for (let i = 0; i < n; i++) {
      const a = start + step * i;
      const vx = Math.cos(a);
      const vy = Math.sin(a);

      const speed = p.baseBulletSpeed * p.bulletSpeedMult;
      const damage = p.baseDamage * p.damageMult;

      state.bullets.push({
        x: p.x,
        y: p.y,
        r: 4,
        vx: vx * speed,
        vy: vy * speed,
        damage,
        life: 1.6
      });
    }
  }

  function update(dt) {
    if (!state.running || state.paused) return;

    const p = state.player;
    if (!p) return;

    if (p.hpRegenPerSec > 0 && p.hp > 0) {
      p.hp = clamp(p.hp + p.hpRegenPerSec * dt, 0, p.maxHP);
    }

    // controller aim: if right stick is moved, aim in that direction
    if (pad.active) {
      const ax = pad.aimX;
      const ay = pad.aimY;
      if (ax !== 0 || ay !== 0) {
        const aimDist = 220;
        mouse.x = p.x + ax * aimDist;
        mouse.y = p.y + ay * aimDist;
      }
    }

    // movement (keyboard + gamepad)
    let mx = 0, my = 0;
    if (keys.has('w')) my -= 1;
    if (keys.has('s')) my += 1;
    if (keys.has('a')) mx -= 1;
    if (keys.has('d')) mx += 1;

    if (pad.active) {
      mx += pad.moveX;
      my += pad.moveY;

      // D-pad fallback (digital)
      mx += pad.dpadX;
      my += pad.dpadY;
    }

    if (mx !== 0 || my !== 0) {
      const d = norm(mx, my);
      const spd = p.baseMoveSpeed * p.moveSpeedMult;
      p.x += d.x * spd * dt;
      p.y += d.y * spd * dt;
    }

    p.x = clamp(p.x, ARENA_PAD, canvas.width - ARENA_PAD);
    p.y = clamp(p.y, ARENA_PAD, canvas.height - ARENA_PAD);

    tryShoot(dt);

    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      if (b.life <= 0 || b.x < -40 || b.x > canvas.width + 40 || b.y < -40 || b.y > canvas.height + 40) {
        state.bullets.splice(i, 1);
      }
    }

    for (const e of state.enemies) {
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = norm(dx, dy);

      let spd = e.speed;
      if (e.kind === 'sprinter') {
        e.wobble += dt * 2.2;
        spd *= (1.0 + 0.35 * Math.max(0, Math.sin(e.wobble)));
      }

      e.x += d.x * spd * dt;
      e.y += d.y * spd * dt;

      const dist = vecLen(dx, dy);
      const overlap = (e.r + p.size * 0.55) - dist;
      if (overlap > 0) {
        p.hp = clamp(p.hp - e.touchDps * dt, 0, p.maxHP);
      }
    }

    for (let bi = state.bullets.length - 1; bi >= 0; bi--) {
      const b = state.bullets[bi];
      let hit = false;

      for (let ei = state.enemies.length - 1; ei >= 0; ei--) {
        const e = state.enemies[ei];
        const dx = e.x - b.x;
        const dy = e.y - b.y;
        const dist = vecLen(dx, dy);

        if (dist <= e.r + b.r) {
          e.hp -= b.damage;
          hit = true;

          spawnImpact(b.x, b.y, 6);

          if (e.hp <= 0) {
            spawnImpact(e.x, e.y, 18);
            state.enemies.splice(ei, 1);
          }
          break;
        }
      }

      if (hit) state.bullets.splice(bi, 1);
    }

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }

    if (p.hp <= 0) {
      showGameOverOverlay(false);
      state.running = false;
      return;
    }

    if (state.enemies.length === 0) {
      advanceLevel();
    }
  }

  function spawnImpact(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = randFloat(0, Math.PI * 2);
      const sp = randFloat(40, 240);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: randFloat(0.12, 0.32)
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#223042';
    for (let x = 0; x <= canvas.width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#cbd7e6';
    for (const pt of state.particles) {
      ctx.globalAlpha = clamp(pt.life * 3.2, 0, 0.9);
      ctx.fillRect(pt.x, pt.y, 2, 2);
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#dbe7f6';
    for (const b of state.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    for (const e of state.enemies) {
      drawTriangle(e.x, e.y, e.r * 1.25, '#ff6b6b');

      const w = 26;
      const h = 4;
      const t = clamp(e.hp / e.maxHP, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(e.x - w / 2, e.y + e.r + 10, w, h);
      ctx.fillStyle = '#ffb3b3';
      ctx.fillRect(e.x - w / 2, e.y + e.r + 10, w * t, h);
      ctx.restore();
    }

    const p = state.player;
    if (p) {
      ctx.save();
      ctx.fillStyle = '#66e3a3';
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);

      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#66e3a3';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(mouse.x, mouse.y);
      ctx.stroke();

      const w = 120;
      const h = 6;
      const t = clamp(p.hp / p.maxHP, 0, 1);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(16, 16, w, h);
      ctx.fillStyle = '#66e3a3';
      ctx.fillRect(16, 16, w * t, h);

      ctx.restore();
    }

    if (state.paused) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e7eef7';
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText('Paused (press P or Start)', canvas.width / 2 - 100, canvas.height / 2);
      ctx.restore();
    }
  }

  function drawTriangle(x, y, size, fill) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size * 0.88, y + size * 0.72);
    ctx.lineTo(x + size * 0.88, y + size * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function updateHud() {
    hudLevel.textContent = String(state.level);
    hudEnemies.textContent = String(state.enemies.length);

    const p = state.player;
    hudHP.textContent = p ? `${Math.ceil(p.hp)} / ${p.maxHP}` : '0';
    hudUpgrades.textContent = String(state.pickedUpgrades);

    if (!pad.active) {
      hudPad.textContent = 'Not detected (click page, press A/Start)';
      return;
    }

    const idShort = pad.id ? pad.id.slice(0, 46) : 'Gamepad';
    const axesTxt = pad.axesRaw.length ? pad.axesRaw.join(',') : '(none)';
    const btnTxt = pad.pressedButtons.length ? pad.pressedButtons.join(',') : '(none)';

    hudPad.textContent =
      `OK (idx ${pad.index}) ${idShort} (${pad.mapping || 'no-map'}) | ` +
      `axes: [${axesTxt}] | pressed: [${btnTxt}]`;
  }

  // Overlay helpers
  function showOverlay(title, bodyNodes, actionButtons) {
    overlayTitle.textContent = title;

    overlayBody.innerHTML = '';
    for (const n of bodyNodes) overlayBody.appendChild(n);

    overlayActions.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'btnrow';
    for (const btn of actionButtons) row.appendChild(btn);
    overlayActions.appendChild(row);

    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
    state.overlayMode = 'none';
  }

  function makeButton(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function makeCard(upg, onPick) {
    const card = document.createElement('div');
    card.className = 'card';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = upg.name;

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = upg.desc;

    const pick = makeButton('Pick', onPick);

    card.appendChild(name);
    card.appendChild(desc);
    card.appendChild(pick);

    return card;
  }

  function showStartOverlay() {
    state.overlayMode = 'start';

    const body = document.createElement('div');
    body.className = 'card';

    const secureMsg = window.isSecureContext
      ? 'Secure context: OK.'
      : 'Secure context: NOT OK. Use https or http://localhost.';

    body.innerHTML = `
      <div class="name">Stripped Rogue-lite</div>
      <div class="desc">
        Clear waves. Pick 1 upgrade after each wave. Default ends at level ${MAX_LEVEL_DEFAULT}.
      </div>
      <div class="desc">
        Keyboard: WASD move, Mouse aim, Left click shoot, P pause.<br/>
        Controller: Left stick move, Right stick aim, RT or A shoot, Start pause.
      </div>
      <div class="desc">
        Controller activation: click the page, then press A or Start once.
      </div>
      <div class="desc">
        ${secureMsg}
      </div>
    `;

    const startBtn = makeButton('Start', () => resetRun());
    showOverlay('Start', [body], [startBtn]);
  }

  function showGameOverOverlay(win) {
    state.overlayMode = 'gameover';

    const body = document.createElement('div');
    body.className = 'card';

    const title = win ? 'Run Complete' : 'Game Over';
    const msg = win
      ? `You reached level ${state.level - 1} (max ${state.maxLevel}).`
      : `You reached level ${state.level}.`;

    body.innerHTML = `
      <div class="name">${title}</div>
      <div class="desc">${msg}</div>
      <div class="desc">Upgrades taken: ${state.pickedUpgrades}</div>
    `;

    const restartBtn = makeButton('Restart', () => resetRun());
    const menuBtn = makeButton('Main Menu', () => showStartOverlay());

    showOverlay(title, [body], [restartBtn, menuBtn]);
  }

  function showUpgradeOverlay() {
    state.overlayMode = 'upgrade';
    state.running = false;

    const picks = pickThreeUpgrades();
    const nodes = picks.map((u) => makeCard(u, () => {
      applyUpgrade(u);
      state.pickedUpgrades += 1;
      hideOverlay();
      state.running = true;
      spawnWave(state.level);
    }));

    const info = document.createElement('div');
    info.className = 'card';
    info.innerHTML = `
      <div class="name">Level ${state.level - 1} cleared</div>
      <div class="desc">Pick 1 upgrade, then the next wave starts.</div>
    `;

    nodes.unshift(info);

    showOverlay('Choose an Upgrade', nodes, [
      makeButton('Skip (no upgrade)', () => {
        hideOverlay();
        state.running = true;
        spawnWave(state.level);
      })
    ]);
  }

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
  }

  function pickThreeUpgrades() {
    if (upgradesDb.length === 0) return [];
    const pool = upgradesDb.slice();
    const picks = [];
    while (picks.length < 3 && pool.length > 0) {
      const idx = randInt(0, pool.length - 1);
      picks.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return picks;
  }

  function applyUpgrade(upg) {
    const p = state.player;
    if (!p) return;

    const stat = upg.stat;
    const op = upg.op;
    const val = upg.value;

    if (!(stat in p)) return;

    if (op === 'add') p[stat] += val;
    else if (op === 'mul') p[stat] *= val;

    if (stat === 'maxHP') {
      p.hp = clamp(p.hp + val, 0, p.maxHP);
    }
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = clamp((ts - lastTs) / 1000, 0, 0.033);
    lastTs = ts;

    readGamepad();

    // Start button pauses during gameplay
    if (pad.active && pad.pausePressed) togglePause();

    update(dt);
    draw();
    updateHud();

    requestAnimationFrame(loop);
  }

  async function loadUpgrades() {
    try {
      const res = await fetch('upgrades.json', { cache: 'no-store' });
      const data = await res.json();
      upgradesDb = Array.isArray(data.upgrades) ? data.upgrades : [];
    } catch (e) {
      upgradesDb = [];
      console.warn('Failed to load upgrades.json', e);
    }
  }

  (async function boot() {
    await loadUpgrades();
    startGame();
  })();
})();

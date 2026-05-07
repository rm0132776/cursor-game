const CONFIG = {
  base: {
    radius: 56,
    startingHealth: 100,
    enemyDamage: 10,
  },
  cursor: {
    baseRadius: 46,
    basePulseDamage: 34,
    basePulseInterval: 0.72,
    minPulseInterval: 0.32,
  },
  economy: {
    enemyReward: 20,
  },
  enemy: {
    minSize: 30,
    randomSize: 22,
    baseHealth: 44,
    healthPerWave: 12,
    baseSpeed: 34,
    speedPerWave: 7,
    randomSpeed: 22,
    spawnBaseMs: 900,
    spawnPerWaveMs: 80,
    spawnMinMs: 320,
  },
  waves: {
    killsPerWave: 6,
    upgradeInterval: 3,
  },
  upgrades: {
    costIncrease: 45,
    baseHealthPerLevel: 25,
    cursorRadiusPerLevel: 10,
    pulseDamagePerLevel: 14,
    pulseIntervalReductionPerLevel: 0.08,
  },
};

const UPGRADE_DEFINITIONS = [
  {
    id: "pulseDamage",
    name: "Pulse Amplifier",
    detail: "+14 pulse damage",
    baseCost: 60,
  },
  {
    id: "cursorRadius",
    name: "Wider Aura",
    detail: "+10 cursor radius",
    baseCost: 70,
  },
  {
    id: "pulseSpeed",
    name: "Quicker Charge",
    detail: "Pulse cooldown -0.08s",
    baseCost: 80,
  },
  {
    id: "baseHealth",
    name: "Core Plating",
    detail: "+25 starting base health",
    baseCost: 65,
  },
];

function getElements(documentRef = document) {
  return {
    arena: documentRef.getElementById("main-area"),
    currency: documentRef.getElementById("currency"),
    baseHealth: documentRef.getElementById("base-health"),
    wave: documentRef.getElementById("wave"),
    cursor: documentRef.getElementById("cursor-circle"),
    message: documentRef.getElementById("message"),
    messageTitle: documentRef.getElementById("message-title"),
    messageDetail: documentRef.getElementById("message-detail"),
    upgradePanel: documentRef.getElementById("upgrade-panel"),
    upgradeTitle: documentRef.getElementById("upgrade-title"),
    runSummary: documentRef.getElementById("run-summary"),
    upgradeOptions: documentRef.getElementById("upgrade-options"),
    templates: {
      enemy: documentRef.getElementById("enemy-template"),
      upgradeCard: documentRef.getElementById("upgrade-card-template"),
      continueCard: documentRef.getElementById("continue-card-template"),
      burst: documentRef.getElementById("burst-template"),
      pulseHit: documentRef.getElementById("pulse-hit-template"),
    },
  };
}

function createGameState() {
  return {
    currency: 0,
    baseHealth: CONFIG.base.startingHealth,
    wave: 1,
    run: 1,
    runKills: 0,
    nextEnemyId: 1,
    cursor: {
      x: 0,
      y: 0,
      active: false,
    },
    timers: {
      lastFrame: performance.now(),
      lastSpawn: 0,
      pulseTime: 0,
      pulseReady: false,
    },
    flags: {
      gameOver: false,
      pausedForUpgrade: false,
      upgradeMode: "death",
    },
    upgrades: {
      pulseDamage: 0,
      cursorRadius: 0,
      pulseSpeed: 0,
      baseHealth: 0,
    },
    claimedMilestones: new Set(),
    enemies: [],
  };
}

function resetRunState(state) {
  state.baseHealth = getMaxBaseHealth(state);
  state.wave = 1;
  state.runKills = 0;
  state.nextEnemyId = 1;
  state.enemies = [];
  state.claimedMilestones = new Set();
  state.timers.lastFrame = performance.now();
  state.timers.lastSpawn = 0;
  state.timers.pulseTime = 0;
  state.timers.pulseReady = false;
  state.flags.gameOver = false;
  state.flags.pausedForUpgrade = false;
  state.flags.upgradeMode = "death";
}

function getMaxBaseHealth(state) {
  return CONFIG.base.startingHealth + state.upgrades.baseHealth * CONFIG.upgrades.baseHealthPerLevel;
}

function getCursorRadius(state) {
  return CONFIG.cursor.baseRadius + state.upgrades.cursorRadius * CONFIG.upgrades.cursorRadiusPerLevel;
}

function getPulseDamage(state) {
  return CONFIG.cursor.basePulseDamage + state.upgrades.pulseDamage * CONFIG.upgrades.pulseDamagePerLevel;
}

function getPulseInterval(state) {
  const interval = CONFIG.cursor.basePulseInterval -
    state.upgrades.pulseSpeed * CONFIG.upgrades.pulseIntervalReductionPerLevel;
  return Math.max(CONFIG.cursor.minPulseInterval, interval);
}

function spawnEnemy(state, arenaRect) {
  const size = CONFIG.enemy.minSize + Math.random() * CONFIG.enemy.randomSize;
  const side = Math.floor(Math.random() * 4);
  let x = 0;
  let y = 0;

  if (side === 0) {
    x = Math.random() * arenaRect.width;
    y = -size;
  } else if (side === 1) {
    x = arenaRect.width + size;
    y = Math.random() * arenaRect.height;
  } else if (side === 2) {
    x = Math.random() * arenaRect.width;
    y = arenaRect.height + size;
  } else {
    x = -size;
    y = Math.random() * arenaRect.height;
  }

  const maxHealth = CONFIG.enemy.baseHealth + state.wave * CONFIG.enemy.healthPerWave;
  const enemy = {
    id: state.nextEnemyId,
    x,
    y,
    size,
    health: maxHealth,
    maxHealth,
    speed: CONFIG.enemy.baseSpeed + state.wave * CONFIG.enemy.speedPerWave + Math.random() * CONFIG.enemy.randomSpeed,
  };

  state.nextEnemyId += 1;
  state.enemies.push(enemy);
  return enemy;
}

function getSpawnDelay(state) {
  return Math.max(
    CONFIG.enemy.spawnMinMs,
    CONFIG.enemy.spawnBaseMs - state.wave * CONFIG.enemy.spawnPerWaveMs
  );
}

function moveEnemyToward(enemy, targetX, targetY, delta) {
  const angle = Math.atan2(targetY - enemy.y, targetX - enemy.x);
  enemy.x += Math.cos(angle) * enemy.speed * delta;
  enemy.y += Math.sin(angle) * enemy.speed * delta;
}

function removeEnemy(state, enemy) {
  state.enemies = state.enemies.filter((item) => item.id !== enemy.id);
}

function recordEnemyKill(state) {
  state.currency += CONFIG.economy.enemyReward;
  state.runKills += 1;

  const nextWave = Math.max(1, Math.floor(state.runKills / CONFIG.waves.killsPerWave) + 1);
  if (nextWave === state.wave) {
    return { waveChanged: false, milestoneReached: false };
  }

  state.wave = nextWave;

  const milestoneReached = state.wave > 1 &&
    state.wave % CONFIG.waves.upgradeInterval === 0 &&
    !state.claimedMilestones.has(state.wave);

  if (milestoneReached) {
    state.claimedMilestones.add(state.wave);
  }

  return { waveChanged: true, milestoneReached };
}

function isEnemyInsideCursor(state, enemy) {
  const distance = Math.hypot(state.cursor.x - enemy.x, state.cursor.y - enemy.y);
  return state.cursor.active && distance < getCursorRadius(state) + enemy.size / 2;
}

function damageEnemyFromPulse(state, enemy) {
  enemy.health -= getPulseDamage(state) + state.wave * 7;
  return enemy.health <= 0;
}

function hasEnemyReachedBase(enemy, targetX, targetY) {
  const distance = Math.hypot(targetX - enemy.x, targetY - enemy.y);
  return distance < CONFIG.base.radius + enemy.size / 2;
}

function damageBase(state) {
  state.baseHealth = Math.max(0, state.baseHealth - CONFIG.base.enemyDamage);
  if (state.baseHealth === 0) {
    state.flags.gameOver = true;
  }
}

function getUpgradeCost(state, upgrade) {
  return upgrade.baseCost + state.upgrades[upgrade.id] * CONFIG.upgrades.costIncrease;
}

function buyUpgrade(state, upgradeId) {
  const upgrade = UPGRADE_DEFINITIONS.find((item) => item.id === upgradeId);
  if (!upgrade) {
    return false;
  }

  const cost = getUpgradeCost(state, upgrade);
  if (state.currency < cost) {
    return false;
  }

  state.currency -= cost;
  state.upgrades[upgradeId] += 1;
  return true;
}

function createDomRenderer(elements, state) {
  const enemyElements = new Map();

  function syncHud() {
    elements.currency.textContent = state.currency;
    elements.baseHealth.textContent = state.baseHealth;
    elements.wave.textContent = state.wave;
  }

  function renderCursorSize() {
    const radius = getCursorRadius(state);
    elements.cursor.style.width = `${radius * 2}px`;
    elements.cursor.style.height = `${radius * 2}px`;
  }

  function renderCursor() {
    elements.cursor.style.left = `${state.cursor.x}px`;
    elements.cursor.style.top = `${state.cursor.y}px`;
    elements.cursor.style.display = "block";
  }

  function hideCursor() {
    elements.cursor.style.display = "none";
  }

  function pulseCursor() {
    elements.cursor.classList.remove("pulse");
    void elements.cursor.offsetWidth;
    elements.cursor.classList.add("pulse");
  }

  function setMessage(title, detail = "") {
    elements.messageTitle.textContent = title;
    elements.messageDetail.textContent = detail;
    elements.message.classList.add("show");
  }

  function hideMessage() {
    elements.message.classList.remove("show");
  }

  function renderEnemy(enemy) {
    let element = enemyElements.get(enemy.id);
    if (!element) {
      element = elements.templates.enemy.content.firstElementChild.cloneNode(true);
      element.style.width = `${enemy.size}px`;
      element.style.height = `${enemy.size}px`;
      elements.arena.appendChild(element);
      enemyElements.set(enemy.id, element);
    }

    element.style.left = `${enemy.x}px`;
    element.style.top = `${enemy.y}px`;
    element.querySelector(".enemy-health").style.transform =
      `scaleX(${Math.max(0, enemy.health / enemy.maxHealth)})`;
  }

  function markEnemyDamaged(enemy) {
    const element = enemyElements.get(enemy.id);
    if (element) {
      element.classList.add("taking-damage");
    }
  }

  function clearEnemyDamage(enemy) {
    const element = enemyElements.get(enemy.id);
    if (element) {
      element.classList.remove("taking-damage");
    }
  }

  function removeEnemyElement(enemy) {
    const element = enemyElements.get(enemy.id);
    if (element) {
      element.remove();
      enemyElements.delete(enemy.id);
    }
  }

  function clearEnemies() {
    enemyElements.forEach((element) => element.remove());
    enemyElements.clear();
  }

  function showUpgradePanel(mode, handlers) {
    state.flags.upgradeMode = mode;
    elements.upgradeTitle.textContent = mode === "milestone" ? `Wave ${state.wave} upgrade` : "Choose an upgrade";
    elements.runSummary.textContent = mode === "milestone"
      ? `${state.currency} currency available`
      : `Run ${state.run} ended on wave ${state.wave} with ${state.currency} currency`;
    elements.upgradeOptions.replaceChildren();

    UPGRADE_DEFINITIONS.forEach((upgrade) => {
      const cost = getUpgradeCost(state, upgrade);
      const button = elements.templates.upgradeCard.content.firstElementChild.cloneNode(true);
      button.disabled = state.currency < cost;
      button.querySelector("strong").textContent = upgrade.name;
      button.querySelector("span").textContent = upgrade.detail;
      button.querySelector("small").textContent = `Level ${state.upgrades[upgrade.id]} - ${cost} currency`;
      button.addEventListener("click", () => handlers.onUpgrade(upgrade.id));
      elements.upgradeOptions.appendChild(button);
    });

    const continueButton = elements.templates.continueCard.content.firstElementChild.cloneNode(true);
    continueButton.querySelector("strong").textContent = mode === "milestone" ? "Keep Fighting" : "Start Next Run";
    continueButton.querySelector("span").textContent = "Save currency for later";
    continueButton.querySelector("small").textContent = mode === "milestone" ? "Continue run" : "No upgrade";
    continueButton.addEventListener("click", handlers.onContinue);
    elements.upgradeOptions.appendChild(continueButton);

    elements.upgradePanel.classList.add("show");
  }

  function hideUpgradePanel() {
    elements.upgradePanel.classList.remove("show");
  }

  return {
    syncHud,
    renderCursorSize,
    renderCursor,
    hideCursor,
    pulseCursor,
    setMessage,
    hideMessage,
    renderEnemy,
    markEnemyDamaged,
    clearEnemyDamage,
    removeEnemy: removeEnemyElement,
    clearEnemies,
    showUpgradePanel,
    hideUpgradePanel,
  };
}

function createEffectsRenderer(elements) {
  function createEffect(template, x, y, size, scale, lifetime) {
    const effect = template.content.firstElementChild.cloneNode(true);
    effect.style.left = `${x}px`;
    effect.style.top = `${y}px`;
    effect.style.width = `${size * scale}px`;
    effect.style.height = `${size * scale}px`;
    elements.arena.appendChild(effect);
    window.setTimeout(() => effect.remove(), lifetime);
  }

  return {
    burst(x, y, size) {
      createEffect(elements.templates.burst, x, y, size, 1.8, 360);
    },

    pulseHit(x, y, size) {
      createEffect(elements.templates.pulseHit, x, y, size, 1.4, 260);
    },
  };
}

function bindInput(elements, state, renderer) {
  elements.arena.addEventListener("mousemove", (event) => {
    const rect = elements.arena.getBoundingClientRect();
    state.cursor.x = event.clientX - rect.left;
    state.cursor.y = event.clientY - rect.top;
    state.cursor.active = true;
    renderer.renderCursor();
    renderer.hideMessage();
  });

  elements.arena.addEventListener("mouseleave", () => {
    state.cursor.active = false;
    renderer.hideCursor();
  });
}

function createGameController(elements) {
  const state = createGameState();
  const renderer = createDomRenderer(elements, state);
  const effects = createEffectsRenderer(elements);

  function showUpgrade(mode) {
    state.flags.pausedForUpgrade = mode === "milestone";
    renderer.syncHud();
    renderer.showUpgradePanel(mode, {
      onUpgrade: (upgradeId) => {
        if (buyUpgrade(state, upgradeId)) {
          renderer.renderCursorSize();
          renderer.syncHud();
        }

        if (state.flags.upgradeMode === "milestone") {
          continueRun();
        } else {
          state.run += 1;
          restartRun();
        }
      },
      onContinue: () => {
        if (state.flags.upgradeMode === "milestone") {
          continueRun();
        } else {
          state.run += 1;
          restartRun();
        }
      },
    });
  }

  function restartRun() {
    renderer.clearEnemies();
    resetRunState(state);
    renderer.syncHud();
    renderer.renderCursorSize();
    renderer.setMessage("Move your cursor over enemies to burn them down");
    renderer.hideUpgradePanel();
    requestAnimationFrame(tick);
  }

  function continueRun() {
    state.flags.pausedForUpgrade = false;
    state.timers.lastFrame = performance.now();
    renderer.hideUpgradePanel();
    renderer.hideMessage();
    requestAnimationFrame(tick);
  }

  function handleEnemyKilled(enemy) {
    const waveResult = recordEnemyKill(state);
    effects.burst(enemy.x, enemy.y, enemy.size);
    renderer.removeEnemy(enemy);
    removeEnemy(state, enemy);
    renderer.syncHud();

    if (waveResult.milestoneReached) {
      showUpgrade("milestone");
    }
  }

  function handleBaseHit(enemy) {
    damageBase(state);
    effects.burst(enemy.x, enemy.y, enemy.size);
    renderer.removeEnemy(enemy);
    removeEnemy(state, enemy);
    renderer.syncHud();

    if (state.flags.gameOver) {
      renderer.setMessage("Game over", `${state.currency} currency saved`);
      showUpgrade("death");
    }
  }

  function tick(now) {
    if (state.flags.gameOver || state.flags.pausedForUpgrade) {
      return;
    }

    const arenaRect = elements.arena.getBoundingClientRect();
    const delta = Math.min(0.04, (now - state.timers.lastFrame) / 1000);
    state.timers.lastFrame = now;
    state.timers.pulseTime += delta;

    if (state.timers.pulseTime >= getPulseInterval(state)) {
      state.timers.pulseTime -= getPulseInterval(state);
      state.timers.pulseReady = true;
      renderer.pulseCursor();
    }

    if (state.timers.lastSpawn === 0 || now - state.timers.lastSpawn > getSpawnDelay(state)) {
      const enemy = spawnEnemy(state, arenaRect);
      renderer.renderEnemy(enemy);
      state.timers.lastSpawn = now;
    }

    const targetX = arenaRect.width / 2;
    const targetY = arenaRect.height / 2;

    state.enemies.slice().forEach((enemy) => {
      renderer.clearEnemyDamage(enemy);
      moveEnemyToward(enemy, targetX, targetY, delta);

      if (state.timers.pulseReady && isEnemyInsideCursor(state, enemy)) {
        const killed = damageEnemyFromPulse(state, enemy);
        effects.pulseHit(enemy.x, enemy.y, enemy.size);
        renderer.markEnemyDamaged(enemy);

        if (killed) {
          handleEnemyKilled(enemy);
          return;
        }
      }

      if (hasEnemyReachedBase(enemy, targetX, targetY)) {
        handleBaseHit(enemy);
        return;
      }

      renderer.renderEnemy(enemy);
    });

    state.timers.pulseReady = false;
    requestAnimationFrame(tick);
  }

  function start() {
    bindInput(elements, state, renderer);
    resetRunState(state);
    renderer.syncHud();
    renderer.renderCursorSize();
    requestAnimationFrame(tick);
  }

  return { start, restartRun };
}

const elements = getElements();
const game = createGameController(elements);

game.start();

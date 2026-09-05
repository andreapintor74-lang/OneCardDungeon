/**
 * ============================================================================
 * ONE CARD DUNGEON - Web App Vanilla JS
 * ============================================================================
 * Implementazione conforme al 100% al regolamento ufficiale di Little Rocket Games
 * (ideato da Barny Skinner).
 *
 * Meccaniche implementate:
 *  - Plancia 5x5 a 4 orientamenti (Fronte/Retro 0° e 180°) per i 12 livelli
 *  - Gittata calcolata come costo di movimento (ortogonale = 2, diagonale = 3)
 *  - Libertà totale nel turno eroe di alternare passi e attacchi in qualsiasi ordine
 *  - IA dei Mostri: riposizionamento tattico a raggio massimo con Line of Sight
 *  - Combattimento a divisione: Danno = Math.floor(AttaccoTotale / Difesa)
 *  - Fine livello con scelta esclusiva: +1 a un'abilità OPPURE Cura Completa (6 HP)
 *  - Variante con 4 Classi di gioco (Paladino, Barbaro, Ranger, Mago)
 */

"use strict";

/* ==========================================================================
   1. STATO GLOBALE DEL GIOCO (GAME STATE)
   ========================================================================== */
const gameState = {
  levelIndex: 0, // 0..11 per i livelli 1..12
  heroClass: "Warrior",

  // Abilità permanenti dell'Avventuriero
  hero: {
    maxHp: 6,
    hp: 6,
    speed: 1,
    attack: 1,
    defense: 1,
    range: 2, // Gittata iniziale 2: permette solo attacchi ortogonali!
    pos: { r: 4, c: 0 }
  },

  // Mostri attivi nel piano corrente
  monsters: [],

  // Dati del turno
  turn: {
    phase: "ENERGY", // "ENERGY" | "ASSIGNMENT" | "ADVENTURER_PHASE" | "MONSTER_TURN"
    energyDice: [null, null, null],
    assignedDice: { speed: null, attack: null, defense: null },
    remainingSpeed: 0,
    remainingAttack: 0,
    currentDefense: 0,
    rangeBonus: 0,
    classAbilityUsedThisTurn: false
  },

  // Tracciamento abilità speciali di classe (una volta per livello)
  classAbilityUsedThisLevel: false,
  savedEnergyDie: null,

  // Azione attualmente in attesa di conferma del giocatore
  pendingAction: null
};

let saveDirectoryHandle = null;

/* ==========================================================================
   2. MOTORE GEOMETRICO: MOVIMENTO, GITTATA E LINE OF SIGHT (LOS)
   ========================================================================== */
const GameEngine = {
  isInside(r, c) {
    return r >= 0 && r < 5 && c >= 0 && c < 5;
  },

  /**
   * Calcola la distanza minima in punti movimento tra due caselle (tenendo conto dei muri).
   * Regola ufficiale: "La gittata verso un bersaglio è calcolata nello stesso modo del movimento:
   * un mostro ortogonalmente adiacente è a gittata 2, diagonalmente a gittata 3...".
   */
  calculateRangeDistance(p1, p2, grid) {
    if (p1.r === p2.r && p1.c === p2.c) return 0;

    // Dijkstra per trovare il costo minimo di movimento
    const distMap = new Map();
    const queue = [{ r: p1.r, c: p1.c, cost: 0 }];
    distMap.set(`${p1.r},${p1.c}`, 0);

    const directions = [
      { dr: -1, dc: 0, cost: 2 },
      { dr: 1,  dc: 0, cost: 2 },
      { dr: 0,  dc: -1, cost: 2 },
      { dr: 0,  dc: 1,  cost: 2 },
      { dr: -1, dc: -1, cost: 3 },
      { dr: -1, dc: 1,  cost: 3 },
      { dr: 1,  dc: -1, cost: 3 },
      { dr: 1,  dc: 1,  cost: 3 }
    ];

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const curr = queue.shift();

      if (curr.r === p2.r && curr.c === p2.c) {
        return curr.cost;
      }

      if (curr.cost > (distMap.get(`${curr.r},${curr.c}`) ?? Infinity)) continue;

      for (let dir of directions) {
        const nr = curr.r + dir.dr;
        const nc = curr.c + dir.dc;

        if (!this.isInside(nr, nc)) continue;
        // Non si passa attraverso i muri
        if (grid[nr][nc] === "wall") continue;

        const newCost = curr.cost + dir.cost;
        const nKey = `${nr},${nc}`;

        if (!distMap.has(nKey) || newCost < distMap.get(nKey)) {
          distMap.set(nKey, newCost);
          queue.push({ r: nr, c: nc, cost: newCost });
        }
      }
    }

    return Infinity; // Irraggiungibile per via dei muri
  },

  /**
   * Line of Sight (LOS) ufficiale:
   * "Se una linea retta può essere tracciata da qualsiasi angolo della tua casella
   * a qualsiasi angolo della casella del mostro senza attraversare muri o altri mostri,
   * hai Line of Sight."
   */
  hasLineOfSight(p1, p2, grid, monsters) {
    if (p1.r === p2.r && p1.c === p2.c) return true;

    // Centro e 4 angoli della casella
    const offsets = [
      { dr: 0.5, dc: 0.5 },
      { dr: 0.15, dc: 0.15 },
      { dr: 0.85, dc: 0.15 },
      { dr: 0.15, dc: 0.85 },
      { dr: 0.85, dc: 0.85 }
    ];

    for (let o1 of offsets) {
      const x1 = p1.c + o1.dc;
      const y1 = p1.r + o1.dr;

      for (let o2 of offsets) {
        const x2 = p2.c + o2.dc;
        const y2 = p2.r + o2.dr;

        if (this.checkRay(x1, y1, x2, y2, p1, p2, grid, monsters)) {
          return true;
        }
      }
    }

    return false;
  },

  checkRay(x1, y1, x2, y2, cellA, cellB, grid, monsters) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist * 12);

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cx = Math.floor(x1 + dx * t);
      const cy = Math.floor(y1 + dy * t);

      // Ignora la casella di partenza e quella di arrivo
      if ((cy === cellA.r && cx === cellA.c) || (cy === cellB.r && cx === cellB.c)) {
        continue;
      }

      if (!this.isInside(cy, cx)) return false;

      // I muri bloccano la LOS
      if (grid[cy][cx] === "wall") return false;

      // Gli altri mostri intermedi bloccano la LOS
      const blocker = monsters.some(
        (m) => m.hp > 0 && m.r === cy && m.c === cx && !(cy === cellB.r && cx === cellB.c) && !(cy === cellA.r && cx === cellA.c)
      );
      if (blocker) return false;
    }

    return true;
  },

  /**
   * Calcola le caselle raggiungibili dall'eroe o da un mostro.
   * Regole di costo: ortogonale = 2 punti, diagonale = 3 punti.
   */
  calculateReachableCells(startPos, maxPoints, grid, monsters, isHero = true) {
    const distMap = new Map();
    distMap.set(`${startPos.r},${startPos.c}`, 0);
    const queue = [{ r: startPos.r, c: startPos.c, cost: 0 }];

    const directions = [
      { dr: -1, dc: 0, cost: 2 },
      { dr: 1,  dc: 0, cost: 2 },
      { dr: 0,  dc: -1, cost: 2 },
      { dr: 0,  dc: 1,  cost: 2 },
      { dr: -1, dc: -1, cost: 3 },
      { dr: -1, dc: 1,  cost: 3 },
      { dr: 1,  dc: -1, cost: 3 },
      { dr: 1,  dc: 1,  cost: 3 }
    ];

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const curr = queue.shift();

      if (curr.cost > (distMap.get(`${curr.r},${curr.c}`) ?? Infinity)) continue;

      for (let dir of directions) {
        const nr = curr.r + dir.dr;
        const nc = curr.c + dir.dc;

        if (!this.isInside(nr, nc)) continue;
        if (grid[nr][nc] === "wall") continue;

        // L'eroe non può attraversare caselle con mostri
        if (isHero) {
          const hasMonster = monsters.some((m) => m.hp > 0 && m.r === nr && m.c === nc);
          if (hasMonster) continue;
        }

        const newCost = curr.cost + dir.cost;
        if (newCost <= maxPoints) {
          const nKey = `${nr},${nc}`;
          if (!distMap.has(nKey) || newCost < distMap.get(nKey)) {
            distMap.set(nKey, newCost);
            queue.push({ r: nr, c: nc, cost: newCost });
          }
        }
      }
    }

    return distMap;
  }
};

/* ==========================================================================
   3. MOTORE DADI
   ========================================================================== */
const DiceEngine = {
  rollD6() {
    return Math.floor(Math.random() * 6) + 1;
  },

  rollEnergyDice(onComplete) {
    const diceElements = [
      document.getElementById("die-0"),
      document.getElementById("die-1"),
      document.getElementById("die-2")
    ];

    diceElements.forEach((el) => el.classList.add("rolling"));

    let ticks = 0;
    const interval = setInterval(() => {
      ticks++;
      diceElements.forEach((el) => {
        el.querySelector(".die-val").textContent = DiceEngine.rollD6();
      });

      if (ticks >= 8) {
        clearInterval(interval);
        diceElements.forEach((el) => el.classList.remove("rolling"));

        gameState.turn.energyDice = [
          DiceEngine.rollD6(),
          DiceEngine.rollD6(),
          DiceEngine.rollD6()
        ];

        gameState.turn.energyDice.forEach((val, idx) => {
          diceElements[idx].querySelector(".die-val").textContent = val;
        });

        if (typeof onComplete === "function") {
          onComplete(gameState.turn.energyDice);
        }
      }
    }, 45);
  }
};

/* ==========================================================================
   4. RENDERER DELLA PLANCIA 5x5
   ========================================================================== */
const BoardRenderer = {
  render() {
    const boardEl = document.getElementById("dungeon-board");
    if (!boardEl) return;

    boardEl.innerHTML = "";
    const currentLevel = DUNGEON_LEVELS[gameState.levelIndex];
    const colLabels = ["A", "B", "C", "D", "E"];

    // Calcola caselle raggiungibili dall'eroe se in fase avventuriero e ha punti movimento
    let reachableMap = new Map();
    if (gameState.turn.phase === "ADVENTURER_PHASE" && gameState.turn.remainingSpeed >= 2) {
      reachableMap = GameEngine.calculateReachableCells(
        gameState.hero.pos,
        gameState.turn.remainingSpeed,
        currentLevel.grid,
        gameState.monsters,
        true
      );
    }

    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const cellType = currentLevel.grid[r][c];
        const cell = document.createElement("div");
        cell.className = `cell cell-${cellType}`;
        cell.dataset.row = r;
        cell.dataset.col = c;

        // Tag coordinate (es. A1, C3)
        const coordSpan = document.createElement("span");
        coordSpan.className = "coord-tag";
        coordSpan.textContent = `${colLabels[c]}${r + 1}`;
        cell.appendChild(coordSpan);

        // Controllo se è l'Eroe
        const isHero = gameState.hero.pos.r === r && gameState.hero.pos.c === c;

        // Controllo se è un Mostro
        const monster = gameState.monsters.find((m) => m.hp > 0 && m.r === r && m.c === c);

        if (isHero) {
          cell.classList.add("cell-hero");
          const iconSpan = document.createElement("span");
          iconSpan.className = "cell-icon";
          iconSpan.textContent = "🧝";
          cell.appendChild(iconSpan);

          // Dado Verde Salute Eroe
          const hpBadge = document.createElement("span");
          hpBadge.className = "cell-badge hero-hp-badge";
          hpBadge.textContent = gameState.hero.hp;
          cell.appendChild(hpBadge);
        } else if (monster) {
          cell.classList.add("cell-monster");
          const iconSpan = document.createElement("span");
          iconSpan.className = "cell-icon";
          iconSpan.textContent = monster.icon || "👹";
          cell.appendChild(iconSpan);

          // Dado Rosso Salute Mostro
          const hpBadge = document.createElement("span");
          hpBadge.className = "cell-badge monster-hp-badge";
          hpBadge.textContent = monster.hp;
          cell.appendChild(hpBadge);

          // Controllo se il mostro è bersagliabile dall'eroe:
          // 1. Fase ADVENTURER_PHASE
          // 2. Ha abbastanza punti attacco (almeno pari alla difesa del mostro)
          // 3. È entro la gittata (in punti movimento)
          // 4. Line of Sight libera
          if (
            gameState.turn.phase === "ADVENTURER_PHASE" &&
            gameState.turn.remainingAttack >= monster.defense
          ) {
            const rangeDist = GameEngine.calculateRangeDistance(
              gameState.hero.pos,
              { r, c },
              currentLevel.grid
            );
            const hasLos = GameEngine.hasLineOfSight(
              gameState.hero.pos,
              { r, c },
              currentLevel.grid,
              gameState.monsters
            );

            if (rangeDist <= AppController.getCurrentRange() && hasLos) {
              cell.classList.add("attackable");
              cell.title = `Clicca per attaccare! Gittata: ${rangeDist} pt, Difesa: ${monster.defense}`;
            }
          }
        } else {
          // Icona statica
          const iconSpan = document.createElement("span");
          iconSpan.className = "cell-icon";
          if (cellType === "stairs") iconSpan.textContent = "🪜";
          else if (cellType === "wall") iconSpan.textContent = "🧱";
          cell.appendChild(iconSpan);

          // Evidenziazione movimento
          const cellKey = `${r},${c}`;
          if (reachableMap.has(cellKey) && (r !== gameState.hero.pos.r || c !== gameState.hero.pos.c)) {
            cell.classList.add("reachable");
            const cost = reachableMap.get(cellKey);
            const costBadge = document.createElement("span");
            costBadge.className = "cell-move-cost";
            costBadge.textContent = `-${cost}`;
            cell.appendChild(costBadge);
          }
        }

        cell.addEventListener("click", () => {
          AppController.handleCellClick(r, c, monster, reachableMap);
        });

        boardEl.appendChild(cell);
      }
    }

    const aliveCount = gameState.monsters.filter((m) => m.hp > 0).length;
    document.getElementById("dungeon-status").textContent = `Nemici Rimasti: ${aliveCount}`;
  }
};

/* ==========================================================================
   5. CONTROLLER DI GIOCO (APP CONTROLLER)
   ========================================================================== */
const AppController = {
  init() {
    this.bindEvents();
    this.showClassSelectModal();
  },

  showClassSelectModal() {
    document.getElementById("modal-class-select").classList.remove("hidden");
  },

  startGameWithClass(chosenClass) {
    gameState.heroClass = chosenClass;
    document.getElementById("hero-class-badge").textContent = chosenClass;
    document.getElementById("modal-class-select").classList.add("hidden");

    this.loadLevel(0);
    this.log(`Hai iniziato la discesa come ${chosenClass}!`, "success");
    this.log("Inizia il turno lanciando i 3 Dadi Energia nella colonna di destra.", "info");
  },

  loadLevel(index) {
    if (index >= DUNGEON_LEVELS.length) {
      document.getElementById("modal-victory").classList.remove("hidden");
      return;
    }

    gameState.levelIndex = index;
    gameState.classAbilityUsedThisLevel = false;

    const lvl = DUNGEON_LEVELS[index];
    gameState.hero.pos = { ...lvl.heroStart };

    // Clona i mostri con salute piena
    gameState.monsters = lvl.monsters.map((m) => ({ ...m, maxHp: m.hp }));

    this.resetTurnToEnergyPhase();

    // Aggiorna intestazione
    document.getElementById("level-title").textContent = `🗺️ ${lvl.name}`;
    document.getElementById("current-level").textContent = `Livello ${lvl.level} / 12`;

    // Aggiorna ispettore mostro del livello
    this.updateLevelMonsterInspector(lvl);
    this.updateStatsUI();
    BoardRenderer.render();

    this.log(`--- Entrato nel ${lvl.name} (${lvl.position}) ---`, "warning");
  },

  updateLevelMonsterInspector(lvl) {
    if (lvl.monsters.length === 0) return;
    const m = lvl.monsters[0];

    document.getElementById("insp-icon").textContent = m.icon || "👹";
    document.getElementById("insp-name").textContent = m.name;
    document.getElementById("insp-hp").textContent = m.hp;
    document.getElementById("insp-spd").textContent = m.speed;
    document.getElementById("insp-atk").textContent = m.attack;
    document.getElementById("insp-def").textContent = m.defense;
    document.getElementById("insp-rng").textContent = m.range;
    document.getElementById("insp-level-tag").textContent = `Livello ${lvl.level}`;

    document.getElementById("insp-combat-hint").textContent =
      `💡 Gittata Mostro: ${m.range} pt (orto 2, diag 3). Per infliggere 1 danno all'avversario servono ${m.defense} pt attacco.`;
  },

  bindEvents() {
    // 1. Selezione Classe
    document.querySelectorAll(".class-card-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        document.querySelectorAll(".class-card-btn").forEach((b) => b.classList.remove("selected"));
        e.currentTarget.classList.add("selected");
      });
    });

    const btnStart = document.getElementById("btn-start-game");
    if (btnStart) {
      btnStart.addEventListener("click", () => {
        const sel = document.querySelector(".class-card-btn.selected");
        const chosen = sel ? sel.dataset.class : "Warrior";
        this.startGameWithClass(chosen);
      });
    }

    // 2. Lancio Dadi
    const btnRoll = document.getElementById("btn-roll-dice");
    if (btnRoll) {
      btnRoll.addEventListener("click", () => this.handleRollDice());
    }

    // 3. Assegnazione Dadi tramite trascinamento
    document.querySelectorAll(".energy-die").forEach((die) => {
      die.addEventListener("dragstart", (event) => this.handleDieDragStart(event));
      die.addEventListener("dragend", (event) => event.currentTarget.classList.remove("dragging"));
    });
    document.querySelectorAll(".stat-assignment-slot").forEach((zone) => {
      zone.addEventListener("dragover", (event) => {
        if (gameState.turn.phase !== "ASSIGNMENT") return;
        event.preventDefault();
        zone.classList.add("drag-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        zone.classList.remove("drag-over");
        const index = Number(event.dataTransfer.getData("text/plain"));
        this.assignDieToAbility(index, zone.dataset.ability);
      });
    });

    // 4. Conferma Assegnazione
    const btnConfirm = document.getElementById("btn-confirm-turn");
    if (btnConfirm) {
      btnConfirm.addEventListener("click", () => this.handleConfirmTurn());
    }

    const btnClearAssignment = document.getElementById("btn-clear-assignment");
    if (btnClearAssignment) {
      btnClearAssignment.addEventListener("click", () => this.clearDiceAssignment());
    }

    // 5. Fine Turno Eroe (Richiede conferma)
    const btnEndHeroTurn = document.getElementById("btn-end-hero-turn");
    if (btnEndHeroTurn) {
      btnEndHeroTurn.addEventListener("click", () => {
        this.requestActionConfirmation({
          type: "END_HERO_TURN",
          icon: "⏳",
          title: "Conferma Fine Turno",
          description: `Sei sicuro di voler concludere il tuo turno?<br>` +
                       `I mostri inizieranno la loro fase di movimento e attacco.<br>` +
                       `Eventuali punti non spesi andranno persi: Movimento (<strong>${gameState.turn.remainingSpeed} pt</strong>), Attacco (<strong>${gameState.turn.remainingAttack} pt</strong>).`
        });
      });
    }

    const btnAbility = document.getElementById("btn-use-adventurer-ability");
    if (btnAbility) {
      btnAbility.addEventListener("click", () => this.useAdventurerAbility());
    }

    const btnToggleHelp = document.getElementById("btn-toggle-help");
    if (btnToggleHelp) {
      btnToggleHelp.addEventListener("click", () => {
        const help = document.getElementById("action-hint");
        const isHidden = help.classList.toggle("hidden");
        btnToggleHelp.setAttribute("aria-pressed", String(!isHidden));
      });
    }

    // 6. Listener Pulsanti Modale di Conferma Azione
    const btnConfirmAction = document.getElementById("btn-execute-action");
    if (btnConfirmAction) {
      btnConfirmAction.addEventListener("click", () => this.executePendingAction());
    }

    const btnCancelAction = document.getElementById("btn-cancel-action");
    if (btnCancelAction) {
      btnCancelAction.addEventListener("click", () => this.cancelPendingAction());
    }

    // 7. Pulisci Log
    const btnClearLog = document.getElementById("btn-clear-log");
    if (btnClearLog) {
      btnClearLog.addEventListener("click", () => {
        document.getElementById("game-log").innerHTML = "";
      });
    }

    document.getElementById("btn-save-game").addEventListener("click", () => this.saveGame());
    document.getElementById("btn-load-game").addEventListener("click", () => this.loadGame());
    document.getElementById("btn-cancel-save-files").addEventListener("click", () => {
      document.getElementById("modal-save-files").classList.add("hidden");
    });
    document.getElementById("btn-new-from-sheet").addEventListener("click", () => {
      document.getElementById("modal-existing-situation").classList.remove("hidden");
    });
    document.getElementById("btn-new-from-sheet-start").addEventListener("click", () => {
      document.getElementById("modal-class-select").classList.add("hidden");
      document.getElementById("modal-existing-situation").classList.remove("hidden");
    });
    document.getElementById("btn-cancel-situation").addEventListener("click", () => {
      document.getElementById("modal-existing-situation").classList.add("hidden");
    });
    document.getElementById("btn-start-situation").addEventListener("click", () => this.startFromExistingSituation());

    // 8. Modale Upgrade Ufficiale (Richiede conferma prima di applicare)
    document.querySelectorAll(".upgrade-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const choice = e.currentTarget.dataset.choice;
        const labels = {
          speed: "+1 Movimento Permanente",
          attack: "+1 Attacco Permanente",
          defense: "+1 Difesa Permanente",
          range: "+1 Gittata Permanente",
          heal_full: "Cura Completa al Massimo (6 HP)"
        };
        document.getElementById("modal-upgrade").classList.add("hidden");
        this.requestActionConfirmation({
          type: "UPGRADE",
          icon: choice === "heal_full" ? "💖" : "✨",
          title: "Conferma Scelta Fine Livello",
          description: `Confermi di voler scegliere: <strong>${labels[choice]}</strong>?<br>` +
                       `Ricorda: puoi scegliere solo un'opzione per piano!`,
          choice
        });
      });
    });

    // 9. Riavvio da Game Over o Vittoria
    document.getElementById("btn-restart-game").addEventListener("click", () => this.restartGame());
    document.getElementById("btn-victory-restart").addEventListener("click", () => this.restartGame());
  },

  resetTurnToEnergyPhase() {
    gameState.turn.phase = "ENERGY";
    gameState.turn.energyDice = [null, null, null];
    gameState.turn.assignedDice = { speed: null, attack: null, defense: null };
    gameState.turn.remainingSpeed = 0;
    gameState.turn.remainingAttack = 0;
    gameState.turn.currentDefense = 0;
    gameState.turn.rangeBonus = 0;
    gameState.turn.classAbilityUsedThisTurn = false;

    document.getElementById("current-phase").textContent = "Fase Energia";
    document.getElementById("btn-roll-dice").disabled = false;
    document.getElementById("action-points-bar").classList.add("hidden");
    document.getElementById("action-hint").classList.add("hidden");

    [0, 1, 2].forEach((i) => {
      const dieEl = document.getElementById(`die-${i}`);
      if (dieEl) dieEl.querySelector(".die-val").textContent = "?";
    });

    this.renderDiceAssignments();

    document.getElementById("btn-confirm-turn").disabled = true;
    const abilityButton = document.getElementById("btn-use-adventurer-ability");
    if (abilityButton) abilityButton.disabled = true;
    const helpButton = document.getElementById("btn-toggle-help");
    if (helpButton) {
      helpButton.disabled = true;
      helpButton.setAttribute("aria-pressed", "false");
    }

    // Reset delle 3 caselle dei valori modificati sotto la scheda avventuriero
    const turnSpeedEl = document.getElementById("stat-turn-speed");
    const turnAttackEl = document.getElementById("stat-turn-attack");
    const turnDefenseEl = document.getElementById("stat-turn-defense");
    if (turnSpeedEl) turnSpeedEl.textContent = "-";
    if (turnAttackEl) turnAttackEl.textContent = "-";
    if (turnDefenseEl) turnDefenseEl.textContent = "-";

    const boxSpeed = document.getElementById("box-turn-speed");
    const boxAttack = document.getElementById("box-turn-attack");
    const boxDefense = document.getElementById("box-turn-defense");
    if (boxSpeed) boxSpeed.classList.remove("active-val");
    if (boxAttack) boxAttack.classList.remove("active-val");
    if (boxDefense) boxDefense.classList.remove("active-val");
    this.updateRangeUI();
  },

  handleRollDice() {
    document.getElementById("btn-roll-dice").disabled = true;

    DiceEngine.rollEnergyDice((results) => {
      if (gameState.savedEnergyDie !== null) {
        results[0] = gameState.savedEnergyDie;
        gameState.savedEnergyDie = null;
        gameState.turn.energyDice[0] = results[0];
      }
      this.log(`Tiro Dadi Energia: [${results.join(" - ")}]`, "warning");
      gameState.turn.phase = "ASSIGNMENT";
      document.getElementById("current-phase").textContent = "Assegnazione Dadi";

      this.renderDiceAssignments();
      this.log("Assegna un dado a Movimento, uno ad Attacco e uno a Difesa.", "info");
    });
  },

  useAdventurerAbility() {
    if (gameState.turn.phase !== "ADVENTURER_PHASE") return;

    const abilityButton = document.getElementById("btn-use-adventurer-ability");
    const assigned = gameState.turn.assignedDice;

    if (gameState.heroClass === "Warrior") {
      this.log("⚔️ Il Guerriero standard non ha un'abilità speciale.", "info");
      if (abilityButton) abilityButton.disabled = true;
      return;
    }

    if (gameState.heroClass === "Barbarian") {
      if (gameState.hero.hp !== 1 || gameState.turn.classAbilityUsedThisTurn) {
        this.log("🪓 Il Barbaro può ritirare i dadi solo a 1 HP e una volta per turno.", "warning");
        return;
      }
      gameState.turn.classAbilityUsedThisTurn = true;
      this.rerollFromAbility("Barbaro", false);
      return;
    }

    if (gameState.heroClass === "Wizard") {
      if (gameState.classAbilityUsedThisLevel) return;
      gameState.classAbilityUsedThisLevel = true;
      this.rerollFromAbility("Mago", true);
      return;
    }

    if (gameState.heroClass === "Paladin") {
      if (gameState.classAbilityUsedThisLevel) return;
      const values = Object.values(assigned)
        .filter((index) => index !== null)
        .map((index) => gameState.turn.energyDice[index]);
      if (values.length === 0) return;
      gameState.savedEnergyDie = Math.max(...values);
      gameState.classAbilityUsedThisLevel = true;
      if (abilityButton) abilityButton.disabled = true;
      this.log(`✨ Il Paladino conserva il dado Energia ${gameState.savedEnergyDie} per il prossimo turno.`, "success");
      return;
    }

    if (gameState.heroClass === "Ranger") {
      if (gameState.classAbilityUsedThisLevel || assigned.speed === null) return;
      gameState.turn.rangeBonus = gameState.turn.energyDice[assigned.speed];
      gameState.turn.remainingSpeed = gameState.hero.speed;
      gameState.classAbilityUsedThisLevel = true;
      if (abilityButton) abilityButton.disabled = true;
      this.updateRangeUI();
      this.log(`🏹 Il Ranger assegna ${gameState.turn.rangeBonus} alla Gittata invece che al Movimento.`, "success");
      BoardRenderer.render();
    }
  },

  rerollFromAbility(className, oncePerLevel) {
    gameState.turn.phase = "ASSIGNMENT";
    gameState.turn.assignedDice = { speed: null, attack: null, defense: null };
    document.getElementById("current-phase").textContent = "Assegnazione Dadi";
    document.getElementById("action-points-bar").classList.add("hidden");
    document.getElementById("action-hint").classList.add("hidden");
    document.getElementById("btn-roll-dice").disabled = true;
    DiceEngine.rollEnergyDice((results) => {
      this.renderDiceAssignments();
      this.log(`🔁 ${className}: nuovi dadi Energia [${results.join(" - ")}].`, "warning");
    });
  },

  handleDieDragStart(event) {
    if (gameState.turn.phase !== "ASSIGNMENT") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    const index = event.currentTarget.dataset.index ?? event.currentTarget.id.replace("die-", "");
    event.dataTransfer.setData("text/plain", index);
    event.currentTarget.classList.add("dragging");
  },

  assignDieToAbility(index, ability) {
    if (gameState.turn.phase !== "ASSIGNMENT" || !Number.isInteger(index) || !["speed", "attack", "defense"].includes(ability)) return;

    Object.keys(gameState.turn.assignedDice).forEach((key) => {
      if (gameState.turn.assignedDice[key] === index) gameState.turn.assignedDice[key] = null;
    });
    gameState.turn.assignedDice[ability] = index;
    this.renderDiceAssignments();
  },

  clearDiceAssignment() {
    if (gameState.turn.phase !== "ASSIGNMENT") return;
    gameState.turn.assignedDice = { speed: null, attack: null, defense: null };
    this.renderDiceAssignments();
  },

  renderDiceAssignments() {
    const abilityIds = { speed: "assign-speed", attack: "assign-attack", defense: "assign-defense" };
    const assigned = gameState.turn.assignedDice;

    Object.entries(abilityIds).forEach(([ability, id]) => {
      const zone = document.getElementById(id);
      if (!zone) return;
      zone.innerHTML = "";
      const index = assigned[ability];
      if (index === null || gameState.turn.energyDice[index] === null) return;
      const die = document.createElement("div");
      die.className = "assigned-die";
      die.draggable = gameState.turn.phase === "ASSIGNMENT";
      die.dataset.index = index;
      die.textContent = `+${gameState.turn.energyDice[index]}`;
      die.addEventListener("dragstart", (event) => this.handleDieDragStart(event));
      die.addEventListener("dragend", (event) => event.currentTarget.classList.remove("dragging"));
      zone.appendChild(die);
    });

    document.querySelectorAll(".energy-die").forEach((die) => {
      const index = Number(die.id.replace("die-", ""));
      const used = Object.values(assigned).includes(index);
      die.classList.toggle("used", used);
      die.draggable = gameState.turn.phase === "ASSIGNMENT";
    });
    this.updateAssignmentTotals();
  },

  updateAssignmentTotals() {
    const { speed: sIdx, attack: aIdx, defense: dIdx } = gameState.turn.assignedDice;

    const totSpeed = gameState.hero.speed + (sIdx !== null ? gameState.turn.energyDice[sIdx] : 0);
    const totAttack = gameState.hero.attack + (aIdx !== null ? gameState.turn.energyDice[aIdx] : 0);
    const totDefense = gameState.hero.defense + (dIdx !== null ? gameState.turn.energyDice[dIdx] : 0);

    // Mostra base + dado = valore modificato nelle tre caselle del turno.
    const turnSpeedEl = document.getElementById("stat-turn-speed");
    const turnAttackEl = document.getElementById("stat-turn-attack");
    const turnDefenseEl = document.getElementById("stat-turn-defense");
    const boxSpeed = document.getElementById("box-turn-speed");
    const boxAttack = document.getElementById("box-turn-attack");
    const boxDefense = document.getElementById("box-turn-defense");

    if (turnSpeedEl && boxSpeed) {
      if (sIdx !== null) {
        turnSpeedEl.textContent = totSpeed;
        boxSpeed.classList.add("active-val");
      } else {
        turnSpeedEl.textContent = "-";
        boxSpeed.classList.remove("active-val");
      }
    }

    if (turnAttackEl && boxAttack) {
      if (aIdx !== null) {
        turnAttackEl.textContent = totAttack;
        boxAttack.classList.add("active-val");
      } else {
        turnAttackEl.textContent = "-";
        boxAttack.classList.remove("active-val");
      }
    }

    if (turnDefenseEl && boxDefense) {
      if (dIdx !== null) {
        turnDefenseEl.textContent = totDefense;
        boxDefense.classList.add("active-val");
      } else {
        turnDefenseEl.textContent = "-";
        boxDefense.classList.remove("active-val");
      }
    }

    const allAssigned = [sIdx, aIdx, dIdx].every((index) => index !== null);
    document.getElementById("btn-confirm-turn").disabled = !allAssigned;
    const clearButton = document.getElementById("btn-clear-assignment");
    if (clearButton) {
      clearButton.disabled = gameState.turn.phase !== "ASSIGNMENT" || ![sIdx, aIdx, dIdx].some((index) => index !== null);
    }
  },

  handleConfirmTurn() {
    const { speed, attack, defense } = gameState.turn.assignedDice;

    gameState.turn.remainingSpeed = gameState.hero.speed + gameState.turn.energyDice[speed];
    gameState.turn.remainingAttack = gameState.hero.attack + gameState.turn.energyDice[attack];
    gameState.turn.currentDefense = gameState.hero.defense + gameState.turn.energyDice[defense];

    gameState.turn.phase = "ADVENTURER_PHASE";
    document.getElementById("current-phase").textContent = "Turno Avventuriero";

    ["assign-speed", "assign-attack", "assign-defense"].forEach((id) => {
      document.getElementById(id).disabled = true;
    });
    document.getElementById("btn-confirm-turn").disabled = true;
    this.renderDiceAssignments();
    const helpButton = document.getElementById("btn-toggle-help");
    if (helpButton) helpButton.disabled = false;
    const abilityButton = document.getElementById("btn-use-adventurer-ability");
    if (abilityButton) {
      const usedForLevel = ["Paladin", "Ranger", "Wizard"].includes(gameState.heroClass) && gameState.classAbilityUsedThisLevel;
      const barbarianUnavailable = gameState.heroClass === "Barbarian" && (gameState.hero.hp !== 1 || gameState.turn.classAbilityUsedThisTurn);
      abilityButton.disabled = gameState.heroClass === "Warrior" || usedForLevel || barbarianUnavailable;
    }

    this.updateActionPointsBar();
    document.getElementById("action-points-bar").classList.remove("hidden");
    document.getElementById("action-hint").classList.add("hidden");

    this.log(`Punti pronti! Movimento: ${gameState.turn.remainingSpeed} | Attacco: ${gameState.turn.remainingAttack} | Difesa: ${gameState.turn.currentDefense}`, "success");
    BoardRenderer.render();
  },

  updateActionPointsBar() {
    // I valori del turno sono mostrati nella scheda dell'avventuriero.
  },

  /**
   * Richiede conferma esplicita per qualsiasi azione scelta dal giocatore.
   */
  requestActionConfirmation(action) {
    gameState.pendingAction = action;

    // Rimuovi eventuale bersaglio precedente ed evidenzia il nuovo
    document.querySelectorAll(".cell").forEach((c) => c.classList.remove("pending-target"));
    if (action.targetCell) {
      action.targetCell.classList.add("pending-target");
    }

    document.getElementById("confirm-icon").textContent = action.icon || "❓";
    document.getElementById("confirm-title").textContent = action.title || "Conferma Azione";
    document.getElementById("confirm-desc").innerHTML = action.description;

    document.getElementById("modal-action-confirm").classList.remove("hidden");
  },

  /**
   * Annulla l'azione scelta e ripristina la situazione allo stato precedente.
   */
  cancelPendingAction() {
    const action = gameState.pendingAction;
    gameState.pendingAction = null;

    document.querySelectorAll(".cell").forEach((c) => c.classList.remove("pending-target"));
    document.getElementById("modal-action-confirm").classList.add("hidden");

    this.log("↩️ Azione annullata. Situazione ripristinata allo stato precedente.", "info");

    // Se l'azione annullata era l'upgrade di fine livello, riapri il modale delle scelte
    if (action && action.type === "UPGRADE") {
      document.getElementById("modal-upgrade").classList.remove("hidden");
    }

    BoardRenderer.render();
  },

  /**
   * Esegue l'azione confermata dal giocatore.
   */
  executePendingAction() {
    const action = gameState.pendingAction;
    if (!action) return;

    gameState.pendingAction = null;
    document.querySelectorAll(".cell").forEach((c) => c.classList.remove("pending-target"));
    document.getElementById("modal-action-confirm").classList.add("hidden");

    switch (action.type) {
      case "MOVE":
        this.performMove(action.row, action.col, action.cost, action.targetCoord);
        break;
      case "ATTACK":
        this.performAttack(action.monster, action.coord, action.damage, action.cost);
        break;
      case "END_HERO_TURN":
        this.executeMonsterTurn();
        break;
      case "UPGRADE":
        this.applyLevelEndChoice(action.choice);
        break;
    }
  },

  /**
   * Interazione sulla cella durante il turno dell'Avventuriero:
   * Chiede sempre conferma prima di eseguire movimento o attacco.
   */
  handleCellClick(row, col, monster, reachableMap) {
    const colLabels = ["A", "B", "C", "D", "E"];
    const targetCoord = `${colLabels[col]}${row + 1}`;

    if (gameState.turn.phase !== "ADVENTURER_PHASE") return;

    // 1. AZIONE DI MOVIMENTO
    const cellKey = `${row},${col}`;
    if (reachableMap.has(cellKey) && (row !== gameState.hero.pos.r || col !== gameState.hero.pos.c)) {
      const cost = reachableMap.get(cellKey);
      const cellEl = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);

      this.requestActionConfirmation({
        type: "MOVE",
        icon: "🏃",
        title: "Conferma Movimento",
        description: `Vuoi muovere l'avventuriero nella casella <strong>[${targetCoord}]</strong>?<br>` +
                     `Costo: <strong>${cost} punti movimento</strong> (ne rimarranno: <strong>${gameState.turn.remainingSpeed - cost}</strong>).`,
        row,
        col,
        cost,
        targetCoord,
        targetCell: cellEl
      });
      return;
    }

    // 2. AZIONE DI ATTACCO
    if (monster && monster.hp > 0) {
      this.prepareHeroAttack(monster, targetCoord);
    }
  },

  performMove(row, col, cost, targetCoord) {
    gameState.turn.remainingSpeed -= cost;
    gameState.hero.pos = { r: row, c: col };

    this.log(`🏃 Eroe mosso in [${targetCoord}] (-${cost} pt movimento, Rimanenti: ${gameState.turn.remainingSpeed})`, "info");
    this.updateActionPointsBar();
    BoardRenderer.render();
  },

  prepareHeroAttack(monster, coord) {
    const currentLevel = DUNGEON_LEVELS[gameState.levelIndex];
    const rangeDist = GameEngine.calculateRangeDistance(
      gameState.hero.pos,
      { r: monster.r, c: monster.c },
      currentLevel.grid
    );
    const hasLos = GameEngine.hasLineOfSight(
      gameState.hero.pos,
      { r: monster.r, c: monster.c },
      currentLevel.grid,
      gameState.monsters
    );

    const currentRange = this.getCurrentRange();
    if (rangeDist > currentRange) {
      this.log(`❌ Bersaglio fuori gittata! Distanza: ${rangeDist} pt, la tua gittata: ${currentRange} pt (orto 2, diag 3).`, "warning");
      return;
    }

    if (!hasLos) {
      this.log(`❌ Linea di vista (LOS) bloccata da un muro o da un altro mostro!`, "warning");
      return;
    }

    if (gameState.turn.remainingAttack < monster.defense) {
      this.log(`❌ Punti attacco insufficienti (${gameState.turn.remainingAttack} pt) contro la Difesa del mostro (${monster.defense} pt).`, "warning");
      return;
    }

    // Regola ufficiale: Danno = Math.floor(Attacco / DifesaMostro)
    const damage = Math.min(monster.hp, Math.floor(gameState.turn.remainingAttack / monster.defense));
    const cost = damage * monster.defense;
    const cellEl = document.querySelector(`.cell[data-row="${monster.r}"][data-col="${monster.c}"]`);

    this.requestActionConfirmation({
      type: "ATTACK",
      icon: "⚔️",
      title: "Conferma Attacco",
      description: `Vuoi attaccare <strong>${monster.name}</strong> [${coord}]?<br>` +
                   `Infliggerai: <strong>${damage} danno</strong> (Salute mostro: <strong>${monster.hp - damage}/${monster.hp}</strong>).<br>` +
                   `Punti spesi: <strong>${cost} pt attacco</strong> (Difesa mostro: ${monster.defense}).`,
      monster,
      coord,
      damage,
      cost,
      targetCell: cellEl
    });
  },

  performAttack(monster, coord, damage, cost) {
    gameState.turn.remainingAttack -= cost;
    monster.hp -= damage;

    this.log(`⚔️ Hai colpito ${monster.name} [${coord}] per ${damage} DANNO! (Spesi ${cost} pt attacco, Difesa: ${monster.defense})`, "combat");
    this.updateActionPointsBar();

    if (monster.hp <= 0) {
      this.log(`💀 ${monster.name} è stato abbattuto!`, "success");

      const allDead = gameState.monsters.every((m) => m.hp <= 0);
      if (allDead) {
        BoardRenderer.render();
        setTimeout(() => this.handleLevelVictory(), 600);
        return;
      }
    }

    BoardRenderer.render();
  },

  /**
   * FASE DEI MOSTRI (Movimento IA e Attacco Combinato)
   */
  executeMonsterTurn() {
    gameState.turn.phase = "MONSTER_TURN";
    document.getElementById("current-phase").textContent = "Turno Mostri";
    document.getElementById("action-points-bar").classList.add("hidden");
    document.getElementById("action-hint").classList.add("hidden");

    this.log("--- Inizio Turno dei Mostri ---", "warning");

    const aliveMonsters = gameState.monsters.filter((m) => m.hp > 0);
    const currentLevel = DUNGEON_LEVELS[gameState.levelIndex];

    // Ordina i mostri partendo dal più vicino all'eroe (regola ufficiale pagina 4)
    aliveMonsters.sort((a, b) => {
      const d1 = GameEngine.calculateRangeDistance({ r: a.r, c: a.c }, gameState.hero.pos, currentLevel.grid);
      const d2 = GameEngine.calculateRangeDistance({ r: b.r, c: b.c }, gameState.hero.pos, currentLevel.grid);
      return d1 - d2;
    });

    // 1. MOVIMENTO DI CIASCUN MOSTRO
    aliveMonsters.forEach((m) => {
      this.moveMonsterAI(m, currentLevel);
    });

    BoardRenderer.render();

    // 2. ATTACCO COMBINATO
    setTimeout(() => {
      this.resolveMonsterAttacks(currentLevel);
    }, 500);
  },

  /**
   * IA Movimento Mostro Ufficiale (Pagina 4 del manuale):
   * "Ciascun mostro si muoverà per essere il più vicino possibile alla sua gittata massima
   * dall'avventuriero con Line of Sight. I mostri danno priorità all'essere in gittata e con LOS
   * rispetto all'essere alla gittata massima."
   */
  moveMonsterAI(monster, currentLevel) {
    const reachable = GameEngine.calculateReachableCells(
      { r: monster.r, c: monster.c },
      monster.speed,
      currentLevel.grid,
      gameState.monsters,
      false // Può attraversare altri mostri durante il cammino
    );

    let bestCandidate = null;
    let bestScore = -99999;

    reachable.forEach((cost, key) => {
      const [tr, tc] = key.split(",").map(Number);

      if (currentLevel.grid[tr][tc] === "wall") return;
      if (tr === gameState.hero.pos.r && tc === gameState.hero.pos.c) return;

      // Non può terminare il movimento sulla casella di un altro mostro
      const occupiedByOther = gameState.monsters.some(
        (other) => other.id !== monster.id && other.hp > 0 && other.r === tr && other.c === tc
      );
      if (occupiedByOther) return;

      const targetPos = { r: tr, c: tc };
      const rangeDist = GameEngine.calculateRangeDistance(targetPos, gameState.hero.pos, currentLevel.grid);
      const hasLos = GameEngine.hasLineOfSight(targetPos, gameState.hero.pos, currentLevel.grid, gameState.monsters);

      let score = 0;

      if (hasLos && rangeDist <= monster.range) {
        // Priorità 1: In gittata e con Line of Sight
        // Preferisce la massima gittata consentita dal mostro
        score = 1000 + (rangeDist === monster.range ? 100 : rangeDist * 10);
      } else {
        // Priorità 2: Avvicinarsi il più possibile
        score = -rangeDist * 10;
        if (hasLos) score += 20;
      }

      score -= cost * 0.2;

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = targetPos;
      }
    });

    if (bestCandidate && (bestCandidate.r !== monster.r || bestCandidate.c !== monster.c)) {
      const colLabels = ["A", "B", "C", "D", "E"];
      monster.r = bestCandidate.r;
      monster.c = bestCandidate.c;
      this.log(`👹 ${monster.name} si riposiziona in [${colLabels[monster.c]}${monster.r + 1}]`, "info");
    }
  },

  /**
   * Attacco Mostri Ufficiale (Pagina 5 del manuale):
   * Danno all'avventuriero = Math.floor(Attacco Totale Mostri / Difesa Totale Eroe).
   * Se Attacco Totale < Difesa Totale => Danno = 0.
   */
  resolveMonsterAttacks(currentLevel) {
    const attackers = gameState.monsters.filter((m) => {
      if (m.hp <= 0) return false;
      const rangeDist = GameEngine.calculateRangeDistance({ r: m.r, c: m.c }, gameState.hero.pos, currentLevel.grid);
      const hasLos = GameEngine.hasLineOfSight({ r: m.r, c: m.c }, gameState.hero.pos, currentLevel.grid, gameState.monsters);
      return rangeDist <= m.range && hasLos;
    });

    if (attackers.length === 0) {
      this.log("🛡️ Nessun mostro è in gittata o con visuale libera per attaccarti!", "success");
      this.endMonsterTurn();
      return;
    }

    const totalMonsterAttack = attackers.reduce((sum, m) => sum + m.attack, 0);
    const heroDefense = gameState.turn.currentDefense;

    this.log(`👹 Attaccano ${attackers.length} mostro/i con Attacco Totale: ${totalMonsterAttack}`, "warning");
    this.log(`🛡️ La tua Difesa totale in questo turno: ${heroDefense}`, "info");

    const damage = Math.floor(totalMonsterAttack / heroDefense);
    const attackerNames = attackers.map((monster) => monster.name).join(", ");
    this.showEnemyAttackNotice(
      `${attackerNames} attaccano: ${totalMonsterAttack} Attacco contro ${heroDefense} Difesa. Danno: ${damage}.`
    );

    if (damage <= 0) {
      this.log(`✨ DIFESA PERFETTA! Hai assorbito l'attacco totale (${totalMonsterAttack} atk vs ${heroDefense} dif). 0 Danno subìto!`, "success");
    } else {
      gameState.hero.hp = Math.max(0, gameState.hero.hp - damage);
      this.log(`💥 Subisci ${damage} DANNO! (${totalMonsterAttack} atk ÷ ${heroDefense} dif)`, "combat");
      this.updateStatsUI();

      if (gameState.hero.hp <= 0) {
        this.log("💀 La tua salute è scesa a 0. SEI MORTO NEL DUNGEON!", "combat");
        document.getElementById("go-level").textContent = `${gameState.levelIndex + 1}`;
        setTimeout(() => {
          document.getElementById("enemy-attack-notice").classList.add("hidden");
          document.getElementById("modal-game-over").classList.remove("hidden");
        }, 1400);
        return;
      }
    }

    this.endMonsterTurn();
  },

  endMonsterTurn() {
    setTimeout(() => {
      document.getElementById("enemy-attack-notice").classList.add("hidden");
      this.log("--- Nuovo Turno: Lancia i Dadi Energia ---", "info");
      this.resetTurnToEnergyPhase();
      BoardRenderer.render();
    }, 700);
  },

  showEnemyAttackNotice(detail) {
    document.getElementById("enemy-attack-title").textContent = "Turno dei nemici";
    document.getElementById("enemy-attack-detail").textContent = detail;
    document.getElementById("enemy-attack-notice").classList.remove("hidden");
  },

  handleLevelVictory() {
    if (gameState.levelIndex === 11) {
      // Vittoria finale del 12° livello!
      document.getElementById("modal-victory").classList.remove("hidden");
    } else {
      // Regola ufficiale: Scelta esclusiva tra +1 abilità o Cura Completa (6 HP)
      document.getElementById("modal-upgrade").classList.remove("hidden");
    }
  },

  applyLevelEndChoice(choice) {
    if (choice === "heal_full") {
      gameState.hero.hp = gameState.hero.maxHp;
      this.log("💖 Hai riposato: salute ripristinata al massimo (6 HP)!", "success");
    } else {
      switch (choice) {
        case "speed":
          gameState.hero.speed += 1;
          this.log("✨ Abilità potenziata: +1 Movimento Permanente!", "success");
          break;
        case "attack":
          gameState.hero.attack += 1;
          this.log("✨ Abilità potenziata: +1 Attacco Permanente!", "success");
          break;
        case "defense":
          gameState.hero.defense += 1;
          this.log("✨ Abilità potenziata: +1 Difesa Permanente!", "success");
          break;
        case "range":
          gameState.hero.range += 1;
          this.log(`✨ Abilità potenziata: +1 Gittata Permanente (Ora Gittata: ${gameState.hero.range})!`, "success");
          break;
      }
    }

    document.getElementById("modal-upgrade").classList.add("hidden");
    this.updateStatsUI();
    this.loadLevel(gameState.levelIndex + 1);
  },

  updateStatsUI() {
    document.getElementById("hero-hp-badge").textContent = `HP: ${gameState.hero.hp} / ${gameState.hero.maxHp}`;
    document.getElementById("stat-hp").textContent = gameState.hero.hp;
    document.getElementById("stat-speed").textContent = gameState.hero.speed;
    document.getElementById("stat-attack").textContent = gameState.hero.attack;
    document.getElementById("stat-defense").textContent = gameState.hero.defense;
    this.updateRangeUI();
  },

  getCurrentRange() {
    return gameState.hero.range + gameState.turn.rangeBonus;
  },

  updateRangeUI() {
    const rangeElement = document.getElementById("stat-range");
    if (rangeElement) rangeElement.textContent = this.getCurrentRange();
  },

  async saveGame() {
    if (!window.showDirectoryPicker) {
      this.log("⚠️ Il browser non permette di creare file nella cartella.", "warning");
      return;
    }

    const name = window.prompt("Nome della partita salvata:", "partita");
    if (!name) return;

    try {
      if (!saveDirectoryHandle) saveDirectoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      const saveName = name.trim() || "partita";
      const fileHandle = await saveDirectoryHandle.getFileHandle("partite salvate.json", { create: true });
      let saves = [];
      try {
        const existingFile = await fileHandle.getFile();
        const existing = JSON.parse(await existingFile.text());
        if (Array.isArray(existing.saves)) saves = existing.saves;
      } catch (error) {
        saves = [];
      }
      saves = saves.filter((save) => save.name !== saveName);
      const writable = await fileHandle.createWritable();
      const saveState = JSON.parse(JSON.stringify({ ...gameState, pendingAction: null }));
      saves.push({ name: saveName, savedAt: new Date().toISOString(), gameState: saveState });
      await writable.write(JSON.stringify({ version: 3, saves }, null, 2));
      await writable.close();
      this.log(`💾 Partita "${saveName}" salvata in partite salvate.json.`, "success");
    } catch (error) {
      this.log("⚠️ Salvataggio annullato o cartella non accessibile.", "warning");
    }
  },

  async loadGame() {
    if (!window.showDirectoryPicker) {
      this.log("⚠️ Il browser non permette di leggere i file dalla cartella.", "warning");
      return;
    }

    try {
      saveDirectoryHandle = await window.showDirectoryPicker({ mode: "read" });
      const fileHandle = await saveDirectoryHandle.getFileHandle("partite salvate.json");
      const file = await fileHandle.getFile();
      const saveDocument = JSON.parse(await file.text());
      const saves = Array.isArray(saveDocument.saves) ? saveDocument.saves : [];
      const list = document.getElementById("save-files-list");
      const status = document.getElementById("save-files-status");
      list.innerHTML = "";
      status.textContent = saves.length ? "Scegli una partita salvata." : "Nessuna partita salvata trovata.";
      saves.sort((a, b) => a.name.localeCompare(b.name)).forEach((save) => {
        const button = document.createElement("button");
        button.className = "save-file-button";
        button.textContent = `${save.name} (${new Date(save.savedAt).toLocaleString("it-IT")})`;
        button.addEventListener("click", () => this.loadSavedEntry(save));
        list.appendChild(button);
      });
      document.getElementById("modal-save-files").classList.remove("hidden");
    } catch (error) {
      this.log("📂 Caricamento annullato o cartella non accessibile.", "warning");
    }
  },

  loadSavedEntry(save) {
    try {
      if (!save?.gameState?.hero || !Array.isArray(save.gameState.monsters)) {
        throw new Error("Salvataggio non valido");
      }
      this.restoreGameState(save.gameState);
      document.getElementById("modal-save-files").classList.add("hidden");
      this.log(`📂 Partita "${save.name}" caricata.`, "success");
    } catch (error) {
      this.log("⚠️ File di salvataggio non valido.", "warning");
    }
  },

  restoreGameState(savedState) {
    Object.assign(gameState, savedState);
    gameState.hero = { ...savedState.hero };
    gameState.turn = { ...gameState.turn, ...savedState.turn };
    gameState.pendingAction = null;
    const level = DUNGEON_LEVELS[gameState.levelIndex];
    if (!level) throw new Error("Livello non valido");
    document.getElementById("modal-class-select").classList.add("hidden");
    document.getElementById("modal-game-over").classList.add("hidden");
    document.getElementById("modal-victory").classList.add("hidden");
    document.getElementById("level-title").textContent = `🗺️ ${level.name}`;
    document.getElementById("current-level").textContent = `Livello ${level.level} / 12`;
    document.getElementById("hero-class-badge").textContent = gameState.heroClass;
    document.getElementById("current-phase").textContent = this.getPhaseLabel(gameState.turn.phase);
    this.updateLevelMonsterInspector(level);
    this.updateStatsUI();
    this.syncLoadedTurnUI();
    BoardRenderer.render();
  },

  startFromExistingSituation() {
    const values = {
      hp: Number.parseInt(document.getElementById("situation-hp").value, 10),
      speed: Number.parseInt(document.getElementById("situation-speed").value, 10),
      attack: Number.parseInt(document.getElementById("situation-attack").value, 10),
      defense: Number.parseInt(document.getElementById("situation-defense").value, 10),
      range: Number.parseInt(document.getElementById("situation-range").value, 10),
      level: Number.parseInt(document.getElementById("situation-level").value, 10),
      heroClass: document.getElementById("situation-class").value
    };

    const valid = [values.hp, values.speed, values.attack, values.defense, values.range, values.level].every(Number.isInteger) &&
      ["Warrior", "Paladin", "Barbarian", "Ranger", "Wizard"].includes(values.heroClass) &&
      values.hp >= 1 && values.hp <= 6 &&
      values.speed >= 1 && values.attack >= 1 && values.defense >= 1 && values.range >= 1 &&
      values.level >= 1 && values.level <= DUNGEON_LEVELS.length;

    if (!valid) {
      this.log("⚠️ Inserisci valori validi per riprendere la partita.", "warning");
      return;
    }

    gameState.hero = {
      ...gameState.hero,
      maxHp: 6,
      hp: values.hp,
      speed: values.speed,
      attack: values.attack,
      defense: values.defense,
      range: values.range
    };
    gameState.heroClass = values.heroClass;
    document.getElementById("hero-class-badge").textContent = gameState.heroClass;
    gameState.classAbilityUsedThisLevel = false;
    gameState.savedEnergyDie = null;
    document.getElementById("modal-existing-situation").classList.add("hidden");
    document.getElementById("modal-class-select").classList.add("hidden");
    this.loadLevel(values.level - 1);
    this.log(`📝 Partita ripresa dal Livello ${values.level} con i valori annotati.`, "success");
  },

  getPhaseLabel(phase) {
    return {
      ENERGY: "Fase Energia",
      ASSIGNMENT: "Assegnazione Dadi",
      ADVENTURER_PHASE: "Turno Avventuriero",
      MONSTER_TURN: "Turno Mostri"
    }[phase] || "Fase Energia";
  },

  syncLoadedTurnUI() {
    const phase = gameState.turn.phase;
    const actionBar = document.getElementById("action-points-bar");
    const actionHint = document.getElementById("action-hint");
    const rollButton = document.getElementById("btn-roll-dice");
    const abilityButton = document.getElementById("btn-use-adventurer-ability");
    const helpButton = document.getElementById("btn-toggle-help");

    actionBar.classList.toggle("hidden", phase !== "ADVENTURER_PHASE");
    actionHint.classList.add("hidden");
    rollButton.disabled = phase !== "ENERGY";
    if (phase === "ASSIGNMENT" || phase === "ADVENTURER_PHASE") this.renderDiceAssignments();
    if (phase === "ADVENTURER_PHASE") {
      this.updateActionPointsBar();
      abilityButton.disabled = gameState.heroClass === "Warrior";
      helpButton.disabled = false;
    } else {
      abilityButton.disabled = true;
      helpButton.disabled = true;
    }
  },

  restartGame() {
    document.getElementById("modal-game-over").classList.add("hidden");
    document.getElementById("modal-victory").classList.add("hidden");

    gameState.hero = {
      maxHp: 6,
      hp: 6,
      speed: 1,
      attack: 1,
      defense: 1,
      range: 2,
      pos: { r: 4, c: 0 }
    };

    this.showClassSelectModal();
  },

  log(text, type = "info") {
    const logEl = document.getElementById("game-log");
    if (!logEl) return;

    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    const timeSpan = document.createElement("span");
    timeSpan.className = "log-time";
    timeSpan.textContent = `[${timeStr}]`;

    entry.appendChild(timeSpan);
    entry.appendChild(document.createTextNode(` ${text}`));

    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }
};

/* ==========================================================================
   6. AVVIO
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  AppController.init();
});

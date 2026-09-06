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
    assignedDice: { speed: null, attack: null, defense: null, range: null },
    remainingSpeed: 0,
    remainingAttack: 0,
    currentDefense: 0,
    rangeBonus: 0,
    classAbilityUsedThisTurn: false,
    rangerAbilityActiveThisTurn: false
  },

  // Tracciamento abilità speciali di classe (una volta per livello)
  classAbilityUsedThisLevel: false,
  savedEnergyDie: null,

  // Azione attualmente in attesa di conferma del giocatore
  pendingAction: null,
  pendingAbility: null
};

const HERO_CLASS_ICONS = {
  Warrior: "⚔️",
  Paladin: "✨",
  Barbarian: "🪓",
  Ranger: "🏹",
  Wizard: "🔮"
};

let saveDirectoryHandle = null;
let pendingSaveNameResolver = null;
let selectedSaveSlot = null;

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
          iconSpan.textContent = HERO_CLASS_ICONS[gameState.heroClass] || HERO_CLASS_ICONS.Warrior;
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
    document.getElementById("dungeon-status").textContent = aliveCount;
  },

  animateCells(cells, className, duration = 520) {
    cells.forEach(({ r, c }) => {
      const cell = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
      if (!cell) return;
      cell.classList.remove(className);
      void cell.offsetWidth;
      cell.classList.add(className);
      setTimeout(() => cell.classList.remove(className), duration);
    });
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

    // Il suggerimento di combattimento vive nel tooltip della palette Gittata
    // (su desktop al passaggio del mouse, su mobile al tocco prolungato)
    const rangeBox = document.getElementById("insp-rng").closest(".monster-stat-box");
    if (rangeBox) {
      rangeBox.title =
        `💡 Gittata Mostro: ${m.range} pt (orto 2, diag 3). Per infliggere 1 danno all'avversario servono ${m.defense} pt attacco.`;
    }
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

    // 3. Assegnazione Dadi: trascinamento personalizzato (pointer events,
    //    funziona con mouse, tocco e dentro webview/iframe) + tap-to-assign
    document.querySelectorAll(".energy-die").forEach((die) => {
      die.addEventListener("pointerdown", (event) => this.handleDiePointerDown(event, Number(die.id.replace("die-", ""))));
      die.addEventListener("click", () => {
        if (Date.now() < (this._suppressClickUntil || 0)) return;
        this.selectDieForAssignment(Number(die.id.replace("die-", "")));
      });
    });
    document.querySelectorAll(".stat-assignment-slot").forEach((zone) => {
      // Il tap-to-assign sta sull'intera palette (.stat-box), non solo sullo slot overlay
      const dropTarget = zone.closest(".stat-box") || zone;
      dropTarget.addEventListener("click", (event) => {
        if (Date.now() < (this._suppressClickUntil || 0)) return;
        if (gameState.turn.phase !== "ASSIGNMENT" || zone.classList.contains("hidden")) return;
        if (event.target.closest(".assigned-die")) return;
        if (this.selectedDieIndex === null || this.selectedDieIndex === undefined) return;
        this.assignDieToAbility(this.selectedDieIndex, zone.dataset.ability);
        this.selectedDieIndex = null;
        this.renderDiceAssignments();
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

    document.getElementById("btn-confirm-adventurer-ability").addEventListener("click", () => this.confirmAdventurerAbility());
    document.getElementById("btn-cancel-adventurer-ability").addEventListener("click", () => this.cancelAdventurerAbility());

    // 7. Pulisci Log
    const btnClearLog = document.getElementById("btn-clear-log");
    if (btnClearLog) {
      btnClearLog.addEventListener("click", () => {
        document.getElementById("game-log").innerHTML = "";
      });
    }

    document.getElementById("btn-save-game").addEventListener("click", () => this.saveGame());
    document.getElementById("btn-load-game").addEventListener("click", () => this.loadGame());
    document.getElementById("btn-cancel-save-game").addEventListener("click", () => this.resolveSaveName(null));
    document.getElementById("btn-confirm-save-game").addEventListener("click", () => {
      const name = document.getElementById("save-game-name").value.trim();
      if (name && selectedSaveSlot !== null) this.resolveSaveName({ name, slot: selectedSaveSlot });
    });
    document.getElementById("save-game-name").addEventListener("keydown", (event) => {
      if (event.key === "Enter") document.getElementById("btn-confirm-save-game").click();
      if (event.key === "Escape") this.resolveSaveName(null);
    });
    document.getElementById("btn-new-game").addEventListener("click", () => this.openNewGameModal());
    document.getElementById("btn-cancel-new-game").addEventListener("click", () => this.cancelNewGame());
    document.getElementById("btn-new-game-without-save").addEventListener("click", () => this.startNewGame());
    document.getElementById("btn-save-and-new-game").addEventListener("click", () => this.saveAndStartNewGame());
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
    document.getElementById("btn-load-game-start").addEventListener("click", () => this.loadGame());
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
    gameState.turn.assignedDice = { speed: null, attack: null, defense: null, range: null };
    gameState.turn.remainingSpeed = 0;
    gameState.turn.remainingAttack = 0;
    gameState.turn.currentDefense = 0;
    gameState.turn.rangeBonus = 0;
    gameState.turn.classAbilityUsedThisTurn = false;
    gameState.turn.rangerAbilityActiveThisTurn = false;
    gameState.pendingAbility = null;
    document.getElementById("modal-adventurer-ability").classList.add("hidden");

    document.getElementById("current-phase").textContent = "Fase Energia";
    document.getElementById("btn-roll-dice").disabled = false;
    document.getElementById("action-points-bar").classList.add("hidden");
    document.getElementById("action-hint").classList.add("hidden");
    document.getElementById("btn-end-hero-turn").disabled = true;
    document.getElementById("assign-range").classList.add("hidden");

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
      document.getElementById("action-points-bar").classList.remove("hidden");

      this.renderDiceAssignments();
      this.updateAdventurerAbilityButton();
      document.getElementById("btn-toggle-help").disabled = true;
      document.getElementById("btn-end-hero-turn").disabled = true;
      this.log("Assegna un dado a Movimento, uno ad Attacco e uno a Difesa: trascina il dado oppure tocca il dado e poi la casella.", "info");
    });
  },

  updateAdventurerAbilityButton() {
    const abilityButton = document.getElementById("btn-use-adventurer-ability");
    if (!abilityButton) return;

    const phaseAllowsAbility = ["ASSIGNMENT", "ADVENTURER_PHASE"].includes(gameState.turn.phase);
    const usedForLevel = ["Paladin", "Ranger", "Wizard"].includes(gameState.heroClass) && gameState.classAbilityUsedThisLevel;
    const barbarianUnavailable = gameState.heroClass === "Barbarian" &&
      (gameState.hero.hp !== 1 || gameState.turn.classAbilityUsedThisTurn);
    const rangerUnavailable = gameState.heroClass === "Ranger" && gameState.turn.phase !== "ASSIGNMENT";

    abilityButton.disabled = !phaseAllowsAbility || gameState.heroClass === "Warrior" || usedForLevel || barbarianUnavailable || rangerUnavailable;
  },

  useAdventurerAbility() {
    if (!["ASSIGNMENT", "ADVENTURER_PHASE"].includes(gameState.turn.phase)) return;

    const abilityButton = document.getElementById("btn-use-adventurer-ability");

    if (gameState.heroClass === "Warrior") {
      this.log("⚔️ Il Guerriero standard non ha un'abilità speciale.", "info");
      if (abilityButton) abilityButton.disabled = true;
      return;
    }

    this.openAdventurerAbilityModal();
  },

  openAdventurerAbilityModal() {
    const modal = document.getElementById("modal-adventurer-ability");
    const options = document.getElementById("adventurer-ability-options");
    const confirmButton = document.getElementById("btn-confirm-adventurer-ability");
    const title = document.getElementById("adventurer-ability-title");
    const description = document.getElementById("adventurer-ability-description");
    const icon = document.getElementById("adventurer-ability-icon");
    if (!modal || !options || !confirmButton) return;

    gameState.pendingAbility = { heroClass: gameState.heroClass, selectedDie: null };
    options.innerHTML = "";
    confirmButton.disabled = false;

    if (gameState.heroClass === "Paladin") {
      icon.textContent = "✨";
      title.textContent = "Abilità del Paladino";
      description.textContent = "Scegli un dado Energia da conservare per il prossimo turno. Puoi annullare senza consumare l'abilità.";
      gameState.turn.energyDice.forEach((value, index) => {
        const dieButton = document.createElement("button");
        dieButton.className = "ability-die-choice";
        dieButton.type = "button";
        dieButton.textContent = `Dado ${index + 1}: ${value}`;
        dieButton.addEventListener("click", () => {
          gameState.pendingAbility.selectedDie = index;
          options.querySelectorAll(".ability-die-choice").forEach((button) => button.classList.remove("selected"));
          dieButton.classList.add("selected");
          confirmButton.disabled = false;
        });
        options.appendChild(dieButton);
      });
      confirmButton.disabled = true;
    } else if (gameState.heroClass === "Ranger") {
      icon.textContent = "🏹";
      title.textContent = "Abilità del Ranger";
      description.textContent = "Attiva una zona Gittata aggiuntiva. Dopo la conferma potrai trascinarvi un dado al posto del dado Movimento.";
    } else if (gameState.heroClass === "Barbarian") {
      icon.textContent = "🪓";
      title.textContent = "Abilità del Barbaro";
      description.textContent = "A 1 HP puoi ritirare tutti i dadi Energia una volta per turno. Il ritiro sostituirà i dadi attuali.";
    } else if (gameState.heroClass === "Wizard") {
      icon.textContent = "🔮";
      title.textContent = "Abilità del Mago";
      description.textContent = "Puoi ritirare tutti e tre i dadi Energia una volta per livello. Il ritiro sostituirà i dadi attuali.";
    }

    modal.classList.remove("hidden");
  },

  cancelAdventurerAbility() {
    gameState.pendingAbility = null;
    document.getElementById("modal-adventurer-ability").classList.add("hidden");
  },

  confirmAdventurerAbility() {
    const pendingAbility = gameState.pendingAbility;
    if (!pendingAbility) return;

    const heroClass = pendingAbility.heroClass;
    if (heroClass === "Paladin") {
      if (pendingAbility.selectedDie === null) return;
      gameState.savedEnergyDie = gameState.turn.energyDice[pendingAbility.selectedDie];
      gameState.classAbilityUsedThisLevel = true;
      this.log(`✨ Il Paladino conserva il dado Energia ${gameState.savedEnergyDie} per il prossimo turno.`, "success");
    } else if (heroClass === "Ranger") {
      gameState.turn.rangerAbilityActiveThisTurn = true;
      gameState.classAbilityUsedThisLevel = true;
      document.getElementById("assign-range").classList.remove("hidden");
      this.log("🏹 Trascina un dado nella nuova zona Gittata: sostituirà il dado Movimento.", "success");
    } else if (heroClass === "Barbarian") {
      gameState.turn.classAbilityUsedThisTurn = true;
      this.cancelAdventurerAbility();
      this.rerollFromAbility("Barbaro", false);
      return;
    } else if (heroClass === "Wizard") {
      gameState.classAbilityUsedThisLevel = true;
      this.cancelAdventurerAbility();
      this.rerollFromAbility("Mago", true);
      return;
    }

    this.cancelAdventurerAbility();
    this.updateAdventurerAbilityButton();
    this.renderDiceAssignments();
  },

  rerollFromAbility(className, oncePerLevel) {
    gameState.turn.phase = "ASSIGNMENT";
    gameState.turn.assignedDice = { speed: null, attack: null, defense: null, range: null };
    document.getElementById("current-phase").textContent = "Assegnazione Dadi";
    document.getElementById("action-points-bar").classList.add("hidden");
    document.getElementById("action-hint").classList.add("hidden");
    document.getElementById("btn-end-hero-turn").disabled = true;
    document.getElementById("btn-roll-dice").disabled = true;
    DiceEngine.rollEnergyDice((results) => {
      this.renderDiceAssignments();
      this.updateAdventurerAbilityButton();
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

  /* --- Trascinamento personalizzato (Pointer Events) --- */
  handleDiePointerDown(event, index) {
    if (gameState.turn.phase !== "ASSIGNMENT") return;
    if (event.button !== undefined && event.button !== 0) return;
    this.pointerDrag = { index, startX: event.clientX, startY: event.clientY, moved: false, ghost: null };
    this._boundDragMove = (e) => this.handleDiePointerMove(e);
    this._boundDragEnd = (e) => this.handleDiePointerUp(e);
    window.addEventListener("pointermove", this._boundDragMove);
    window.addEventListener("pointerup", this._boundDragEnd);
    window.addEventListener("pointercancel", this._boundDragEnd);
  },

  handleDiePointerMove(event) {
    const drag = this.pointerDrag;
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
      drag.moved = true;
      const ghost = document.createElement("div");
      ghost.className = "die energy-die die-ghost";
      ghost.textContent = gameState.turn.energyDice[drag.index];
      document.body.appendChild(ghost);
      drag.ghost = ghost;
    }
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const zone = el ? el.closest(".stat-assignment-slot") : null;
    document.querySelectorAll(".stat-assignment-slot.drag-over").forEach((z) => z.classList.remove("drag-over"));
    if (zone && !zone.classList.contains("hidden")) zone.classList.add("drag-over");
  },

  handleDiePointerUp(event) {
    const drag = this.pointerDrag;
    if (!drag) return;
    window.removeEventListener("pointermove", this._boundDragMove);
    window.removeEventListener("pointerup", this._boundDragEnd);
    window.removeEventListener("pointercancel", this._boundDragEnd);
    this.pointerDrag = null;
    document.querySelectorAll(".stat-assignment-slot.drag-over").forEach((z) => z.classList.remove("drag-over"));
    if (!drag.moved) return; // semplice tocco: lo gestisce il click (tap-to-assign)
    // Dopo un trascinamento sopprimi per 350ms qualunque click residuo
    // (potrebbe arrivare su un elemento diverso da quello di partenza)
    this._suppressClickUntil = Date.now() + 350;
    if (drag.ghost) drag.ghost.remove();
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const zone = el ? el.closest(".stat-assignment-slot") : null;
    if (zone && !zone.classList.contains("hidden")) {
      this.assignDieToAbility(drag.index, zone.dataset.ability);
      this.selectedDieIndex = null;
    }
  },

  selectDieForAssignment(index) {
    if (gameState.turn.phase !== "ASSIGNMENT") return;
    this.selectedDieIndex = this.selectedDieIndex === index ? null : index;
    this.renderDiceAssignments();
  },

  assignDieToAbility(index, ability) {
    const validAbility = ["speed", "attack", "defense"].includes(ability) ||
      (ability === "range" && gameState.heroClass === "Ranger" && gameState.turn.rangerAbilityActiveThisTurn);
    if (gameState.turn.phase !== "ASSIGNMENT" || !Number.isInteger(index) || !validAbility) return;

    Object.keys(gameState.turn.assignedDice).forEach((key) => {
      if (gameState.turn.assignedDice[key] === index) gameState.turn.assignedDice[key] = null;
    });
    gameState.turn.assignedDice[ability] = index;
    if (gameState.turn.rangerAbilityActiveThisTurn) {
      const rangeIndex = gameState.turn.assignedDice.range;
      gameState.turn.rangeBonus = rangeIndex === null ? 0 : gameState.turn.energyDice[rangeIndex];
      this.updateRangeUI();
    }
    this.renderDiceAssignments();
  },

  clearDiceAssignment() {
    if (gameState.turn.phase !== "ASSIGNMENT") return;
    gameState.turn.assignedDice = { speed: null, attack: null, defense: null, range: null };
    gameState.turn.rangeBonus = 0;
    this.updateRangeUI();
    this.renderDiceAssignments();
  },

  renderDiceAssignments() {
    const abilityIds = { speed: "assign-speed", attack: "assign-attack", defense: "assign-defense", range: "assign-range" };
    const assigned = gameState.turn.assignedDice;

    // Evidenzia le palette come zone di arrivo attive durante la fase di assegnazione
    document.body.classList.toggle("dice-assignment-active", gameState.turn.phase === "ASSIGNMENT");
    if (gameState.turn.phase !== "ASSIGNMENT") this.selectedDieIndex = null;

    Object.entries(abilityIds).forEach(([ability, id]) => {
      const zone = document.getElementById(id);
      if (!zone) return;
      zone.innerHTML = "";
      const index = assigned[ability];
      if (index === null || gameState.turn.energyDice[index] === null) return;
      const die = document.createElement("div");
      die.className = "assigned-die";
      die.draggable = false;
      die.dataset.index = index;
      die.textContent = `+${gameState.turn.energyDice[index]}`;
      if (index === this.selectedDieIndex) die.classList.add("selected");
      die.addEventListener("pointerdown", (event) => this.handleDiePointerDown(event, index));
      die.addEventListener("click", (event) => {
        event.stopPropagation();
        if (Date.now() < (this._suppressClickUntil || 0)) return;
        this.selectDieForAssignment(index);
      });
      zone.appendChild(die);
    });

    document.querySelectorAll(".energy-die").forEach((die) => {
      const index = Number(die.id.replace("die-", ""));
      const used = Object.values(assigned).includes(index);
      die.classList.toggle("used", used);
      die.classList.toggle("selected", index === this.selectedDieIndex);
      die.draggable = false;
    });
    this.updateAssignmentTotals();
  },

  updateAssignmentTotals() {
    const { speed: sIdx, attack: aIdx, defense: dIdx, range: rIdx } = gameState.turn.assignedDice;

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

    const requiredDice = gameState.turn.rangerAbilityActiveThisTurn ? [rIdx, aIdx, dIdx] : [sIdx, aIdx, dIdx];
    const allAssigned = requiredDice.every((index) => index !== null);
    document.getElementById("btn-confirm-turn").disabled = gameState.turn.phase !== "ASSIGNMENT" || !allAssigned;
    const clearButton = document.getElementById("btn-clear-assignment");
    if (clearButton) {
      clearButton.disabled = gameState.turn.phase !== "ASSIGNMENT" || !Object.values(gameState.turn.assignedDice).some((index) => index !== null);
    }
  },

  handleConfirmTurn() {
    const { speed, attack, defense } = gameState.turn.assignedDice;

    gameState.turn.remainingSpeed = gameState.hero.speed + (speed === null ? 0 : gameState.turn.energyDice[speed]);
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
    document.getElementById("btn-end-hero-turn").disabled = false;
    this.updateAdventurerAbilityButton();

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
    BoardRenderer.animateCells([{ r: row, c: col }], "hero-moving");
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
        BoardRenderer.animateCells([{ r: monster.r, c: monster.c }], "hero-attack-impact");
        setTimeout(() => this.handleLevelVictory(), 600);
        return;
      }
    }

    BoardRenderer.render();
    BoardRenderer.animateCells([{ r: monster.r, c: monster.c }], "hero-attack-impact");
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
    const movedMonsterIds = [];
    aliveMonsters.forEach((m) => {
      if (this.moveMonsterAI(m, currentLevel)) movedMonsterIds.push(m.id);
    });

    BoardRenderer.render();
    BoardRenderer.animateCells(
      aliveMonsters.filter((m) => movedMonsterIds.includes(m.id)).map((m) => ({ r: m.r, c: m.c })),
      "monster-moving"
    );

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
      return true;
    }

    return false;
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
    BoardRenderer.animateCells(
      [{ r: gameState.hero.pos.r, c: gameState.hero.pos.c }, ...attackers.map((m) => ({ r: m.r, c: m.c }))],
      "monster-attack-impact"
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
    const details = await this.requestSaveName();
    if (!details) return false;

    const saves = this.getSaveSlots();
    saves[details.slot] = {
      name: details.name,
      savedAt: new Date().toISOString(),
      gameState: JSON.parse(JSON.stringify({ ...gameState, pendingAction: null }))
    };
    localStorage.setItem("one-card-dungeon-save-slots", JSON.stringify(saves));
    this.log(`💾 Partita "${details.name}" salvata nello slot ${details.slot + 1}.`, "success");
    return true;
  },

  getSaveSlots() {
    try {
      const saves = JSON.parse(localStorage.getItem("one-card-dungeon-save-slots") || "[]");
      return Array.from({ length: 5 }, (_, index) => saves[index] || null);
    } catch (error) {
      return Array(5).fill(null);
    }
  },

  renderSaveSlots(containerId, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    this.getSaveSlots().forEach((save, index) => {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "save-slot";
      slot.innerHTML = `<span class="save-slot-number">Slot ${index + 1}</span>` +
        `<span class="save-slot-name">${save ? save.name : "Vuoto"}</span>` +
        `<span class="save-slot-meta">${save ? new Date(save.savedAt).toLocaleString("it-IT") : "Nessuna partita"}</span>`;

      if (mode === "save") {
        slot.classList.toggle("selected", selectedSaveSlot === index);
        slot.addEventListener("click", () => {
          selectedSaveSlot = index;
          document.getElementById("btn-confirm-save-game").disabled = !document.getElementById("save-game-name").value.trim();
          this.renderSaveSlots(containerId, mode);
        });
      } else if (save) {
        slot.addEventListener("click", () => this.loadSavedEntry(save));
      } else {
        slot.disabled = true;
      }
      container.appendChild(slot);
    });
  },

  requestSaveName() {
    const modal = document.getElementById("modal-save-game");
    const input = document.getElementById("save-game-name");
    selectedSaveSlot = null;
    this.renderSaveSlots("save-slot-grid", "save");
    document.getElementById("btn-confirm-save-game").disabled = true;
    modal.classList.remove("hidden");
    input.value = "";
    input.focus();
    return new Promise((resolve) => {
      pendingSaveNameResolver = resolve;
    });
  },

  resolveSaveName(name) {
    if (!pendingSaveNameResolver) return;
    const resolve = pendingSaveNameResolver;
    pendingSaveNameResolver = null;
    document.getElementById("modal-save-game").classList.add("hidden");
    resolve(name);
  },

  openNewGameModal() {
    document.getElementById("modal-new-game").classList.remove("hidden");
  },

  cancelNewGame() {
    document.getElementById("modal-new-game").classList.add("hidden");
  },

  startNewGame() {
    this.cancelNewGame();
    this.restartGame();
  },

  async saveAndStartNewGame() {
    const saved = await this.saveGame();
    if (saved) this.startNewGame();
  },

  async loadGame() {
    const saves = this.getSaveSlots();
    const count = saves.filter(Boolean).length;
    document.getElementById("save-files-status").textContent = count
      ? `${count} slot occupat${count === 1 ? "o" : "i"}. Scegli una partita.`
      : "Nessuna partita salvata negli slot.";
    this.renderSaveSlots("load-slot-grid", "load");
    document.getElementById("modal-save-files").classList.remove("hidden");
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
    if (!gameState.monsters.length && level.monsters.length) {
      gameState.monsters = level.monsters.map((monster) => ({ ...monster, maxHp: monster.hp }));
    }
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
    const helpButton = document.getElementById("btn-toggle-help");

    actionBar.classList.toggle("hidden", !["ASSIGNMENT", "ADVENTURER_PHASE"].includes(phase));
    actionHint.classList.add("hidden");
    rollButton.disabled = phase !== "ENERGY";
    document.getElementById("btn-end-hero-turn").disabled = phase !== "ADVENTURER_PHASE";
    document.getElementById("assign-range").classList.toggle("hidden", !gameState.turn.rangerAbilityActiveThisTurn);
    if (phase === "ASSIGNMENT" || phase === "ADVENTURER_PHASE") this.renderDiceAssignments();
    if (phase === "ADVENTURER_PHASE") {
      this.updateActionPointsBar();
      helpButton.disabled = false;
    } else {
      helpButton.disabled = true;
    }
    this.updateAdventurerAbilityButton();
  },

  restartGame() {
    document.getElementById("modal-new-game").classList.add("hidden");
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

    gameState.heroClass = "Warrior";
    gameState.classAbilityUsedThisLevel = false;
    gameState.savedEnergyDie = null;
    gameState.pendingAction = null;
    gameState.pendingAbility = null;

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

// Su schermi piccoli accorcia i testi dei pulsanti per risparmiare spazio
function applyCompactButtonLabels() {
  const compact = window.matchMedia("(max-width: 768px)").matches;
  const endTurnBtn = document.getElementById("btn-end-hero-turn");
  if (endTurnBtn) endTurnBtn.textContent = compact ? "Fine ⏩" : "Fine Turno Eroe ⏩";
  const abilityBtn = document.getElementById("btn-use-adventurer-ability");
  if (abilityBtn) abilityBtn.textContent = compact ? "✨ Abilità" : "Usa abilità Avventuriero";
}

window.addEventListener("resize", applyCompactButtonLabels);

document.addEventListener("DOMContentLoaded", () => {
  applyCompactButtonLabels();
  AppController.init();
});

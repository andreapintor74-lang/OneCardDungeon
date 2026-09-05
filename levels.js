/**
 * ============================================================================
 * ONE CARD DUNGEON - DATABASE DEI 12 LIVELLI (Little Rocket Games Ufficiale)
 * ============================================================================
 * Il gioco fisico utilizza 1 sola carta fronte/retro con 4 orientamenti (rotazioni):
 *  - Posizione 1 (Fronte 0°):   Livelli 1, 5, 9   => Mostro: RAGNO (Spider)
 *  - Posizione 2 (Fronte 180°): Livelli 2, 6, 10  => Mostro: SCHELETRO ARCIERE (Skeleton)
 *  - Posizione 3 (Retro 0°):    Livelli 3, 7, 11  => Mostro: ORCO / TROLL (Orc)
 *  - Posizione 4 (Retro 180°):  Livelli 4, 8, 12  => Mostro: DEMONE M'GUF-YN (Fiend)
 *
 * Griglia: 5x5 (25 caselle).
 * Simboli: "empty" (pavimento), "wall" (muro in pietra), "stairs" (scale).
 */

"use strict";

// --- STATISTICHE DEI 4 MOSTRI UFFICIALI (dalla carta di gioco) ---
const OFFICIAL_MONSTERS = {
  SPIDER: {
    name: "Ragno Gigante",
    icon: "🕷️",
    hp: 2,
    speed: 5,
    attack: 4,
    defense: 4,
    range: 3
  },
  SKELETON: {
    name: "Scheletro Arciere",
    icon: "💀",
    hp: 3,
    speed: 4,
    attack: 5,
    defense: 4,
    range: 4
  },
  ORC: {
    name: "Orco Guerriero",
    icon: "👹",
    hp: 5,
    speed: 3,
    attack: 7,
    defense: 7,
    range: 2
  },
  DEMON: {
    name: "Demone Custode",
    icon: "👿",
    hp: 5,
    speed: 5,
    attack: 5,
    defense: 5,
    range: 5
  }
};

// --- LE 4 CONFIGURAZIONI FISICHE DELLA CARTA (5x5) ---

// Configurazione A: Fronte 0° (Muri a (1,3), (3,1), (3,3); Scale a (4,0) e (0,4))
const GRID_FRONT_0 = [
  ["empty", "empty", "empty", "empty", "stairs"],
  ["empty", "empty", "empty", "wall",  "empty"],
  ["empty", "empty", "empty", "empty", "empty"],
  ["empty", "wall",  "empty", "wall",  "empty"],
  ["stairs","empty", "empty", "empty", "empty"]
];

// Configurazione B: Fronte Ruotato 180° (Muri a (1,1), (1,3), (3,1); Scale a (0,4) e (4,0))
const GRID_FRONT_180 = [
  ["empty", "empty", "empty", "empty", "stairs"],
  ["empty", "wall",  "empty", "wall",  "empty"],
  ["empty", "empty", "empty", "empty", "empty"],
  ["empty", "wall",  "empty", "empty", "empty"],
  ["stairs","empty", "empty", "empty", "empty"]
];

// Configurazione C: Retro 0° (Muri a (2,0), (2,3), (3,3); Scale a (0,0) e (4,4))
const GRID_BACK_0 = [
  ["stairs","empty", "empty", "empty", "empty"],
  ["empty", "empty", "empty", "empty", "empty"],
  ["wall",  "empty", "empty", "wall",  "empty"],
  ["empty", "empty", "empty", "wall",  "empty"],
  ["empty", "empty", "empty", "empty", "stairs"]
];

// Configurazione D: Retro Ruotato 180° (Muri a (1,1), (2,1), (2,4); Scale a (4,4) e (0,0))
const GRID_BACK_180 = [
  ["stairs","empty", "empty", "empty", "empty"],
  ["empty", "wall",  "empty", "empty", "empty"],
  ["empty", "wall",  "empty", "empty", "wall"],
  ["empty", "empty", "empty", "empty", "empty"],
  ["empty", "empty", "empty", "empty", "stairs"]
];

// --- I 12 LIVELLI PROGRESSIVI DEL GIOCO ---
const DUNGEON_LEVELS = [
  // --------------------------------------------------------------------------
  // LIVELLO 1 (Posizione 1: Fronte 0°)
  // --------------------------------------------------------------------------
  {
    level: 1,
    position: "Fronte (0°)",
    name: "Livello 1: Nido di Ragni",
    description: "Inizi sulle scale inferiori. 2 Ragni sono appostati sulle caselle contrassegnate dall'1.",
    heroStart: { r: 4, c: 0 },
    grid: GRID_FRONT_0,
    monsters: [
      { id: "m1_1", ...OFFICIAL_MONSTERS.SPIDER, r: 0, c: 3 },
      { id: "m1_2", ...OFFICIAL_MONSTERS.SPIDER, r: 2, c: 4 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 2 (Carta retro, rotazione 0°)
  // --------------------------------------------------------------------------
  {
    level: 2,
    position: "Retro (0°)",
    name: "Livello 2: La Cripta degli Scheletri",
    description: "Ruota la carta. Due scheletri arcieri incordano i loro archi sulle caselle 2.",
    heroStart: { r: 4, c: 4 },
    grid: GRID_BACK_0,
    monsters: [
      { id: "m2_1", ...OFFICIAL_MONSTERS.SKELETON, r: 0, c: 2 },
      { id: "m2_2", ...OFFICIAL_MONSTERS.SKELETON, r: 1, c: 0 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 3 (Carta fronte, rotazione 180°)
  // --------------------------------------------------------------------------
  {
    level: 3,
    position: "Fronte (Ruotato 180°)",
    name: "Livello 3: Accampamento degli Orchi",
    description: "Gira la carta sul retro. Un possente orco pattuglia la sala.",
    heroStart: { r: 4, c: 0 },
    grid: GRID_FRONT_180,
    monsters: [
      { id: "m3_1", ...OFFICIAL_MONSTERS.ORC, r: 1, c: 4 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 4 (Carta retro, rotazione 180°)
  // --------------------------------------------------------------------------
  {
    level: 4,
    position: "Retro (Ruotato 180°)",
    name: "Livello 4: La Fossa dei Demoni",
    description: "Ruota il retro di 180°. Un demone alato emerge dall'abisso sulla casella 4.",
    heroStart: { r: 4, c: 4 },
    grid: GRID_BACK_180,
    monsters: [
      { id: "m4_1", ...OFFICIAL_MONSTERS.DEMON, r: 0, c: 1 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 5 (Posizione 1: Fronte 0°)
  // --------------------------------------------------------------------------
  {
    level: 5,
    position: "Fronte (0°)",
    name: "Livello 5: L'Invasione degli Aracnidi",
    description: "Ritorno sul fronte. Tre ragni famelici occupano le caselle contrassegnate dal 5.",
    heroStart: { r: 4, c: 0 },
    grid: GRID_FRONT_0,
    monsters: [
      { id: "m5_1", ...OFFICIAL_MONSTERS.SPIDER, r: 0, c: 1 },
      { id: "m5_2", ...OFFICIAL_MONSTERS.SPIDER, r: 1, c: 4 },
      { id: "m5_3", ...OFFICIAL_MONSTERS.SPIDER, r: 4, c: 4 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 6 (Carta retro, rotazione 0°)
  // --------------------------------------------------------------------------
  {
    level: 6,
    position: "Retro (0°)",
    name: "Livello 6: Battaglione di Ossa",
    description: "Tre scheletri arcieri ti bersagliano da ogni direzione dalle caselle 6.",
    heroStart: { r: 4, c: 4 },
    grid: GRID_BACK_0,
    monsters: [
      { id: "m6_1", ...OFFICIAL_MONSTERS.SKELETON, r: 0, c: 1 },
      { id: "m6_2", ...OFFICIAL_MONSTERS.SKELETON, r: 1, c: 1 },
      { id: "m6_3", ...OFFICIAL_MONSTERS.SKELETON, r: 4, c: 0 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 7 (Carta fronte, rotazione 180°)
  // --------------------------------------------------------------------------
  {
    level: 7,
    position: "Fronte (Ruotato 180°)",
    name: "Livello 7: Falange degli Orchi",
    description: "Due orchi corazzati presidiano le caselle contrassegnate dal 7.",
    heroStart: { r: 4, c: 0 },
    grid: GRID_FRONT_180,
    monsters: [
      { id: "m7_1", ...OFFICIAL_MONSTERS.ORC, r: 3, c: 4 },
      { id: "m7_2", ...OFFICIAL_MONSTERS.ORC, r: 1, c: 2 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 8 (Carta retro, rotazione 180°)
  // --------------------------------------------------------------------------
  {
    level: 8,
    position: "Retro (Ruotato 180°)",
    name: "Livello 8: Tregenda Demoniaca",
    description: "Due demoni feroci presidiano i corridoi del piano sulle caselle 8.",
    heroStart: { r: 4, c: 4 },
    grid: GRID_BACK_180,
    monsters: [
      { id: "m8_1", ...OFFICIAL_MONSTERS.DEMON, r: 0, c: 3 },
      { id: "m8_2", ...OFFICIAL_MONSTERS.DEMON, r: 4, c: 1 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 9 (Posizione 1: Fronte 0°)
  // --------------------------------------------------------------------------
  {
    level: 9,
    position: "Fronte (0°)",
    name: "Livello 9: Il Cuore del Nido",
    description: "Tre ragni giganti velenosi difendono le caselle 9.",
    heroStart: { r: 4, c: 0 },
    grid: GRID_FRONT_0,
    monsters: [
      { id: "m9_1", ...OFFICIAL_MONSTERS.SPIDER, r: 0, c: 0 },
      { id: "m9_2", ...OFFICIAL_MONSTERS.SPIDER, r: 2, c: 2 },
      { id: "m9_3", ...OFFICIAL_MONSTERS.SPIDER, r: 3, c: 4 },
      { id: "m9_4", ...OFFICIAL_MONSTERS.SPIDER, r: 4, c: 2 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 10 (Carta retro, rotazione 0°)
  // --------------------------------------------------------------------------
  {
    level: 10,
    position: "Retro (0°)",
    name: "Livello 10: La Legione Spettrale",
    description: "Quattro scheletri campioni dalle frecce mortali occupano le caselle 10.",
    heroStart: { r: 4, c: 4 },
    grid: GRID_BACK_0,
    monsters: [
      { id: "m10_1", ...OFFICIAL_MONSTERS.SKELETON, r: 0, c: 4 },
      { id: "m10_2", ...OFFICIAL_MONSTERS.SKELETON, r: 1, c: 2 },
      { id: "m10_3", ...OFFICIAL_MONSTERS.SKELETON, r: 2, c: 1 },
      { id: "m10_4", ...OFFICIAL_MONSTERS.SKELETON, r: 3, c: 0 },
      { id: "m10_5", ...OFFICIAL_MONSTERS.SKELETON, r: 4, c: 2 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 11 (Carta fronte, rotazione 180°)
  // --------------------------------------------------------------------------
  {
    level: 11,
    position: "Fronte (Ruotato 180°)",
    name: "Livello 11: I Signori della Guerra",
    description: "Due orchi d'élite presidiano l'accesso finale sulle caselle 11.",
    heroStart: { r: 4, c: 0 },
    grid: GRID_FRONT_180,
    monsters: [
      { id: "m11_1", ...OFFICIAL_MONSTERS.ORC, r: 1, c: 4 },
      { id: "m11_2", ...OFFICIAL_MONSTERS.ORC, r: 0, c: 3 },
      { id: "m11_3", ...OFFICIAL_MONSTERS.ORC, r: 0, c: 1 }
    ]
  },

  // --------------------------------------------------------------------------
  // LIVELLO 12 (Carta retro, rotazione 180°) - BATTAGLIA FINALE
  // --------------------------------------------------------------------------
  {
    level: 12,
    position: "Retro (Ruotato 180°)",
    name: "Livello 12: Il Santuario dello Scettro di M'Guf-yn",
    description: "L'ultimo livello! Tre potenti diavolacci fanno la guardia allo Scettro di M'Guf-yn sulle caselle 12.",
    heroStart: { r: 4, c: 4 },
    grid: GRID_BACK_180,
    monsters: [
      { id: "m12_1", ...OFFICIAL_MONSTERS.DEMON, name: "Diavolaccio di M'Guf-yn", r: 3, c: 0 },
      { id: "m12_2", ...OFFICIAL_MONSTERS.DEMON, name: "Diavolaccio di M'Guf-yn", r: 1, c: 2 },
      { id: "m12_3", ...OFFICIAL_MONSTERS.DEMON, name: "Diavolaccio di M'Guf-yn", r: 1, c: 0 }
    ]
  }
];

/**
 * PolkUp — Experiencia Digital  v3.0
 * Arquitectura:
 *   #tower-scene → preserve-3d, recibe rotateY del drag + translateY de la cámara
 *   .node-wrap   → posición 3D fija por CSS (rotateY/translateZ/translateY/rotateZ)
 *   .node        → elemento visual; GSAP solo anima scale/x/y
 *   .node-dot    → único hitbox clickeable (el puntito blanco del centro)
 *   #rope-svg    → overlay 2D fijo; coords via getBoundingClientRect()
 */
'use strict';

/* ============================================================
   A. CONSTANTES
   ============================================================ */

// Tamaños visuales por nivel — se aumentan un ~15% para compensar el
// foreshortening moderado con perspective:900px
const NODE_SIZES     = [76, 70, 64, 58, 53, 48, 43, 38, 32, 26];
const CAM_DUR        = 0.95;
const ROULETTE_DELAY      = 1400; // ms antes de mostrar la ruleta (normal)
const ROULETTE_DELAY_SLOW = 5000; // ms cuando se activa SLOW_DOWN

const COLORS    = ['red', 'blue', 'yellow', 'green'];
const COLOR_ES  = { red: 'Rojo', blue: 'Azul', yellow: 'Amarillo', green: 'Verde' };
const COLOR_HEX = { red: '#E8231A', blue: '#364a9a', yellow: '#ecc316', green: '#36a936' };

// 8 puntos del anillo de ruleta (R B Y G × 2)
const RING_DOT_COLORS = ['red','blue','yellow','green','red','blue','yellow','green'];

// Separación vertical entre niveles.
// Con top:52% en una pantalla de ~900px:
//   nivel activo  → 52% ≈ 468px
//   AL+1          → 52% − 17.8% ≈ 34%  (308px)  — bien visible
//   AL+2          → 52% − 35.6% ≈ 16%  (148px)  — preview claro sin distorsión
//   AL+3          → fuera de pantalla arriba (opacity:0 de todas formas)
const LEVEL_GAP  = 160;

// Niveles: y se calcula como i * LEVEL_GAP
const LEVEL_DEFS = [
  { level: 0, radius: 420, count: 8  },
  { level: 1, radius: 365, count: 7  },
  { level: 2, radius: 310, count: 7  },
  { level: 3, radius: 262, count: 6  },
  { level: 4, radius: 215, count: 6  },
  { level: 5, radius: 168, count: 5  },
  { level: 6, radius: 128, count: 5  },
  { level: 7, radius:  88, count: 4  },
  { level: 8, radius:  52, count: 4  },
  { level: 9, radius:   0, count: 1  }, // CIMA — único círculo negro sólido
].map((d, i) => ({ ...d, y: i * LEVEL_GAP }));


/* ============================================================
   A2. GENERACIÓN DE NODOS
   ============================================================ */

/**
 * Garantiza al menos 1 nodo de cada color por nivel (hasta min(count,4) colores distintos).
 * Los slots restantes se rellenan aleatoriamente y se baraja el resultado.
 */
function buildLevelColors(count) {
  const nDistinct = Math.min(count, 4);
  const shuffled  = [...COLORS].sort(() => Math.random() - 0.5);
  const base      = shuffled.slice(0, nDistinct);
  for (let i = nDistinct; i < count; i++) base.push(COLORS[Math.floor(Math.random() * 4)]);
  // Fisher-Yates
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base;
}

/**
 * Construye todos los nodos de la torre.
 * Reglas:
 *   - Cada nivel (1-8) tiene al menos 1 nodo de condición (borde negro).
 *   - Cada nivel tiene al menos un nodo de cada color disponible.
 *   - La Meta (nivel 9) es un único círculo negro, sin condición.
 */
function buildTowerNodes() {
  const nodes = [];
  let id = 0;

  LEVEL_DEFS.forEach(({ level, y, radius, count }) => {
    const isCimaLevel = (level === LEVEL_DEFS.length - 1);
    const angleOffset = (level % 2 === 0) ? 0 : (180 / count);
    const levelColors = isCimaLevel ? [] : buildLevelColors(count);

    // Índices de condición: al menos 1 por nivel (excepto nivel 0 y cima)
    const condIndices = [];
    if (level > 0 && !isCimaLevel) {
      const numConds = count >= 6 ? 2 : 1;
      while (condIndices.length < numConds) {
        const idx = Math.floor(Math.random() * count);
        if (!condIndices.includes(idx)) condIndices.push(idx);
      }
    }

    for (let i = 0; i < count; i++) {
      const angleDeg = isCimaLevel ? 0 : angleOffset + (360 / count) * i;
      const isCima   = isCimaLevel;

      nodes.push({
        id,
        level,
        angleDeg,
        y,
        _levelRadius: radius,
        color:        isCima ? 'cima' : levelColors[i],
        isCondition:  condIndices.includes(i),
        isCima,
        el:   null,
        wrap: null,
        dot:  null,      // hitbox: el puntito blanco
        _jitterRz: 0,
      });
      id++;
    }
  });

  return nodes;
}


/* ============================================================
   B. CONDICIONES  (80% castigo / 20% recompensa)
   ============================================================ */

const CONDITIONS = [
  {
    icon: '↩', title: '¡La vara se cayó!',
    text: 'El anclaje falló. Retrocedes un espacio.',
    hint: 'Retrocedes 1', action: 'STEP_BACK_1', weight: 30,
  },
  {
    icon: '🌪️', title: '¡Tormenta de viento!',
    text: 'Pierdes el control y caes hasta la base de la torre.',
    hint: 'Vuelves al inicio', action: 'GO_TO_START', weight: 10,
  },
  {
    icon: '⏳', title: '¡Fricción en la cuerda!',
    text: 'La cuerda se atascó. Tendrás que esperar el doble antes del próximo intento.',
    hint: 'Esperas el doble', action: 'SLOW_DOWN', weight: 15,
  },
  {
    icon: '🎯', title: '¡Ancla perfecta!',
    text: 'Anclaje preciso. Avanzas un nivel de bonus.',
    hint: 'Avanzas +1', action: 'ADVANCE_1', weight: 30,
  },
  {
    icon: '⚡', title: '¡Súper impulso!',
    text: 'La torre te catapulta dos niveles hacia arriba.',
    hint: 'Avanzas +2', action: 'ADVANCE_2', weight: 15,
  },
];

const randCondition = () => {
  const total = CONDITIONS.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const cond of CONDITIONS) { if (r < cond.weight) return cond; r -= cond.weight; }
  return CONDITIONS[0];
};


/* ============================================================
   C. ESTADO GLOBAL
   ============================================================ */

const state = {
  phase:                  'intro',
  nodes:                  [],
  activeId:               0,
  history:                [0],
  currentColor:           null,
  validIds:               [],
  steps:                  0,
  victoryStaticPositions: null,
  slowNextTurn:           false,
  hintShown:              false,   // true → ya se mostró el hint de rotación
  zoom:                   1.0,
  camera: { rotY: 0, cameraY: 0 },
};

const ZOOM_MIN = 0.28;
const ZOOM_MAX = 1.6;

function applyZoom(z, duration = 0.3) {
  state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  if (duration > 0) {
    gsap.to(dom.gameScene, { scale: state.zoom, duration, ease: 'power2.out', overwrite: 'auto' });
  } else {
    gsap.set(dom.gameScene, { scale: state.zoom });
  }
}

let _cameraTargetRotY = 0;
let _isDragging       = false;
let _actualCamRotY    = 0;   // rotación CSS real en cada frame (puede diferir de state.camera.rotY durante animación)


/* ============================================================
   D. CÁMARA
   ============================================================ */

function calcTargetRotY(nodeDeg) {
  const raw   = -nodeDeg;
  const cur   = _cameraTargetRotY;
  const delta = ((raw - cur) % 360 + 540) % 360 - 180;
  return cur + delta;
}

function animateCameraTo(node, duration, onDone) {
  const targetRotY = calcTargetRotY(node.angleDeg);
  _cameraTargetRotY    = targetRotY;
  state.camera.rotY    = targetRotY;
  state.camera.cameraY = node.y;

  gsap.killTweensOf(dom.towerScene);
  gsap.to(dom.towerScene, {
    rotateY: targetRotY, y: node.y, duration, ease: 'power3.inOut',
    onUpdate: function () {
      // Leer la rotación CSS REAL en cada frame para que los puntos intermedios de la cuerda
      // coincidan con las posiciones getBoundingClientRect() (que también usan el CSS real).
      _actualCamRotY = gsap.getProperty(dom.towerScene, 'rotateY') || 0;
      updateRopeFromScreenPos();
    },
    onComplete: () => {
      _actualCamRotY = targetRotY;
      updateRopeFromScreenPos();
      if (onDone) onDone();
    },
  });
}


/* ============================================================
   E. CUERDA SVG
   ============================================================ */

const ropeSegs = [];

function getNodeCenter(node) {
  if (state.victoryStaticPositions?.[node.id]) return state.victoryStaticPositions[node.id];
  if (!node.el) return null;
  const r = node.el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Construye el path SVG de la cuerda entre dos nodos.
 *
 * En lugar de una bezier 2D simple (que cruza el interior del cilindro cuando
 * los nodos están en caras opuestas), muestrea N puntos sobre la superficie
 * 3D del cilindro, los proyecta a pantalla con perspectiva y los une como
 * polilínea. Esto garantiza que la cuerda siempre rodee el exterior.
 *
 * Proyección usada (igual que CSS perspective:900px):
 *   screenX = cx  + worldX · (900 / (900 − worldZ))
 *   screenY = lerp(a.y, b.y, t)  +  seno de gravedad
 *
 * El arco más corto alrededor del cilindro se obtiene normalizando dα a [−π, π].
 */
/**
 * Construye el path SVG de la cuerda entre dos nodos.
 *
 * Estrategia: un único cubic bezier por segmento.
 * Los control points se desvían perpendicularmente a la línea A→B en función
 * del arco angular (dα) que separa los dos nodos en el cilindro.
 * Esto sugiere visualmente "rodear la torre" sin proyectar coordenadas 3D,
 * lo que elimina los overshoots y loops que producía el muestreo del cilindro.
 *
 * bow (desvío lateral) = sign(dα) × sin(|dα|/2) × escala × radio_medio
 *   · sin(|dα|/2) crece de 0 (misma cara) a 1 (cara opuesta) de forma monotónica.
 *   · El signo indica dirección horaria/antihoraria.
 *   · Doble tope: relativo a la longitud del segmento + tope absoluto en px.
 */
function buildRopePath(a, b, nodeA, nodeB) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const cx   = window.innerWidth / 2;

  // Tramo final a la Meta: cuerda tensa, desvío mínimo
  const isCima = (nodeB?.isCima === true);
  const maxSag = Math.min(dist * 0.09, 12) * (isCima ? 0.2 : 1.0);

  // Fallback sin datos 3D
  if (!nodeA || !nodeB) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + maxSag;
    const ox = (mx - cx) * 0.18;
    return `M ${a.x.toFixed(1)},${a.y.toFixed(1)} Q ${(mx + ox).toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }

  // Delta angular normalizado a [−π, π] usando la rotación CSS real del frame
  const camRot = _actualCamRotY;
  const αA = ((nodeA.angleDeg || 0) + camRot) * Math.PI / 180;
  const αB = ((nodeB.angleDeg || 0) + camRot) * Math.PI / 180;
  let dα = αB - αA;
  while (dα >  Math.PI) dα -= 2 * Math.PI;
  while (dα < -Math.PI) dα += 2 * Math.PI;

  const rA   = nodeA._levelRadius || 0;
  const rB   = nodeB._levelRadius || 0;
  const rAvg = (rA + rB) / 2;

  // ── Desvío lateral (bow) ────────────────────────────────────────────────────
  // sin(|dα|/2) crece de 0→1 conforme el arco va de 0→π, sin oscilaciones.
  // Tope relativo: no más de 45% de la longitud del segmento (evita arcos exagerados).
  // Tope absoluto en px: garantía final sin importar radios ni distancias.
  const BOW_SCALE   = isCima ? 0.28 : 0.42;
  const BOW_MAX_ABS = isCima ? 28   : 58;     // px — límite duro
  const bowMag = Math.sin(Math.abs(dα) / 2) * Math.max(rAvg * BOW_SCALE, isCima ? 6 : 18);
  const bow    = Math.sign(dα) * Math.min(bowMag, dist * 0.45, BOW_MAX_ABS);

  // Vector perpendicular unitario a la línea A→B (rotación +90°)
  const len   = Math.max(dist, 1);
  const perpX = -((b.y - a.y) / len);
  const perpY =   (b.x - a.x) / len;

  // Control points a 30 % y 70 % del segmento + desvío perpendicular + sag sinusoidal
  const cp1x = a.x + (b.x - a.x) * 0.30 + perpX * bow;
  const cp1y = a.y + (b.y - a.y) * 0.30 + perpY * bow + maxSag * Math.sin(0.30 * Math.PI);
  const cp2x = a.x + (b.x - a.x) * 0.70 + perpX * bow;
  const cp2y = a.y + (b.y - a.y) * 0.70 + perpY * bow + maxSag * Math.sin(0.70 * Math.PI);

  return `M ${a.x.toFixed(1)},${a.y.toFixed(1)} C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}

function addRopeSeg(fromId, toId) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.classList.add('rope-path');
  dom.ropeSvg.appendChild(path);

  const knot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  knot.classList.add('rope-knot');
  knot.setAttribute('r', '0');
  dom.ropeSvg.appendChild(knot);

  const seg = { path, knot, fromId, toId };
  ropeSegs.push(seg);

  requestAnimationFrame(() => {
    updateRopeSeg(seg);
    try {
      const len = path.getTotalLength();
      if (len > 0) {
        path.style.strokeDasharray  = `${len}`;
        path.style.strokeDashoffset = `${len}`;
        gsap.to(path, { strokeDashoffset: 0, duration: 0.6, ease: 'power2.out' });
      }
    } catch (_) { path.style.strokeDasharray = 'none'; }

    const to = getNodeCenter(state.nodes[toId]);
    if (to) {
      knot.setAttribute('cx', to.x.toFixed(1));
      knot.setAttribute('cy', to.y.toFixed(1));
      gsap.to(knot, { attr: { r: 4.5 }, delay: 0.5, duration: 0.22, ease: 'back.out(2.2)' });
    }
  });
}

function removeLastRopeSeg() {
  const seg = ropeSegs.pop();
  if (!seg) return;
  gsap.to([seg.path, seg.knot], {
    opacity: 0, duration: 0.3,
    onComplete: () => { seg.path.remove(); seg.knot.remove(); },
  });
}

function updateRopeSeg(seg) {
  const nodeA = state.nodes[seg.fromId];
  const nodeB = state.nodes[seg.toId];
  const a = getNodeCenter(nodeA);
  const b = getNodeCenter(nodeB);
  if (!a || !b) return;
  seg.path.setAttribute('d', buildRopePath(a, b, nodeA, nodeB));
  seg.knot.setAttribute('cx', b.x.toFixed(1));
  seg.knot.setAttribute('cy', b.y.toFixed(1));

  const AL     = state.nodes[state.activeId].level;
  const maxLv  = Math.max(nodeA.level, nodeB.level);
  let   op     = 0;
  if (state.phase === 'win')          op = 1.0;
  else if (maxLv >= AL - 1)           op = 1.0;
  else if (maxLv === AL - 2)          op = 0.22;
  else                                op = 0.0;
  gsap.to([seg.path, seg.knot], { opacity: op, duration: 0.4, overwrite: 'auto' });
}

function updateRopeFromScreenPos() { ropeSegs.forEach(updateRopeSeg); }


/* ============================================================
   F. RULETA — anillo de 8 puntos de color
   ============================================================ */

// Audio de victoria
const _sfxSuccess = new Audio('assets/succes.mp3');
_sfxSuccess.volume = 0.85;

// Audio de la ruleta — loop sin gap usando timeupdate
const _sfxRoulette = new Audio('assets/sonidoruleta.mp3');
_sfxRoulette.volume = 0;
_sfxRoulette.addEventListener('timeupdate', function () {
  // Reiniciar 0.18s antes del final para evitar el gap del loop nativo
  if (this.duration && this.currentTime > this.duration - 0.18) {
    this.currentTime = 0;
  }
});

function spinRoulette() {
  return new Promise(resolve => {
    const color    = COLORS[Math.floor(Math.random() * COLORS.length)];
    const colorIdx = COLORS.indexOf(color);

    // Dos posiciones en el anillo para este color (colorIdx y colorIdx + 4)
    const targetPos  = Math.random() < 0.5 ? colorIdx : colorIdx + 4;
    const dotAngle   = targetPos * 45;
    const extraSpins = 5 + Math.floor(Math.random() * 2); // más vueltas para verse rápido
    const finalRot   = -(extraSpins * 360 + dotAngle);

    dom.rouletteLabel.textContent  = '—';
    dom.rouletteResult.className   = '';
    dom.rouletteResult.textContent = '';
    gsap.set(dom.rouletteRing, { rotation: 0 });

    // Pausa antes de mostrar la ruleta (larga si el turno anterior fue SLOW_DOWN)
    const delay = state.slowNextTurn ? ROULETTE_DELAY_SLOW : ROULETTE_DELAY;
    state.slowNextTurn = false;
    setTimeout(() => {
      showOverlay(dom.rouletteOverlay);
      dom.rouletteLabel.textContent = 'Girando...';

      // Reproducir sonido desde el inicio con fade in
      _sfxRoulette.currentTime = 0;
      _sfxRoulette.volume      = 0;
      _sfxRoulette.loop        = true;
      _sfxRoulette.play().catch(() => {});   // ignorar bloqueo de autoplay
      gsap.to(_sfxRoulette, { volume: 0.75, duration: 0.5, ease: 'power1.out' });

      gsap.to(dom.rouletteRing, {
        rotation: finalRot,
        duration: 4.5,
        ease:     'power2.inOut',
        onComplete: () => {
          // Fade out del sonido al frenar
          gsap.to(_sfxRoulette, {
            volume: 0, duration: 0.8, ease: 'power2.in',
            onComplete: () => { _sfxRoulette.pause(); },
          });

          dom.rouletteLabel.textContent  = 'Tu color:';
          dom.rouletteResult.className   = `color-${color}`;
          dom.rouletteResult.textContent = COLOR_ES[color];

          gsap.fromTo(dom.rouletteResult,
            { scale: 0.5, opacity: 0 },
            { scale: 1,   opacity: 1, duration: 0.5, ease: 'back.out(1.8)' }
          );

          setTimeout(() => hideOverlay(dom.rouletteOverlay, () => resolve(color)), 1400);
        },
      });
    }, delay);
  });
}


/* ============================================================
   G. NODOS VÁLIDOS
   ============================================================ */

function calcValidIds(fromId, color) {
  const cur = state.nodes[fromId];
  if (cur.level === LEVEL_DEFS.length - 1) return []; // ya en la cima

  const nextLevel = cur.level + 1;
  const nextNodes = state.nodes.filter(
    n => n.level === nextLevel && !state.history.includes(n.id)
  );

  // Penúltimo nivel → cima (sin filtro de color)
  if (cur.level === LEVEL_DEFS.length - 2) return nextNodes.map(n => n.id);

  const colorMatch = nextNodes.filter(n => n.color === color);
  return (colorMatch.length > 0 ? colorMatch : nextNodes).map(n => n.id);
}


/* ============================================================
   H. DOM — referencias y helpers
   ============================================================ */

let dom = {};

function initDOM() {
  dom = {
    introOverlay:    document.getElementById('intro-overlay'),
    rouletteOverlay: document.getElementById('roulette-overlay'),
    rouletteRing:    document.getElementById('roulette-ring'),
    rouletteLabel:   document.querySelector('.roulette-label'),
    rouletteResult:  document.getElementById('roulette-result'),
    gameScene:       document.getElementById('game-scene'),
    towerScene:      document.getElementById('tower-scene'),
    ropeSvg:         document.getElementById('rope-svg'),
    conditionModal:  document.getElementById('condition-modal'),
    modalCard:       document.getElementById('modal-card'),
    modalIcon:       document.getElementById('modal-icon'),
    modalTitle:      document.getElementById('modal-title'),
    modalText:       document.getElementById('modal-text'),
    modalActionHint: document.getElementById('modal-action-hint'),
    modalBtn:        document.getElementById('modal-btn'),
    victoryOverlay:  document.getElementById('victory-overlay'),
    hudLevelNum:     document.getElementById('hud-level-num'),
    hudColorDot:     document.getElementById('hud-color-dot'),
    hudColorText:    document.getElementById('hud-color-text'),
    hudStepsNum:     document.getElementById('hud-steps-num'),
    btnStart:        document.getElementById('btn-start'),
    btnRestart:      document.getElementById('btn-restart'),
    statSteps:       document.getElementById('stat-steps'),
  };

  buildRouletteRing(dom.rouletteRing);
}

/** Crea los 8 puntos del anillo de ruleta y los posiciona en círculo */
function buildRouletteRing(ringEl) {
  ringEl.innerHTML = '';
  const orbit   = 54; // px desde el centro
  const dotSize = 22; // px diámetro

  RING_DOT_COLORS.forEach((color, i) => {
    const rad = (i * 45) * Math.PI / 180;
    const x   = orbit * Math.sin(rad);
    const y   = -orbit * Math.cos(rad);
    const dot = document.createElement('div');
    dot.className = `roulette-dot roulette-dot-${color}`;
    dot.style.cssText = [
      `width:${dotSize}px`,
      `height:${dotSize}px`,
      `left:calc(50% + ${x.toFixed(1)}px - ${dotSize / 2}px)`,
      `top:calc(50% + ${y.toFixed(1)}px - ${dotSize / 2}px)`,
    ].join(';');
    ringEl.appendChild(dot);
  });
}

function showOverlay(el) {
  el.classList.remove('hidden');
  el.classList.add('active');
  gsap.fromTo(el,
    { opacity: 0, pointerEvents: 'none' },
    { opacity: 1, pointerEvents: 'auto', duration: 0.38, ease: 'power2.out' }
  );
}

function hideOverlay(el, cb) {
  gsap.to(el, {
    opacity: 0, pointerEvents: 'none', duration: 0.35, ease: 'power2.in',
    onComplete: () => {
      el.classList.remove('active');
      el.classList.add('hidden');
      gsap.set(el, { clearProps: 'all' });
      if (cb) cb();
    },
  });
}


/* ============================================================
   I. RENDERIZADO DE NODOS (CSS preserve-3d)
   ============================================================ */

function renderTower(nodes) {
  dom.towerScene.querySelectorAll('.node-wrap').forEach(n => n.remove());

  nodes.forEach(node => {
    const size = NODE_SIZES[node.level] || 22;
    node._jitterRz = (Math.random() - 0.5) * 10; // ±5° irregularidad orgánica
    const tz = node.isCima ? 0 : node._levelRadius;

    // Wrapper 3D — posición fija; GSAP nunca toca su transform
    const wrap = document.createElement('div');
    wrap.className = 'node-wrap';
    wrap.style.cssText = [
      `width:${size}px`,
      `height:${size}px`,
      `margin:-${size / 2}px 0 0 -${size / 2}px`,
      `transform:rotateY(${node.angleDeg}deg) translateZ(${tz}px) translateY(${-node.y}px) rotateZ(${node._jitterRz.toFixed(1)}deg)`,
    ].join(';');

    // Nodo visual (color, borde de condición)
    const el = document.createElement('div');
    el.className = [
      'node',
      node.isCima      ? 'node-cima'     : `node-${node.color}`,
      node.isCondition ? 'node-condition' : '',
    ].filter(Boolean).join(' ');
    el.dataset.id = String(node.id);

    // ── Hitbox: ÚNICO punto blanco clickeable ──────────────────────────────
    const dot = document.createElement('div');
    dot.className = 'node-dot';

    dot.addEventListener('click', e => {
      e.stopPropagation();
      if (!_isDragging) onNodeClick(node.id);
    });

    // Hover: glow de color propio (solo si es válido)
    dot.addEventListener('mouseenter', () => {
      if (state.validIds.includes(node.id)) {
        el.classList.add('glowing');
        gsap.to(el, { scale: 1.14, duration: 0.18, ease: 'power2.out', overwrite: 'auto' });
      }
    });
    dot.addEventListener('mouseleave', () => {
      el.classList.remove('glowing');
      gsap.to(el, { scale: 1, duration: 0.18, ease: 'power2.out', overwrite: 'auto' });
    });

    el.appendChild(dot);
    wrap.appendChild(el);
    dom.towerScene.appendChild(wrap);
    node.el   = el;
    node.wrap = wrap;
    node.dot  = dot;
  });
}

/**
 * Actualiza visibilidad y estado de los nodos.
 * Muestra: nivel activo (1.0), +1 (0.88), +2 (0.40 sólo visual), -1 (0.08 fantasma).
 * Solo los nodos en validIds tienen su hitbox activada.
 */
function refreshNodeStyles() {
  if (state.phase === 'win') return;

  const AL = state.nodes[state.activeId].level;

  state.nodes.forEach(node => {
    if (!node.el || !node.wrap) return;

    node.el.classList.remove('active', 'valid', 'visited', 'glowing');

    // ── Visibilidad por nivel ───────────────────────────────────────────────
    let opacity     = 0;
    let wrapPointer = 'none';

    if      (node.level === AL)     { opacity = 1.00; wrapPointer = 'auto'; }
    else if (node.level === AL + 1) { opacity = 0.88; wrapPointer = 'auto'; }
    else if (node.level === AL + 2) { opacity = 0.40; wrapPointer = 'none'; } // preview, no clickeable
    else if (node.level === AL - 1) { opacity = 0.08; wrapPointer = 'none'; } // fantasma del pasado

    // ── Estado lógico ─────────────────────────────────────────────────────
    if (node.id === state.activeId) {
      node.el.classList.add('active');
    } else if (state.validIds.includes(node.id)) {
      node.el.classList.add('valid');
    } else if (state.history.includes(node.id)) {
      node.el.classList.add('visited');
      if (node.level === AL) opacity = 0.20; // visitado en el mismo nivel = muy tenue
    }

    // ── Hitbox del punto blanco: activo SOLO si es válido ─────────────────
    if (node.dot) {
      node.dot.style.pointerEvents = state.validIds.includes(node.id) ? 'auto' : 'none';
    }

    // ── Aplicar opacidad y puntero del wrapper ─────────────────────────────
    node.wrap.style.pointerEvents = wrapPointer;
    gsap.to(node.wrap, { opacity, duration: 0.45, ease: 'power2.out', overwrite: 'auto' });
  });

  updateRopeFromScreenPos();
}


/* ============================================================
   J. MODAL DE CONDICIÓN
   ============================================================ */

function showConditionModal(cond, onDismiss) {
  state.phase = 'modal';
  dom.modalIcon.textContent       = cond.icon;
  dom.modalTitle.textContent      = cond.title;
  dom.modalText.textContent       = cond.text;
  dom.modalActionHint.textContent = cond.hint;
  showOverlay(dom.conditionModal);
  gsap.fromTo(dom.modalCard,
    { y: 28, scale: 0.88, opacity: 0 },
    { y: 0,  scale: 1,    opacity: 1, duration: 0.44, ease: 'back.out(1.4)' }
  );
  dom.modalBtn.onclick = () => {
    gsap.to(dom.modalCard, {
      y: -18, opacity: 0, scale: 0.92, duration: 0.28, ease: 'power2.in',
      onComplete: () => hideOverlay(dom.conditionModal, onDismiss),
    });
  };
}

function removeAllRopesOneByOne() {
  return new Promise(resolve => {
    const interval = setInterval(() => {
      if (ropeSegs.length > 0) removeLastRopeSeg();
      else { clearInterval(interval); resolve(); }
    }, 100);
  });
}

function execConditionAction(cond) {
  switch (cond.action) {

    case 'STEP_BACK_1': {
      if (state.history.length > 1) {
        state.history.pop();
        const prevId = state.history.pop();
        removeLastRopeSeg();
        state.activeId = prevId;
        state.history.push(prevId);
        dom.hudLevelNum.textContent = state.nodes[prevId].level;
        refreshNodeStyles();
        animateCameraTo(state.nodes[prevId], 0.72, startNextTurn);
      } else {
        startNextTurn();
      }
      break;
    }

    case 'ADVANCE_2': {
      const curLv  = state.nodes[state.activeId].level;
      const target = state.nodes.find(
        n => n.level === Math.min(curLv + 2, LEVEL_DEFS.length - 1)
          && !state.history.includes(n.id)
      );
      target ? moveToNode(target.id, false) : startNextTurn();
      break;
    }

    case 'ADVANCE_1': {
      const curLv  = state.nodes[state.activeId].level;
      const target = state.nodes.find(
        n => n.level === Math.min(curLv + 1, LEVEL_DEFS.length - 1)
          && !state.history.includes(n.id)
      );
      target ? moveToNode(target.id, false) : startNextTurn();
      break;
    }

    case 'GO_TO_START': {
      state.phase = 'animating';
      removeAllRopesOneByOne().then(() => {
        state.history  = [0];
        state.activeId = 0;
        dom.hudLevelNum.textContent = '0';
        refreshNodeStyles();
        animateCameraTo(state.nodes[0], 1.4, startNextTurn);
      });
      break;
    }

    case 'SLOW_DOWN':
      state.slowNextTurn = true;
      state.phase = 'playing';
      startNextTurn();
      break;

    default:
      state.phase = 'playing';
      startNextTurn();
      break;
  }
}


/* ============================================================
   K. LOOP PRINCIPAL
   ============================================================ */

function moveToNode(nodeId, checkCond = true) {
  const fromId = state.activeId;
  const node   = state.nodes[nodeId];

  state.phase    = 'animating';
  state.history.push(nodeId);
  state.activeId = nodeId;
  state.steps++;
  state.validIds = [];

  dom.hudLevelNum.textContent = node.level;
  dom.hudStepsNum.textContent = state.steps;

  addRopeSeg(fromId, nodeId);
  refreshNodeStyles();

  // Flash de nivel al subir
  if (node.level > state.nodes[fromId].level) {
    const flash = document.createElement('div');
    flash.className   = 'level-flash';
    flash.textContent = `↑ Nivel ${node.level}`;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);
  }

  animateCameraTo(node, CAM_DUR, () => {
    // Llegó a la cima → victoria
    if (node.isCima) { setTimeout(showVictory, 500); return; }

    if (checkCond && node.isCondition) {
      const cond = randCondition();
      showConditionModal(cond, () => execConditionAction(cond));
    } else {
      startNextTurn();
    }
  });
}

async function startNextTurn() {
  // Si estamos en el penúltimo nivel, la cima es el único destino:
  // no hay color relevante → saltar la ruleta directamente.
  const curLevel      = state.nodes[state.activeId].level;
  const isPenultimate = curLevel === LEVEL_DEFS.length - 2;

  if (isPenultimate) {
    state.phase        = 'playing';
    state.currentColor = null;
    state.validIds     = calcValidIds(state.activeId, null);
    dom.hudColorDot.style.background = '#1a1a1a';
    dom.hudColorText.textContent     = '¡A la cima!';
    refreshNodeStyles();
    return;
  }

  state.phase = 'rolling';
  const color = await spinRoulette();    // incluye el ROULETTE_DELAY internamente

  state.currentColor = color;
  state.validIds     = calcValidIds(state.activeId, color);
  state.phase        = 'playing';

  dom.hudColorDot.style.background = COLOR_HEX[color];
  dom.hudColorText.textContent     = COLOR_ES[color];

  refreshNodeStyles();

  // Mostrar hint de rotación solo la primera vez que se revela un color
  if (!state.hintShown) {
    state.hintShown = true;
    showRotateHint();
  }
}

function onNodeClick(nodeId) {
  if (state.phase !== 'playing') return;

  if (!state.validIds.includes(nodeId)) {
    // Shake sutil si el jugador intenta hacer click en un nodo visible pero no válido
    const node = state.nodes[nodeId];
    if (node?.el) {
      gsap.timeline({ overwrite: true })
        .to(node.el, { x:  6, duration: 0.07 })
        .to(node.el, { x: -6, duration: 0.07 })
        .to(node.el, { x:  4, duration: 0.06 })
        .to(node.el, { x:  0, duration: 0.06 });
    }
    return;
  }

  state.validIds = [];
  moveToNode(nodeId);
}


/* ============================================================
   L. VICTORIA
   ============================================================ */

function windUpRope() {
  return new Promise(resolve => {
    if (!ropeSegs.length) { resolve(); return; }
    const next = () => {
      const seg = ropeSegs.pop();
      if (!seg) { resolve(); return; }
      gsap.to(seg.knot, { attr: { r: 0 }, duration: 0.18, ease: 'power2.in' });
      try {
        const len = seg.path.getTotalLength();
        gsap.to(seg.path, {
          strokeDashoffset: len, duration: 0.4, ease: 'power2.inOut',
          onComplete: () => { seg.path.remove(); seg.knot.remove(); next(); },
        });
      } catch (_) { seg.path.remove(); seg.knot.remove(); next(); }
    };
    next();
  });
}

function showVictory() {
  state.phase = 'win';
  dom.statSteps.textContent = state.steps;

  // ── 0. Zoom out + recentrar cámara para ver la torre completa.
  //      La cámara está en y = cima.y (1440px), lo que deja la base fuera de pantalla.
  //      Animamos la cámara al punto medio de la torre para que todo quede centrado
  //      antes de que los nodos caigan.
  {
    const totalY    = (LEVEL_DEFS.length - 1) * LEVEL_GAP;   // alto total de la torre
    const midY      = totalY / 2;                              // punto medio (720px)
    // Ajuste fino: con top:52% necesitamos restar ~2% de pantalla para centrar mejor
    const targetY   = midY - window.innerHeight * 0.02;
    applyZoom(0.35, 2.2);
    gsap.to(dom.towerScene, {
      y: targetY, duration: 2.2, ease: 'power2.inOut', overwrite: 'auto',
      onUpdate: updateRopeFromScreenPos,
    });
  }

  // ── 0b. Hacer visibles TODOS los nodos para que la caída se pueda ver.
  state.nodes.forEach(node => {
    if (node.wrap) gsap.set(node.wrap, { opacity: 1 });
    if (node.el)   gsap.set(node.el,   { scale: 1, y: 0 });
  });
  // Asegurar que la cuerda sea visible y se actualice mientras la cámara se mueve
  ropeSegs.forEach(seg => gsap.set([seg.path, seg.knot], { opacity: 1 }));

  // ── 1. Sonido de victoria + confeti
  _sfxSuccess.currentTime = 0;
  _sfxSuccess.play().catch(() => {});

  if (typeof confetti === 'function') {
    const yellowConfetti = { colors: ['#ecc316', '#f5d842', '#fae27a', '#c9a800'] };
    confetti({ ...yellowConfetti, particleCount: 220, spread: 90,  startVelocity: 65, scalar: 2.8, origin: { y: 0.6 } });
    setTimeout(() => confetti({ ...yellowConfetti, particleCount: 180, spread: 110, startVelocity: 55, scalar: 3.2, origin: { y: 0.5 } }), 350);
    setTimeout(() => confetti({ ...yellowConfetti, particleCount: 150, spread: 70,  startVelocity: 50, scalar: 2.5, origin: { y: 0.7 } }), 700);
    setTimeout(() => confetti({ ...yellowConfetti, particleCount: 120, spread: 130, startVelocity: 45, scalar: 3.0, origin: { y: 0.4 } }), 1050);
  }

  // ── 3. Caída dramática uno a uno, de arriba hacia abajo (cima primero)
  //      Las posiciones de la cuerda se congelan AQUÍ, después de que la cámara
  //      terminó de moverse (2.2s de zoom) → los nodos ya están en pantalla.
  setTimeout(() => {
    // Congelar posiciones AHORA (cámara ya centrada, todos los nodos visibles)
    state.victoryStaticPositions = {};
    state.nodes.forEach(node => {
      const pos = getNodeCenter(node);
      if (pos) state.victoryStaticPositions[node.id] = pos;
    });
    updateRopeFromScreenPos(); // dibujar la cuerda una última vez con posiciones correctas

    const sorted = [...state.nodes].sort((a, b) => b.level - a.level);

    // Encontrar el índice real del último nodo con elemento válido
    let lastValidIdx = -1;
    sorted.forEach((node, idx) => { if (node.el) lastValidIdx = idx; });

    sorted.forEach((node, idx) => {
      if (!node.el) return;
      gsap.to(node.el, {
        y:        window.innerHeight + 350,
        rotation: gsap.utils.random(-220, 220),
        opacity:  0,
        scale:    0.35,
        duration: 2.2,
        ease:     'power3.in',
        delay:    idx * 0.14,
        onComplete: idx === lastValidIdx ? () => {
          // ── 4. Enrollar la cuerda, luego mostrar victoria
          setTimeout(() => {
            windUpRope().then(() => {
              state.victoryStaticPositions = null;
              showOverlay(dom.victoryOverlay);
              gsap.fromTo('.victory-content',
                { y: 50, opacity: 0 },
                { y: 0,  opacity: 1, duration: 0.75, ease: 'power3.out' }
              );
            });
          }, 800);
        } : undefined,
      });
    });
  }, 1800);
}


/* ============================================================
   M. INICIO / REINICIO
   ============================================================ */

function startGame() {
  gsap.killTweensOf('*');

  state.nodes        = buildTowerNodes();
  state.activeId     = 0;
  state.history      = [0];
  state.steps        = 0;
  state.currentColor = null;
  state.validIds     = [];
  state.phase        = 'animating'; // no interacción hasta que termine el intro
  state.camera       = { rotY: 0, cameraY: 0 };
  state.victoryStaticPositions = null;
  state.slowNextTurn = false;
  state.hintShown    = false;
  _cameraTargetRotY  = 0;
  _actualCamRotY     = 0;

  applyZoom(1.0, 0.5);
  gsap.set(dom.towerScene, { clearProps: 'rotateY,y' });

  const defs = dom.ropeSvg.querySelector('defs');
  dom.ropeSvg.innerHTML = '';
  if (defs) dom.ropeSvg.appendChild(defs);
  ropeSegs.length = 0;

  dom.hudLevelNum.textContent      = '0';
  dom.hudStepsNum.textContent      = '0';
  dom.hudColorText.textContent     = '—';
  dom.hudColorDot.style.background = '#ccc';

  renderTower(state.nodes);
  dom.gameScene.classList.remove('hidden');

  // Ocultar todos los nodos al inicio — escala 1 para que al hacerse visibles
  // aparezcan a tamaño real (el scale:0.1 solo se aplica a los que se van a animar).
  state.nodes.forEach(node => {
    if (node.wrap) gsap.set(node.wrap, { opacity: 0 });
    if (node.el)   gsap.set(node.el,   { scale: 1 });
  });

  // Animar solo los 3 niveles visibles inicialmente (0, 1, 2) con rebote de entrada.
  const visible = state.nodes.filter(n => n.level <= 2);
  const lastV   = visible[visible.length - 1];

  visible.forEach((node, i) => {
    const targetOp = node.level === 0 ? 1.0 : node.level === 1 ? 0.88 : 0.4;
    const delay    = 0.12 + i * 0.09;
    // Poner a 0.1 justo antes de animar (el wrap está en opacity 0, nadie lo ve)
    gsap.set(node.el, { scale: 0.1 });
    gsap.to(node.wrap, { opacity: targetOp, duration: 0.7, ease: 'power2.out', delay });
    gsap.to(node.el, {
      scale: 1, duration: 0.75, ease: 'back.out(1.6)', delay,
      onComplete: node.id === lastV.id ? () => startNextTurn() : undefined,
    });
  });
}


/* ============================================================
   N. PUNTO DE ENTRADA
   ============================================================ */

/* ── Hint de rotación ──────────────────────────────────────────────────────── */
let _hintTimeout = null;

function showRotateHint() {
  const el = document.getElementById('rotate-hint');
  if (!el) return;
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('visible'));
  // Desaparece solo a los 3.5 s
  _hintTimeout = setTimeout(() => hideRotateHint(), 3500);
}

function hideRotateHint() {
  const el = document.getElementById('rotate-hint');
  if (!el || !el.classList.contains('visible')) return;
  clearTimeout(_hintTimeout);
  el.classList.remove('visible');
  el.addEventListener('transitionend', () => el.classList.add('hidden'), { once: true });
}

document.addEventListener('DOMContentLoaded', () => {
  initDOM();

  // ── Transición de carga: ruleta que gira y se expande (6 s) ────────────────
  function showIntro() {
    document.body.style.opacity = '1';
    dom.introOverlay.classList.remove('hidden');
    dom.introOverlay.classList.add('active');
    gsap.fromTo(dom.introOverlay,
      { opacity: 0 },
      { opacity: 1, duration: 0.6, ease: 'power2.out' }
    );
  }

  /** Anima la ruleta de carga: aparece desde el centro, gira acelerando
      y se expande hacia afuera hasta revelar el juego. Dura 6 s. */
  function runRouletteTransition(onDone) {
    const overlay = document.getElementById('roulette-transition');
    if (!overlay) { onDone(); return; }

    const wrap = overlay.querySelector('.rt-ring-wrap');
    const ring = document.getElementById('rt-ring');
    buildRouletteRing(ring); // reutiliza el mismo anillo de 8 puntos del juego

    // Sonido de la ruleta (fade in/out). Se ignora si el navegador bloquea autoplay.
    try {
      _sfxRoulette.currentTime = 0;
      _sfxRoulette.volume      = 0;
      _sfxRoulette.loop        = true;
      _sfxRoulette.play().catch(() => {});
      gsap.to(_sfxRoulette, { volume: 0.6, duration: 0.6, ease: 'power1.out' });
    } catch (e) {}

    gsap.set(wrap, { scale: 0.1, opacity: 1, transformOrigin: '50% 50%' });
    gsap.set(ring, { rotation: 0, transformOrigin: '50% 50%' });

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.to(_sfxRoulette, {
          volume: 0, duration: 0.5, ease: 'power2.in',
          onComplete: () => { try { _sfxRoulette.pause(); } catch (e) {} },
        });
        onDone();
      },
    });

    // Giro continuo más lento durante toda la transición
    tl.to(ring, { rotation: 360 * 5, duration: 4.6, ease: 'power1.inOut' }, 0);
    // 1) Aparece desde el centro con un pequeño rebote
    tl.to(wrap, { scale: 1, duration: 0.8, ease: 'back.out(1.6)' }, 0);
    // 2) Gira en el centro ~2 s (crece muy suave hasta los 2 s)
    tl.to(wrap, { scale: 1.25, duration: 1.2, ease: 'power1.inOut' }, 0.8);
    // 3) Se expande hacia afuera más lento (desde los 2 s)
    tl.to(wrap, { scale: 16, duration: 2.6, ease: 'power2.in' }, 2.0);
    // 4) Fade out del overlay para revelar el juego
    tl.to(overlay, { opacity: 0, duration: 1.2, ease: 'power2.in' }, 3.4);
  }

  runRouletteTransition(() => {
    const overlay = document.getElementById('roulette-transition');
    if (overlay) overlay.remove();
    setTimeout(showIntro, 200);
  });

  document.body.style.opacity    = '0';
  document.body.style.transition = 'opacity 0.5s ease';
  requestAnimationFrame(() =>
    requestAnimationFrame(() => { document.body.style.opacity = '1'; })
  );

  dom.btnStart.addEventListener('click', () => {
    gsap.to(dom.introOverlay, {
      opacity: 0, pointerEvents: 'none', duration: 0.5, ease: 'power2.in',
      onComplete: () => {
        dom.introOverlay.classList.remove('active');
        dom.introOverlay.classList.add('hidden');
        gsap.set(dom.introOverlay, { clearProps: 'all' });
        startGame();
      },
    });
  });

  dom.btnRestart.addEventListener('click', () => hideOverlay(dom.victoryOverlay, startGame));

  window.addEventListener('resize', updateRopeFromScreenPos);

  /* ── Drag-to-Rotate ─────────────────────────────────────────────────────
     Arrastra el fondo para rotar la torre sobre su eje Y.
     .node-dot está en DRAG_IGNORE → clicks en nodos válidos NO inician drag.
     El resto de la escena puede arrastrarse libremente. */

  const DRAG_SENSITIVITY = 0.40;
  const INERTIA_FACTOR   = 11;
  const MIN_DRAG_PX      = 5;

  const drag = { active: false, startX: 0, lastX: 0, startRotY: 0, velocity: 0 };

  function dragStart(clientX) {
    hideRotateHint();
    if (state.phase === 'intro' || state.phase === 'win') return;
    drag.active    = true;
    drag.startX    = clientX;
    drag.lastX     = clientX;
    drag.startRotY = state.camera.rotY;
    drag.velocity  = 0;
    _isDragging    = false;
    gsap.killTweensOf(dom.towerScene, 'rotateY');
    dom.towerScene.style.cursor = 'grabbing';
  }

  function dragMove(clientX) {
    if (!drag.active) return;
    const dx = clientX - drag.startX;
    if (Math.abs(dx) > MIN_DRAG_PX) _isDragging = true;
    drag.velocity     = (clientX - drag.lastX) * DRAG_SENSITIVITY;
    drag.lastX        = clientX;
    state.camera.rotY = drag.startRotY + dx * DRAG_SENSITIVITY;
    _cameraTargetRotY = state.camera.rotY;
    _actualCamRotY    = state.camera.rotY;   // en drag el CSS se aplica de inmediato → sincronizar
    gsap.set(dom.towerScene, { rotateY: state.camera.rotY });
    updateRopeFromScreenPos();
  }

  function dragEnd() {
    if (!drag.active) return;
    drag.active = false;
    dom.towerScene.style.cursor = 'grab';
    if (_isDragging && Math.abs(drag.velocity) > 0.3) {
      const targetRotY = state.camera.rotY + drag.velocity * INERTIA_FACTOR;
      gsap.to(dom.towerScene, {
        rotateY: targetRotY, duration: 1.1, ease: 'power2.out',
        onUpdate: function () {
          _actualCamRotY = gsap.getProperty(dom.towerScene, 'rotateY') || 0;
          updateRopeFromScreenPos();
        },
        onComplete: () => {
          state.camera.rotY = targetRotY;
          _cameraTargetRotY = targetRotY;
          _actualCamRotY    = targetRotY;
        },
      });
    }
    setTimeout(() => { _isDragging = false; }, 50);
  }

  // .node-dot en DRAG_IGNORE → clicks en dots válidos no inician drag
  const DRAG_IGNORE = '.node-dot, .modal-overlay, .back-btn, .game-hud, button, a';

  document.addEventListener('mousedown',  e => { if (!e.target.closest(DRAG_IGNORE)) dragStart(e.clientX); });
  document.addEventListener('mousemove',  e => dragMove(e.clientX));
  document.addEventListener('mouseup',    dragEnd);

  document.addEventListener('touchstart', e => {
    if (e.touches.length === 1 && !e.target.closest(DRAG_IGNORE)) {
      dragStart(e.touches[0].clientX);
    }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (drag.active) { e.preventDefault(); dragMove(e.touches[0].clientX); }
  }, { passive: false });

  document.addEventListener('touchend', dragEnd);
});

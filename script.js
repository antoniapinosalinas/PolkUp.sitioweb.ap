// NODOS: Tamaños aumentados y posiciones para llenar el encuadre
const nodeData = [
  {color:'green', ringed:true, size:110, px:12, py:15},
  {color:'yellow',ringed:false, size:85, px:32, py:12 },
  {color:'red', ringed:false, size:90, px:64, py:18},
  {color:'blue', ringed:true, size:100, px:84, py:16 },
  {color:'blue', ringed:false, size:95, px:8, py:48},
  {color:'green', ringed:false, size:80, px:86, py:45},
  {color:'green', ringed:false, size:85, px:22, py:80}, 
  {color:'red', ringed:true, size:120, px:10, py:85},   
  {color:'blue', ringed:false, size:90, px:50, py:78},  
  {color:'yellow',ringed:true, size:115, px:85, py:82}, 
];

const hero = document.getElementById('hero');
const nLayer = document.getElementById('nodes-layer');
const canvas = document.getElementById('string-canvas');
const ctx = canvas.getContext('2d');
let W, H;

// Configuración estructural
hero.style.position = 'relative';

canvas.style.position = 'absolute';
canvas.style.top = '0px';
canvas.style.left = '0px';
canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.pointerEvents = 'none';
canvas.style.zIndex = '10'; // El canvas está sobre los nodos para que el hilo pase por encima

nLayer.style.position = 'absolute';
nLayer.style.top = '0px';
nLayer.style.left = '0px';
nLayer.style.width = '100%';
nLayer.style.height = '100%';
nLayer.style.zIndex = '5';

function resize(){
  W=hero.offsetWidth;
  H=hero.offsetHeight;
  canvas.width=W;
  canvas.height=H;
}
resize();
window.addEventListener('resize',()=>{resize();redraw();});

// Construir Nodos
const nodeEls=[], nodePhase=nodeData.map(()=>Math.random()*Math.PI*2);
nodeData.forEach((nd,i)=>{
  const el=document.createElement('div');
  el.className=`node node-${nd.color}${nd.ringed?' node-ringed':''}`;
  el.style.cssText=`position: absolute; width:${nd.size}px; height:${nd.size}px; left:${nd.px}%; top:${nd.py}%; margin-left:-${nd.size/2}px; margin-top:-${nd.size/2}px; pointer-events: auto; transition: box-shadow 0.3s ease;`;
  nLayer.appendChild(el);
  nodeEls.push(el);
  el.addEventListener('click',e=>{e.stopPropagation();onNodeClick(i);});
});

function nodeCenter(i){
  const r = nodeEls[i].getBoundingClientRect();
  const hr = hero.getBoundingClientRect();
  return {
    x: r.left - hr.left + (r.width / 2),
    y: r.top - hr.top + (r.height / 2)
  };
}

// Variables para guardar qué nodos están conectados
let nodeA = null, nodeB = null, activeSlot = null;

function updateNodeStyles() {
  nodeEls.forEach((el, i) => {
    if(i === nodeA || i === nodeB) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

function onNodeClick(i){
  if(nodeA === null){
    nodeA = i;
    activeSlot = 'A';
  } else if(nodeB === null){
    if(nodeA === i) return; // Evitar conectar el nodo consigo mismo
    nodeB = i;
    activeSlot = 'B';
  } else {
    // Si ya hay dos, reemplazamos el que no fue el último en conectarse
    const toReplace = (activeSlot === 'A') ? 'B' : 'A';
    if((toReplace === 'A' ? nodeB : nodeA) === i) return; 
    
    if(toReplace === 'A') nodeA = i;
    else nodeB = i;
    activeSlot = toReplace;
  }
  
  updateNodeStyles();
  redraw();
}

function redraw(){
  ctx.clearRect(0,0,W,H);
  
  if(nodeA === null || nodeB === null) return;
  
  const a = nodeCenter(nodeA);
  const b = nodeCenter(nodeB);
  
  // Cálculo de la tensión del hilo (la caída de la lana)
  const dist = Math.hypot(b.x-a.x, b.y-a.y);
  const sag = dist * 0.12 + 18;
  const mx = (a.x+b.x)/2;
  const my = (a.y+b.y)/2 + sag;
  
  // Dibujar la curva del hilo
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(mx, my, b.x, b.y);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Dibujar un pequeño boton en el centro para simular que entra en el agujero
  ctx.fillStyle = '#008e45';
  ctx.beginPath(); ctx.arc(a.x, a.y, 6, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI*2); ctx.fill();
}

// Animación de flotabilidad
let t=0;
function animate(){
  t+=0.008;
  nodeEls.forEach((el,i)=>{
    const ph=nodePhase[i];
    const dx=Math.sin(t*0.7+ph)*14;
    const dy=Math.cos(t*0.5+ph*1.3)*16;
    const bx=(nodeData[i].px/100)*W;
    const by=(nodeData[i].py/100)*H;
    el.style.left=(bx+dx)+'px';
    el.style.top =(by+dy)+'px';
  });
  
  if(nodeA !== null && nodeB !== null) redraw();
  requestAnimationFrame(animate);
}
animate();

// --- GALERÍA: Carrusel Coverflow 3D ---
(function initGalleryCarousel() {
  const carousel = document.querySelector('.gallery-carousel');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('.gallery-slide'));
  const dots = Array.from(carousel.querySelectorAll('.gallery-dot'));
  const prevBtn = carousel.querySelector('.gallery-arrow--prev');
  const nextBtn = carousel.querySelector('.gallery-arrow--next');

  let currentIndex = 0;
  const total = slides.length;

  function updateSlideClasses() {
    slides.forEach((slide, i) => {
      slide.classList.remove('active', 'prev', 'next', 'hidden');

      if (i === currentIndex) {
        slide.classList.add('active');
      } else if (i === (currentIndex - 1 + total) % total) {
        slide.classList.add('prev');
      } else if (i === (currentIndex + 1) % total) {
        slide.classList.add('next');
      } else {
        slide.classList.add('hidden');
      }
    });

    dots.forEach((dot, i) => {
      const isActive = i === currentIndex;
      dot.classList.toggle('active', isActive);
      dot.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function goTo(index) {
    currentIndex = ((index % total) + total) % total;
    updateSlideClasses();
  }

  prevBtn.addEventListener('click', () => goTo(currentIndex - 1));
  nextBtn.addEventListener('click', () => goTo(currentIndex + 1));

  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => goTo(i));
  });

  slides.forEach((slide, i) => {
    slide.addEventListener('click', () => {
      if (i !== currentIndex) goTo(i);
    });
  });

  updateSlideClasses();
})();


/* ================================================================
   MICROINTERACCIONES — Scroll Progress · Reveal · Tilt · Parallax
   Todo el código está encapsulado en una IIFE (función que se
   ejecuta sola).
   ================================================================ */
(function initMicro() {


  /* --------------------------------------------------------------
     1. BARRA DE PROGRESO DE SCROLL
     Calcula qué porcentaje de la página se ha recorrido dividiendo
     el scroll actual entre el scroll total posible, y asigna ese
     valor como ancho (width) al elemento #scroll-progress.
     El listener usa { passive: true } para no bloquear el scroll
     del navegador y mantener 60fps.
     -------------------------------------------------------------- */
  const progressBar = document.getElementById('scroll-progress');
  if (progressBar) {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progressBar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // calcular el estado inicial por si la página ya tiene scroll
  }


  /* --------------------------------------------------------------
     2. SEPARACIÓN DE TÍTULOS EN PALABRAS INDIVIDUALES
     Para animar cada palabra de un título por separado, esta
     función toma el HTML interno del elemento, respeta los <br>
     existentes, y envuelve cada palabra en un <span class="word">.
     Cada span recibe un animation-delay calculado según su posición
     (i * 0.085s), lo que crea el efecto de cascada (stagger).
     -------------------------------------------------------------- */
  function splitWords(el) {
    const parts = el.innerHTML.split(/<br\s*\/?>/i); // separar por saltos de línea
    const wrapped = parts.map(part =>
      part.trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((word, i) =>
          `<span class="word" style="animation-delay:${(i * 0.085).toFixed(3)}s">${word}</span>`
        )
        .join(' ')
    );
    el.innerHTML = wrapped.join('<br>');
  }

  document.querySelectorAll('.section-title, .cta-heading').forEach(splitWords);


  /* --------------------------------------------------------------
     3. OBSERVERS DE SCROLL (IntersectionObserver)
     IntersectionObserver es la API nativa del navegador para
     detectar cuándo un elemento entra en el viewport. Es mucho
     más eficiente que escuchar el evento scroll y calcular
     posiciones manualmente. Cada observer llama a .unobserve()
     tras activarse para que la animación ocurra solo una vez.
     -------------------------------------------------------------- */

  /* Observer para las etiquetas de sección: activa el subrayado
     animado cuando el texto es al menos 60% visible en pantalla. */
  const labelObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('label-visible');
        labelObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.6 });
  document.querySelectorAll('.section-label').forEach(el => labelObs.observe(el));

  /* Observer para títulos: activa la animación word-fly-up cuando
     el 20% del título es visible, con un margen inferior de 40px
     para que la animación se dispare un poco antes de llegar. */
  const titleObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('title-visible');
        titleObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.2, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.section-title, .cta-heading').forEach(el => titleObs.observe(el));

  /* Observer genérico para el resto de elementos (cuerpos de texto,
     iframe PiX, galería, video). Agrega .reveal al elemento para
     que empiece invisible, y luego .visible para disparar la
     animación reveal-rise definida en CSS. */
  const revealObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        revealObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

  document.querySelectorAll('.section-body, .pix-box, .gallery-carousel, .video-wrapper').forEach(el => {
    el.classList.add('reveal');
    revealObs.observe(el);
  });

  /* Las tres cards reciben un data-delay diferente (1, 2, 3) para
     que CSS les aplique un animation-delay distinto y entren
     en cascada en lugar de aparecer todas al mismo tiempo. */
  document.querySelectorAll('.comp-card').forEach((card, i) => {
    card.classList.add('reveal');
    card.dataset.delay = String(i + 1);
    revealObs.observe(card);
  });


  /* --------------------------------------------------------------
     4. TILT 3D EN LAS TARJETAS DE COMPONENTES
     Al mover el cursor sobre una card, se calcula en qué punto
     exacto del card está el cursor (normalizado entre -1 y +1
     en ambos ejes). Esos valores se usan como ángulos de rotación
     en 3D (rotateX para arriba/abajo, rotateY para izquierda/
     derecha). El máximo de inclinación es TILT_MAX grados.
     Al salir, se vacía el transform para que CSS devuelva el card
     a su posición original con su propia transición.
     -------------------------------------------------------------- */
  const TILT_MAX = 6; // grados máximos de inclinación
  document.querySelectorAll('.comp-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const r  = card.getBoundingClientRect();
      const dx = ((e.clientX - r.left) / r.width  - 0.5) * 2; // -1 a +1 horizontal
      const dy = ((e.clientY - r.top)  / r.height - 0.5) * 2; // -1 a +1 vertical
      card.style.transform = [
        'translateY(-8px)',
        `rotateX(${(-dy * TILT_MAX).toFixed(2)}deg)`,
        `rotateY(${ (dx * TILT_MAX).toFixed(2)}deg)`,
      ].join(' ');
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = ''; // CSS retoma el control con su transition
    });
  });


  /* --------------------------------------------------------------
     5. PARALLAX SUAVE EN EL CONTENIDO DEL HERO
     Mientras el usuario está dentro del hero (antes de hacer scroll
     más allá de la altura de la ventana), el logo y los botones se
     desplazan hacia arriba más lento que el scroll (factor 0.18)
     y van desapareciendo gradualmente. Esto crea la sensación de
     profundidad y hace la transición hacia la primera sección
     más fluida y cinematográfica.
     -------------------------------------------------------------- */
  const heroContent = document.querySelector('.hero-content');
  if (heroContent) {
    const onHeroScroll = () => {
      const y = window.scrollY;
      if (y < window.innerHeight) {
        heroContent.style.transform = `translateY(${y * 0.18}px)`;
        heroContent.style.opacity   = String(1 - y / (window.innerHeight * 0.75));
      }
    };
    window.addEventListener('scroll', onHeroScroll, { passive: true });
  }


})();
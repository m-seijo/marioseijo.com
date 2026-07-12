// card.js — all card behaviour: intro tumble, idle wobble, cursor tilt,
// drag-to-spin, flip, scroll/keyboard deconstruct, and the save-contact toast.
// The DOM stays the source of truth; three.js (glass.js) only enhances the
// material later.
//
// Contract with glass.js: on every frame we publish the current rotation on
// `card.dataset` (rotX/rotY/explode) so the WebGL layer can mirror the pose
// without re-implementing the input handling.

export function initCard() {
  const card = document.getElementById('card');
  const wrap = document.getElementById('cardwrap');
  if (!card || !wrap) return;

  const reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  // Rest pose is square to the viewer (no resting tilt, per design feedback
  // "at rest the front faces the viewer, square"). The idle wobble rocks it
  // gently around this.
  const restX = 0, restY = 0;
  let rotX = restX, rotY = restY;
  let dragging = false, introDone = false, flipped = false, pointerInside = false;
  let explodeF = 0;              // 0..1 deconstruction amount
  let tiltX = restX, tiltY = restY;

  const base = () => (flipped ? 180 : 0);
  function apply() {
    if (!introDone) return;
    card.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
    card.dataset.rotx = rotX.toFixed(2);
    card.dataset.roty = rotY.toFixed(2);
    card.dataset.explode = explodeF.toFixed(3);
    // Which face is toward the viewer. We drive this from JS instead of relying
    // on CSS backface-visibility: the connect icons can't carry a permanent
    // compositing layer (it breaks click hit-testing on the 3D card, see
    // card.css .pc), and without that promotion Chrome's per-child backface
    // culling/depth-sorting is unreliable — the front would show through mirrored.
    const yn = ((rotY % 360) + 360) % 360;
    card.classList.toggle('showback', yn > 90 && yn < 270);
  }

  // No intro tumble: the card starts settled and simply wobbles (per feedback).
  // introDone is true from the first frame, so apply() publishes the pose right
  // away and the glass layer fades in immediately.
  introDone = true;
  apply();

  // ---- idle wobble + cursor tilt (single rAF loop) ----
  function loop(now) {
    if (!reduce && introDone && !dragging) {
      let desX, desY;
      if (explodeF > 0.02) { desY = base() + restY - 8; desX = restX + 5; }
      else if (pointerInside) { desY = tiltY; desX = tiltX; }
      else { // the slow "I'm alive — touch me" wobble
        desY = base() + restY + 2.4 * Math.sin(now * 2 * Math.PI / 5600);
        desX = restX + 1.0 * Math.sin(now * 2 * Math.PI / 7000);
      }
      rotY += (desY - rotY) * 0.06; rotX += (desX - rotX) * 0.06; apply();
    }
    requestAnimationFrame(loop);
  }
  if (!reduce) requestAnimationFrame(loop);

  wrap.addEventListener('pointermove', (e) => {
    if (dragging) return;
    const r = wrap.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
    const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
    tiltY = base() + restY + dx * 13; tiltX = restX - dy * 11; pointerInside = true;
  });
  wrap.addEventListener('pointerleave', () => { pointerInside = false; });

  // ---- drag to spin ----
  let lx = 0, ly = 0;
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a,button')) return; // let links/buttons work
    // Clear any text selection so this drag can't be hijacked into a native
    // drag-of-selection (which fires pointercancel and would lock the spin).
    window.getSelection?.()?.removeAllRanges();
    dragging = true; lx = e.clientX; ly = e.clientY;
    card.classList.add('dragging'); card.setPointerCapture(e.pointerId);
  });
  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    rotY += (e.clientX - lx) * 0.45; rotX -= (e.clientY - ly) * 0.45; lx = e.clientX; ly = e.clientY;
    rotX = Math.max(-50, Math.min(50, rotX));
    flipped = Math.cos(rotY * Math.PI / 180) < 0; apply();
  });
  const endDrag = () => { if (!dragging) return; dragging = false; card.classList.remove('dragging'); };
  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);

  // ---- keyboard ----
  card.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft') { rotY -= 10; }
    else if (k === 'ArrowRight') { rotY += 10; }
    else if (k === 'ArrowUp') { rotX -= 8; }
    else if (k === 'ArrowDown') { rotX += 8; }
    else if (k === 'Enter' || k === ' ') { doFlip(); e.preventDefault(); return; }
    else return;
    flipped = Math.cos(rotY * Math.PI / 180) < 0; apply(); e.preventDefault();
  });

  // ---- flip ----
  function doFlip() {
    if (explodeF > 0.02) setExplode(0, true);
    flipped = !flipped;
    if (reduce) { rotY = base() + restY; rotX = restX; introDone = true; apply(); }
    // (with motion, the rAF loop eases toward the flipped pose)
  }
  document.getElementById('flip')?.addEventListener('click', doFlip);

  // ---- deconstruct: pieces fly OUTSIDE the card; buttons AND scroll wheel ----
  const pcs = Array.from(document.querySelectorAll('.face.front .pc'));
  // mark, idblock, channels(bottom-left), socials(bottom-right)
  const burst = [[-160,-130,150], [60,-190,250], [-110,180,180], [210,150,220]];
  function renderPieces(stagger) {
    // will-change only while deconstructed: a permanent hint would layer-promote
    // the pieces and break click/hover hit-testing on the resting 3D card.
    const active = explodeF > 0.001;
    pcs.forEach((el, i) => {
      const b = burst[i] || [0, 0, 140];
      el.style.willChange = active ? 'transform' : 'auto';
      el.style.transitionDelay = stagger ? (i * 0.04) + 's' : '0s';
      el.style.transform = `translate3d(${b[0]*explodeF}px, ${b[1]*explodeF}px, ${b[2]*explodeF}px)`;
    });
  }
  function setExplode(f, stagger) {
    explodeF = Math.max(0, Math.min(1, f));
    if (flipped && explodeF > 0.02) { flipped = false; rotY = base() + restY; rotX = restX; apply(); }
    renderPieces(stagger);
    if (stagger) setTimeout(() => pcs.forEach((el) => { el.style.transitionDelay = '0s'; }), 600);
  }
  document.getElementById('deconstruct')?.addEventListener('click', () => setExplode(1, true));
  document.getElementById('reassemble')?.addEventListener('click', () => setExplode(0, true));
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    setExplode(explodeF + e.deltaY * 0.0016, false);
  }, { passive: false });

  // ---- connector wires: keep the two traces aimed at their live targets -----
  // The endpoints track the '@' in the email and the LinkedIn icon's centre so
  // they stay on target at ANY card size (the icons/text are positioned in px,
  // which is a shifting fraction of the card; a static SVG path only lines up at
  // one width). offset* is used because it reports LAYOUT position, unaffected by
  // the card's 3D transform; those px map straight into the 860×500 viewBox,
  // which spans the face box 1:1.
  const face = card.querySelector('.face.front');
  const wirePaths = card.querySelectorAll('.face.front .wires path');
  const atEl = card.querySelector('.ch.u-email .at');
  const liEl = card.querySelector('.socials .soc'); // first social = LinkedIn
  function offsetIn(el, ancestor) {
    let x = 0, y = 0, n = el;
    while (n && n !== ancestor) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x, y };
  }
  function positionWires() {
    if (!face || wirePaths.length < 2 || !atEl || !liEl) return;
    const W = face.offsetWidth, H = face.offsetHeight;
    if (!W || !H) return;
    const gap = 30; // px the trace stops short of its target
    const vx = (px) => +(px / W * 860).toFixed(1);
    const vy = (px) => +(px / H * 500).toFixed(1);
    const at = offsetIn(atEl, face);
    const li = offsetIn(liEl, face);
    const atX = vx(at.x + atEl.offsetWidth / 2);
    const liX = vx(li.x + liEl.offsetWidth / 2);
    // left trace: down from the id block, across, then onto the '@'
    wirePaths[0].setAttribute('d', `M330 168 L330 330 L${atX} 330 L${atX} ${vy(at.y - gap)}`);
    // right trace: across from the id block, then down onto the LinkedIn icon
    wirePaths[1].setAttribute('d', `M405 168 L${liX} 168 L${liX} ${vy(li.y - gap)}`);
  }
  positionWires();
  window.addEventListener('resize', positionWires);
  // Fonts change text metrics → the '@' shifts; reposition once they're ready.
  if (document.fonts?.ready) document.fonts.ready.then(positionWires);

  // ---- save contact (toast only) ----
  // The href is a real hosted /mario-seijo.vcf in the HTML, so Save works with
  // JS off. Here we just confirm the download visually.
  const toast = document.getElementById('toast');
  let toastT;
  document.getElementById('saveBack')?.addEventListener('click', () => {
    if (!toast) return;
    toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toast.classList.remove('show'), 2600);
  });
}

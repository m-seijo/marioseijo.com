// card.js — all card behaviour: intro tumble, idle wobble, cursor tilt,
// drag-to-spin, flip, scroll deconstruct, and the save-contact toast.
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

  // ---- deconstruct: pieces fly OUTSIDE the card; driven by the scroll wheel ---
  const pcs = Array.from(document.querySelectorAll('.face.front .pc'));
  // mark, idblock, channels(bottom-left), socials(bottom-right)
  const burst = [[-160,-130,150], [60,-190,250], [-110,180,180], [210,150,220]];

  // The burst is authored in fixed px for the full-size card, but the viewport
  // isn't always big enough to hold it: at 1440x900 the 940x550 card leaves only
  // ~175px above and below, so `channels` (+180y) and `socials` (+150y) — plus
  // the z push, which perspective magnifies — flew clean off the bottom edge,
  // taking the email, phone and connect icons with them.
  //
  // Rather than re-tuning constants that would break at the next viewport size,
  // measure the largest scale that still keeps every piece on screen. Perspective
  // makes the projected offset a nonlinear function of z, so solve it by binary
  // search over real getBoundingClientRect() readings instead of modelling it.
  const EDGE = 24;          // keep this much clear of the viewport edge

  // Per-piece, PER-AXIS scale. A single global scalar collapses on narrow
  // viewports — a phone leaves ~15px of side room, which would clamp the whole
  // burst (including the plentiful vertical travel) down to nothing. Scaling each
  // axis independently lets a piece use the room that exists in its own
  // direction: sideways on a wide desktop, upward/downward on a tall phone.
  let fit = pcs.map(() => ({ x: 1, y: 1 }));

  const rects = () => pcs.map((el) => el.getBoundingClientRect());
  function applyBurst(scales) {
    pcs.forEach((el, i) => {
      const b = burst[i] || [0, 0, 140];
      const s = scales[i];
      el.style.transform =
        `translate3d(${b[0]*s.x}px, ${b[1]*s.y}px, ${b[2]*Math.min(s.x,s.y)}px)`;
    });
  }

  function measureFit() {
    if (!pcs.length) return;
    const savedTransition = pcs.map((el) => el.style.transition);
    pcs.forEach((el) => { el.style.transition = 'none'; });

    // The card holds two different poses across a deconstruct: the resting one it
    // starts from, and the tilt the rAF loop eases into while exploded (see the
    // explodeF branch in loop()). That tilt swings the pieces' projected
    // positions outward, so fitting only the resting pose under-estimates the
    // spread — pieces crossed the viewport edge on a real device while headless
    // (where rAF never runs, so the card never tilts) measured clean. Fit BOTH,
    // since the animation passes through everything between them.
    const savedCardTransform = card.style.transform;
    const POSE_REST = `rotateX(${restX}deg) rotateY(${base() + restY}deg)`;
    const POSE_EXPLODED = `rotateX(${restX + 5}deg) rotateY(${base() + restY - 8}deg)`;
    const setPose = (p) => { card.style.transform = p; };

    setPose(POSE_REST);
    applyBurst(pcs.map(() => ({ x: 0, y: 0 }))); const rest = rects();
    setPose(POSE_EXPLODED);
    applyBurst(pcs.map(() => ({ x: 1, y: 1 }))); const full = rects();
    const vw = window.innerWidth, vh = window.innerHeight;

    // Staying inside the viewport isn't enough to stay READABLE: at 1440x900 the
    // id block cleared the bottom edge only to land on top of the headline, and
    // the connect icons landed on the theme button. So the safe area is the band
    // between the hero text and the page chrome below the card, not the raw
    // viewport. On a landscape desktop this leaves far more room sideways than
    // vertically, which is what makes the pieces fly outward rather than up.
    const GAP = 12;
    let safeTop = EDGE, safeBottom = vh - EDGE;
    const lede = document.querySelector('.lede');
    if (lede) safeTop = Math.max(safeTop, lede.getBoundingClientRect().bottom + GAP);
    const below = ['.dock', '.sitefooter', '#theme']
      .map((s) => document.querySelector(s))
      .filter(Boolean)
      .map((el) => el.getBoundingClientRect().top)
      .filter((t) => t > 0);
    if (below.length) safeBottom = Math.min(safeBottom, Math.min(...below) - GAP);

    // Never demand better than the resting position: if the card already
    // overflows a tiny viewport, that isn't the burst's fault to fix.
    const bounds = rest.map((r) => ({
      minX: Math.min(EDGE, r.left),   maxX: Math.max(vw - EDGE, r.right),
      minY: Math.min(safeTop, r.top), maxY: Math.max(safeBottom, r.bottom),
    }));

    // Largest fraction of this axis's travel that still lands inside the bounds.
    const axis = (restNear, restFar, fullNear, fullFar, lo, hi) => {
      let s = 1;
      const outFar = fullFar - hi, travelFar = fullFar - restFar;
      if (outFar > 0 && travelFar > 0) s = Math.min(s, (travelFar - outFar) / travelFar);
      const outNear = lo - fullNear, travelNear = restNear - fullNear;
      if (outNear > 0 && travelNear > 0) s = Math.min(s, (travelNear - outNear) / travelNear);
      return Math.max(0, Math.min(1, s));
    };

    fit = pcs.map((_, i) => ({
      x: axis(rest[i].left, rest[i].right, full[i].left, full[i].right, bounds[i].minX, bounds[i].maxX),
      y: axis(rest[i].top, rest[i].bottom, full[i].top, full[i].bottom, bounds[i].minY, bounds[i].maxY),
    }));

    // z magnifies the projection, so the linear estimate above can still
    // overshoot. Verify for real and shrink whichever axis is still out.
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (const pose of [POSE_EXPLODED, POSE_REST]) {
        setPose(pose);
        applyBurst(fit);
        rects().forEach((r, i) => {
          const b = bounds[i];
          if (r.left < b.minX - 0.5 || r.right > b.maxX + 0.5) { fit[i].x *= 0.85; changed = true; }
          if (r.top < b.minY - 0.5 || r.bottom > b.maxY + 0.5) { fit[i].y *= 0.85; changed = true; }
        });
      }
      if (!changed) break;
    }

    // Order matters: put the pieces back at rest while transitions are STILL
    // off, flush that, and only then restore the transition. Restoring it first
    // makes the browser tween from the measured full-burst pose back to rest —
    // a 0.45s phantom reassemble a moment after load.
    renderPieces(false);
    card.style.transform = savedCardTransform;
    void pcs[0].offsetHeight; // flush the rest pose before transitions come back
    pcs.forEach((el, i) => { el.style.transition = savedTransition[i]; });
  }

  function renderPieces(stagger) {
    // will-change only while deconstructed: a permanent hint would layer-promote
    // the pieces and break click/hover hit-testing on the resting 3D card.
    const active = explodeF > 0.001;
    pcs.forEach((el, i) => {
      const b = burst[i] || [0, 0, 140];
      const s = fit[i] || { x: 1, y: 1 };
      const x = b[0] * s.x * explodeF;
      const y = b[1] * s.y * explodeF;
      const z = b[2] * Math.min(s.x, s.y) * explodeF;
      el.style.willChange = active ? 'transform' : 'auto';
      el.style.transitionDelay = stagger ? (i * 0.04) + 's' : '0s';
      el.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
    });
  }
  // Touch-only toggle (hidden on pointer devices via CSS). It's the single
  // deconstruct/reassemble control on phones, where `wheel` never fires.
  const explodeBtn = document.getElementById('explodeToggle');
  function syncExplodeBtn() {
    if (!explodeBtn) return;
    const open = explodeF > 0.02;
    explodeBtn.setAttribute('aria-pressed', String(open));
    explodeBtn.setAttribute('aria-label', open ? 'Reassemble the card' : 'Deconstruct the card');
  }

  function setExplode(f, stagger) {
    explodeF = Math.max(0, Math.min(1, f));
    if (flipped && explodeF > 0.02) { flipped = false; rotY = base() + restY; rotX = restX; apply(); }
    renderPieces(stagger);
    // Drives the wire glow (see .card.exploded in card.css) — :hover can't do
    // this on touch, which is where the deconstruct now lives.
    card.classList.toggle('exploded', explodeF > 0.02);
    syncExplodeBtn();
    if (stagger) setTimeout(() => pcs.forEach((el) => { el.style.transitionDelay = '0s'; }), 600);
  }

  explodeBtn?.addEventListener('click', () => setExplode(explodeF > 0.02 ? 0 : 1, true));
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
  const idEl = card.querySelector('.idblock');
  function offsetIn(el, ancestor) {
    let x = 0, y = 0, n = el;
    while (n && n !== ancestor) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x, y };
  }
  function positionWires() {
    if (!face || wirePaths.length < 2 || !atEl || !liEl || !idEl) return;
    const W = face.offsetWidth, H = face.offsetHeight;
    if (!W || !H) return;
    const gap = 30; // px the trace stops short of its target
    const vx = (px) => +(px / W * 860).toFixed(1);
    const vy = (px) => +(px / H * 500).toFixed(1);
    const at = offsetIn(atEl, face);
    const li = offsetIn(liEl, face);
    const id = offsetIn(idEl, face);
    const atX = vx(at.x + atEl.offsetWidth / 2);
    const liX = vx(li.x + liEl.offsetWidth / 2);
    // Both traces leave the id block. These used to be hardcoded viewBox
    // coordinates, which only lined up on the landscape card.
    const top = id.y + idEl.offsetHeight + 22;
    const startY = vy(top);

    if (H > W) {
      // PORTRAIT (phone): the stacked layout leaves a wide empty band between
      // the identity and the contact rows. Route both traces down the MIDDLE of
      // the card through that band — otherwise they hug the left edge and read
      // as stray stubs. The elbows land inside the band, so the empty space
      // becomes part of the composition.
      const cx = W / 2;
      const bandBottom = Math.min(at.y, li.y);
      const elbow = (t) => vy(top + (bandBottom - top) * t);
      wirePaths[0].setAttribute('d',
        `M${vx(cx - 34)} ${startY} L${vx(cx - 34)} ${elbow(0.42)} L${atX} ${elbow(0.42)} L${atX} ${vy(at.y - gap)}`);
      wirePaths[1].setAttribute('d',
        `M${vx(cx + 34)} ${startY} L${vx(cx + 34)} ${elbow(0.72)} L${liX} ${elbow(0.72)} L${liX} ${vy(li.y - gap)}`);
      return;
    }

    // LANDSCAPE (desktop): keep the original composition, anchored to the id
    // block's real box so it holds at any card width.
    const leftX = vx(id.x + idEl.offsetWidth * 0.62);
    const rightX = vx(id.x + idEl.offsetWidth + 18);
    const midY = vy((id.y + idEl.offsetHeight + at.y) / 2);
    // left trace: down from the id block, across, then onto the '@'
    wirePaths[0].setAttribute('d', `M${leftX} ${startY} L${leftX} ${midY} L${atX} ${midY} L${atX} ${vy(at.y - gap)}`);
    // right trace: across from the id block, then down onto the LinkedIn icon
    wirePaths[1].setAttribute('d', `M${rightX} ${startY} L${liX} ${startY} L${liX} ${vy(li.y - gap)}`);
  }
  positionWires();
  // Fonts change text metrics → the '@' shifts; reposition once they're ready.
  if (document.fonts?.ready) document.fonts.ready.then(positionWires);

  // measureFit() forces synchronous layout, so keep it off the first-paint path
  // (perf budget: LCP < 2.5s). It's only needed before the first deconstruct.
  const idleFit = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  idleFit(() => measureFit());
  if (document.fonts?.ready) document.fonts.ready.then(measureFit);

  let resizeT;
  window.addEventListener('resize', () => {
    positionWires();
    clearTimeout(resizeT);
    resizeT = setTimeout(measureFit, 150); // debounced: it's a layout-thrash pass
  });

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

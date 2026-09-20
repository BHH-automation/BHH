/* cards.js — shared photograph rotation and lazy loading for the nine
   experience cards. Loaded by the home page and by experiences/index.html
   so both keep the exact same hydrate, rotate and reduced motion behaviour.
   Extracted from index.html on 20 September 2026 when the full grid moved
   off the home page and onto its own page. */
function bhhReduceMotion(){
  try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; }
}

document.addEventListener('DOMContentLoaded', function() {
  // Check for form success parameter and show thank-you modal
  var params = new URLSearchParams(window.location.search);
  var successType = params.get('success');
  // A redirect that arrives without the query string leaves nothing to read, so
  // fall back to the note the form left as it submitted. See the block near the
  // end of the page for why that happens and how the note is written.
  if (!successType && window.bhhTakeThankYou) { successType = window.bhhTakeThankYou(); }
  else if (window.bhhTakeThankYou) { window.bhhTakeThankYou(); }
  if (successType) {
    // Hide the visible form behind the card. The [id] part keeps the hidden
    // detection stubs out of this, since their only concealment is display:none.
    var allForms = document.querySelectorAll('form[data-netlify][id]');
    allForms.forEach(function(f) { f.style.display = 'none'; });
    
    // Show thank-you modal
    var modalId = 'thank-you-' + successType;
    var modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      window.scrollTo(0, 0);
    }
    
    // Clean up URL after a short delay
    setTimeout(function() {
      window.history.replaceState({}, document.title, window.location.pathname);
    }, 500);
  }

  var carousels = document.querySelectorAll('.service-card-carousel');
  var phoneOrder = 0;                 // counts the phone cards so each can start slightly later

  // DEFERRED SECOND AND THIRD PHOTOS (14 September 2026).
  // Every experience card holds three photographs. Only the first now carries a src,
  // so only the first is fetched while the page is painting. The other two carry the
  // address in data-src and are fetched by hydrate() below, which runs when the card
  // comes near the screen and, at the latest, one second before that card's first
  // rotation. Nothing about the rotation itself changes.
  function hydrate(c) {
    if (!c || c.dataset.hydrated === '1') return;
    c.dataset.hydrated = '1';
    c.querySelectorAll('img[data-src]').forEach(function(im) {
      im.src = im.getAttribute('data-src');
      im.removeAttribute('data-src');
    });
  }
  /* 19 September 2026. hydrate() above was written to fetch the second and third
     photograph only when a card comes near the screen, but every card also started
     rotating the moment the page opened, and each rotation called hydrate. The
     result was that an arriving visitor downloaded about 1.4 megabytes of card
     photographs before scrolling a single line. A card now waits: nothing is
     fetched and nothing rotates until that card has come within 300 pixels of the
     screen. What a visitor sees once they reach the cards is unchanged. */
  function markSeen(c) {
    if (!c || c.dataset.seen === '1') return;
    c.dataset.seen = '1';
    hydrate(c);
    var q = c.__onSeen || [];
    c.__onSeen = [];
    q.forEach(function(fn) { try { fn(); } catch (err) {} });
  }
  function whenSeen(c, fn) {
    if (c && c.dataset.seen === '1') { fn(); return; }
    (c.__onSeen = c.__onSeen || []).push(fn);
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) {
        if (e.isIntersecting) { markSeen(e.target); io.unobserve(e.target); }
      });
    }, { rootMargin: '300px' });
    carousels.forEach(function(c) { io.observe(c); });
  } else {
    carousels.forEach(function(c) { setTimeout(function(){ markSeen(c); }, 2500); });
  }
  /* Every rotation registers the way to start itself here. Pausing clears them
     all, playing starts them again, and where the visitor has asked for less
     movement none of them is ever started. */
  var bhhRotators = [], bhhMotionRunning = false;
  function bhhRegisterRotator(start){ bhhRotators.push({start:start, ids:[]}); }
  function bhhStartRotators(){
    if(bhhMotionRunning) return;
    bhhMotionRunning = true;
    bhhRotators.forEach(function(r){ r.ids = r.start() || []; });
  }
  function bhhStopRotators(){
    bhhMotionRunning = false;
    bhhRotators.forEach(function(r){
      (r.ids||[]).forEach(function(id){ clearTimeout(id); clearInterval(id); });
      r.ids = [];
    });
  }
  function bhhSyncMotionButton(){
    var t = document.getElementById('motionToggleText');
    if(!t) return;
    var words = bhhMotionRunning ? 'Pause the photographs' : 'Play the photographs';
    t.textContent = words;
    var btn = document.getElementById('motionToggle');
    if(btn) btn.setAttribute('aria-label', words);
    var a = document.getElementById('motionBarA'), b2 = document.getElementById('motionBarB'),
        pl = document.getElementById('motionPlay');
    if(a && b2 && pl){
      a.style.display = bhhMotionRunning ? '' : 'none';
      b2.style.display = bhhMotionRunning ? '' : 'none';
      pl.style.display = bhhMotionRunning ? 'none' : '';
    }
  }
  window.bhhToggleMotion = function(){
    if(bhhMotionRunning){ bhhStopRotators(); } else { bhhStartRotators(); }
    bhhSyncMotionButton();
  };

  carousels.forEach(function(c) {
    var imgs = c.querySelectorAll('img');
    if (imgs.length < 2) { if(imgs[0]) imgs[0].style.opacity='1'; return; }
    // PHONES (max-width 767px): the nine experience cards run the SAME 3.5 second cycle
    // as desktop, but the switch is INSTANT. The phone CSS sets transition:none on these
    // images, and the outgoing and incoming photo are swapped inside one synchronous
    // block, so the browser paints a single frame in which exactly one photo is visible.
    // There is no cross fade and no frame where two pictures are blended.
    // Each card starts 260ms after the one before it, so the nine do not all switch on
    // the same frame. Scoped to the marketing grid, so the carousels inside the
    // introduction form are untouched, and skipped entirely at 768px and wider, where
    // the one second cross fade below runs exactly as live.
    if (c.closest('.services-grid') && window.matchMedia('(max-width:767px)').matches) {
      imgs[0].classList.add('active');
      for (var k = 1; k < imgs.length; k++) { imgs[k].classList.add('inactive'); }
      var pIdx = 0;
      var swap = function() {
        var from = imgs[pIdx];
        pIdx = (pIdx + 1) % imgs.length;
        var to = imgs[pIdx];
        from.classList.remove('active'); from.classList.add('inactive');
        to.classList.remove('inactive'); to.classList.add('active');
      };
      var startIn = 3500 + (phoneOrder * 260);
      phoneOrder++;
      bhhRegisterRotator(function(){
        var ids = [];
        whenSeen(c, function(){
          ids.push(setTimeout(function(){ swap(); ids.push(setInterval(swap, 3500)); }, startIn));
        });
        return ids;
      });
      return;
    }
    imgs[0].classList.add('active');
    for (var i = 1; i < imgs.length; i++) { imgs[i].classList.add('inactive'); }
    var idx = 0;
    var step = function(){
      hydrate(c);
      imgs[idx].classList.remove('active');
      imgs[idx].classList.add('inactive');
      idx = (idx + 1) % imgs.length;
      imgs[idx].classList.remove('inactive');
      imgs[idx].classList.add('active');
    };
    bhhRegisterRotator(function(){
      var ids = [];
      whenSeen(c, function(){ ids.push(setInterval(step, 3500)); });
      return ids;
    });
  });
  if(!bhhReduceMotion()){ bhhStartRotators(); }
  bhhSyncMotionButton();
});

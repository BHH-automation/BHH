/* ═══ THE SHORT ENQUIRY, SHARED BY EVERY EXPERIENCE PAGE ══════════════════════
   19 September 2026.

   Until now, pressing Enquire on an experience page sent the visitor back to the
   home page: a 519 kilobyte load and a jump of nearly seven thousand pixels to a
   form of eighteen required fields. This opens a short enquiry where the visitor
   already is. Nothing is loaded, nothing moves, and the experience is filled in
   already because the page knows which one it is.

   ONE file serves all nine pages. There is no second copy to keep in step.

   The long form on the home page is untouched and still takes the full details
   from anyone who wants to give them at once.

   The form is declared to Netlify by a hidden copy in index.html under the name
   experience-enquiry. Netlify files a submission by that name, and its own
   guidance is that a name may only be shared by forms with identical fields, so
   the hidden copy and the fields built below are kept exactly in step. It is a
   separate name from guest-enquiry-v2 so that nothing here can damage the
   enquiries the long form already collects.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var FORM_NAME = 'experience-enquiry';
  var panel = null, lastFocus = null, inerted = [];

  /* The page already carries its own name in every enquiry link. */
  function experienceName() {
    var a = document.querySelector('a[href*="?service="]');
    if (!a) return '';
    var m = (a.getAttribute('href') || '').match(/[?&]service=([^#&]*)/);
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return m[1]; }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function build(name) {
    var today = new Date().toISOString().slice(0, 10);
    var wrap = document.createElement('div');
    wrap.className = 'xq-back';
    wrap.id = 'xqBack';
    wrap.innerHTML =
      '<div class="xq-panel" role="dialog" aria-modal="true" aria-labelledby="xqTitle">' +
        '<button type="button" class="xq-close" aria-label="Close the enquiry">&times;</button>' +
        '<div class="xq-eyebrow">Your enquiry</div>' +
        '<h2 class="xq-title" id="xqTitle">' + esc(name) + '</h2>' +
        '<p class="xq-lead">Tell us your dates and who is coming. We reply personally, usually the same day.</p>' +
        '<form class="xq-form" id="xqForm" method="POST" action="/?success=guest" name="' + FORM_NAME + '" data-netlify-honeypot="bot-field">' +
          '<input type="hidden" name="form-name" value="' + FORM_NAME + '">' +
          '<input type="hidden" name="subject" id="xqSubject" value="BHH Experience Enquiry">' +
          '<input type="hidden" name="Experience Requested" value="' + esc(name) + '">' +
          '<p class="xq-hp"><label>Leave this empty <input name="bot-field"></label></p>' +

          '<div class="xq-field"><label for="xqName">Full name <span>*</span></label>' +
            '<input id="xqName" name="Full Name" type="text" autocomplete="name" required></div>' +

          '<div class="xq-field"><label for="xqEmail">Email <span>*</span></label>' +
            '<input id="xqEmail" name="email" type="email" autocomplete="email" required></div>' +

          '<div class="xq-field"><label for="xqPhone">Telephone, with country code <span>*</span></label>' +
            '<input id="xqPhone" name="Phone Number" type="tel" autocomplete="tel" placeholder="+966 50 000 0000" required></div>' +

          '<div class="xq-row">' +
            '<div class="xq-field"><label for="xqFrom">Arriving <span>*</span></label>' +
              '<input id="xqFrom" name="Date From" type="date" min="' + today + '" required></div>' +
            '<div class="xq-field"><label for="xqTo">Leaving <span>*</span></label>' +
              '<input id="xqTo" name="Date To" type="date" min="' + today + '" required></div>' +
          '</div>' +

          '<div class="xq-row">' +
            '<div class="xq-field"><label for="xqAdults">Adults <span>*</span></label>' +
              '<input id="xqAdults" name="Number of Adults" type="number" min="1" max="20" value="2" required></div>' +
            '<div class="xq-field"><label for="xqChildren">Children <span>*</span></label>' +
              '<input id="xqChildren" name="Number of Children" type="number" min="0" max="20" value="0" required></div>' +
          '</div>' +

          '<div class="xq-field"><label for="xqNotes">Anything we should know</label>' +
            '<textarea id="xqNotes" name="Special Requests" rows="3" ' +
            'placeholder="Allergies, an occasion, anything that matters to your family"></textarea></div>' +

          '<div class="xq-consent"><label><input type="checkbox" name="GDPR Consent" value="Yes" required> ' +
            '<span>I agree that British Heritage Hosts Ltd may use these details to answer my enquiry and arrange my visit, ' +
            'as set out in the <a href="/#contact">Privacy Policy</a>. <span class="xq-star">*</span></span></label></div>' +

          '<p class="xq-error" id="xqError" role="alert" hidden></p>' +
          '<button type="submit" class="xq-send">Send my enquiry</button>' +
          '<p class="xq-alt">Would you rather give us the full details? ' +
            '<a href="/?service=' + encodeURIComponent(name) + '#enquire">Open the long form</a></p>' +
        '</form>' +
        '<div class="xq-done" id="xqDone" hidden>' +
          '<div class="xq-eyebrow">Thank you</div>' +
          '<h2 class="xq-title">Your enquiry is with us</h2>' +
          '<p class="xq-lead">We reply personally, usually the same day. Please check your email, and your junk folder if it does not arrive.</p>' +
          '<button type="button" class="xq-send xq-closedone">Close</button>' +
        '</div>' +
      '</div>';
    return wrap;
  }

  /* Everything except the panel is made inert while it is open, so nothing
     behind it can take the keyboard or be clicked. */
  function background(on) {
    if (on) {
      inerted = [];
      [].slice.call(document.body.children).forEach(function (el) {
        if (el === panel || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
        if (!el.hasAttribute('inert')) { el.setAttribute('inert', ''); inerted.push(el); }
      });
    } else {
      inerted.forEach(function (el) { el.removeAttribute('inert'); });
      inerted = [];
    }
  }

  function focusables() {
    if (!panel) return [];
    return [].slice.call(panel.querySelectorAll('a[href], button, input, select, textarea'))
      .filter(function (e) {
        if (e.disabled || e.getAttribute('tabindex') === '-1') return false;
        var r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
  }

  function onKey(e) {
    if (!panel) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], here = f.indexOf(document.activeElement);
    if (e.shiftKey) { if (here <= 0) { e.preventDefault(); last.focus(); } }
    else { if (here === f.length - 1 || here === -1) { e.preventDefault(); first.focus(); } }
  }

  function close() {
    if (!panel) return;
    document.removeEventListener('keydown', onKey, true);
    background(false);
    panel.parentNode.removeChild(panel);
    panel = null;
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) { lastFocus.focus(); }
  }

  function open() {
    if (panel) return;
    var name = experienceName();
    if (!name) return;                       /* nothing to enquire about, leave the link alone */
    lastFocus = document.activeElement;
    panel = build(name);
    document.body.appendChild(panel);
    document.documentElement.style.overflow = 'hidden';
    background(true);
    document.addEventListener('keydown', onKey, true);

    panel.querySelector('.xq-close').addEventListener('click', close);
    panel.addEventListener('mousedown', function (e) { if (e.target === panel) close(); });
    var doneBtn = panel.querySelector('.xq-closedone');
    if (doneBtn) doneBtn.addEventListener('click', close);

    wire(name);
    var firstField = panel.querySelector('#xqName');
    if (firstField) firstField.focus();
  }

  function wire(name) {
    var form = panel.querySelector('#xqForm');
    var from = panel.querySelector('#xqFrom');
    var to = panel.querySelector('#xqTo');
    var err = panel.querySelector('#xqError');
    var subject = panel.querySelector('#xqSubject');

    /* leaving cannot be before arriving */
    from.addEventListener('change', function () { to.min = from.value || to.min; });

    form.addEventListener('submit', function (e) {
      err.hidden = true;
      if (from.value && to.value && to.value < from.value) {
        e.preventDefault();
        err.textContent = 'The leaving date cannot be before the arriving date.';
        err.hidden = false;
        to.focus();
        return;
      }
      /* the subject line carries the experience and the name, as the long form does */
      var who = (form.querySelector('[name="Full Name"]') || {}).value || '';
      subject.value = 'BHH Experience Enquiry — ' + name + (who ? ' — ' + who : '');

      /* Sent in the background so the visitor stays on this page. If that fails
         for any reason the form is submitted the ordinary way instead, so an
         enquiry is never silently lost. */
      if (!window.fetch || !window.FormData || !window.URLSearchParams) return;
      e.preventDefault();
      var btn = form.querySelector('.xq-send');
      btn.disabled = true; btn.textContent = 'Sending…';
      var body = new URLSearchParams(new FormData(form)).toString();
      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
      }).then(function (r) {
        if (!r.ok) throw new Error('status ' + r.status);
        form.hidden = true;
        panel.querySelector('#xqDone').hidden = false;
        var h = panel.querySelector('#xqDone .xq-title');
        if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
      }).catch(function () {
        /* form.submit() does not run these listeners again, so this simply
           posts the form the ordinary way and lets Netlify redirect. */
        btn.textContent = 'Sending\u2026';
        form.submit();
      });
    });
  }

  /* Every link that used to travel to the home page form now opens the panel. */
  function intercept(e) {
    var a = e.target.closest ? e.target.closest('a[href*="?service="]') : null;
    if (!a) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;   /* let a new tab be a new tab */
    e.preventDefault();
    open();
  }

  function start() {
    if (!experienceName()) return;
    document.addEventListener('click', intercept);
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start); }
  else { start(); }
})();

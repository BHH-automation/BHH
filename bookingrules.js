/* British Heritage Hosts Ltd, booking rules on every enquiry form
   Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd. Written 2 October 2026.

   Reads the two rules the Director sets on his own page, how many days ahead a
   family must ask for and which dates are unavailable, and applies them to
   every "Date From" and "Date To" box on the page, including the enquiry boxes
   that the experience pages build after the page has loaded. If the rules
   cannot be read, the form works exactly as before.
   5 October 2026: an Airport Transfer or a Canal Day Cruise booked on its own works to 48 hours'
   notice as a guide, not a hard rule (the Director's decision). Any date from
   today is accepted; inside 48 hours the guest sees a gentle note that we will
   confirm whether it can be arranged. Every other experience keeps the
   Director's own setting as a firm minimum. */
(function () {
  "use strict";
  var FN = "https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/Payments";
  var AR = (document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;
  var rules = null;
  var TRANSFER_GUIDE_DAYS = 2; // 48 hours, a guide only

  // Services on a 48 hour guide, with their names for the note.
  var SOFT = {
    "Airport Transfer": { en: "an airport transfer", ar: "النقل من المطار" },
    "Canal Day Cruise": { en: "a canal day cruise", ar: "الرحلة النهارية في القناة" }
  };
  // The 48 hour service this form holds on its own, or "".
  function softService(input) {
    var form = input && input.form;
    var grid = form && form.querySelector("#service-card-grid");
    if (!grid) return "";
    var picked = grid.querySelectorAll(".service-card-v8.selected");
    var svc = picked.length === 1 ? picked[0].getAttribute("data-service") : "";
    return SOFT.hasOwnProperty(svc) ? svc : "";
  }
  function transferOnly(input) { return !!softService(input); }
  // Firm days of notice for this date box: none for an Airport Transfer on its
  // own (today onwards), otherwise the Director's setting.
  function leadFor(input) {
    if (!rules) return 0;
    return transferOnly(input) ? 0 : rules.min_lead_days;
  }

  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function earliest(input) {
    var d = new Date();
    d.setDate(d.getDate() + leadFor(input));
    return iso(d);
  }
  function nice(v) {
    var d = new Date(v + "T12:00:00");
    return d.toLocaleDateString(AR ? "ar" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  }
  function note(input, text) {
    var box = input.parentNode.parentNode.querySelector("[data-bhh-rule]");
    if (!box) {
      box = document.createElement("p");
      box.setAttribute("data-bhh-rule", "");
      box.setAttribute("role", "alert");
      box.style.cssText = "font-size:0.85rem;color:#E8A0A0;margin-top:0.35rem";
      input.parentNode.parentNode.appendChild(box);
    }
    box.textContent = text || "";
    box.style.display = text ? "" : "none";
  }
  function check(input) {
    if (!rules || !input.value) { note(input, ""); return; }
    var min = earliest(input);
    var days = leadFor(input);
    var msg = "";
    if (input.value < min) {
      msg = AR
        ? "يرجى اختيار تاريخ بعد " + days + " أيام على الأقل من اليوم، حتى يتسنى لنا ترتيب حجزكم."
        : "Please choose a date at least " + days + " days from today, so we have time to arrange your booking.";
    } else if (transferOnly(input) && input.value < (function () { var d = new Date(); d.setDate(d.getDate() + TRANSFER_GUIDE_DAYS); return iso(d); })()) {
      // Inside 48 hours: accepted, with a gentle note only.
      input.setCustomValidity("");
      var soft = SOFT[softService(input)];
      note(input, AR
        ? "نحتاج عادةً إلى 48 ساعة لترتيب " + soft.ar + ". يمكنكم الإرسال، وسنؤكد لكم إن كان بالإمكان ترتيبه."
        : "We usually need 48 hours to arrange " + soft.en + ". You can still send this, and we will confirm whether we can arrange it.");
      return;
    } else if (rules.unavailable.indexOf(input.value) !== -1) {
      msg = AR
        ? "نعتذر، لا يمكننا ترتيب تجارب يوم " + nice(input.value) + ". يرجى اختيار تاريخ آخر."
        : "Sorry, we cannot arrange experiences on " + nice(input.value) + ". Please choose another date.";
    }
    input.setCustomValidity(msg);
    note(input, msg);
  }
  function apply(root) {
    if (!rules) return;
    var boxes = (root || document).querySelectorAll('input[type="date"][name="Date From"], input[type="date"][name="Date To"]');
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      b.min = earliest(b);
      if (!b.hasAttribute("data-bhh-rules")) {
        b.setAttribute("data-bhh-rules", "");
        b.addEventListener("change", function () { check(this); });
        b.addEventListener("input", function () { check(this); });
      }
    }
  }

  fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings" }) })
    .then(function (r) { return r.json(); })
    .then(function (r) {
      if (!r || !r.ok) return;
      rules = { min_lead_days: Number(r.min_lead_days) || 0, unavailable: r.unavailable || [] };
      apply(document);
      // Choosing or clearing an experience can change the notice needed.
      document.addEventListener("click", function (e) {
        if (!e.target.closest || !e.target.closest("#service-card-grid, .tchoice")) return;
        setTimeout(function () {
          apply(document);
          var boxes = document.querySelectorAll('input[type="date"][data-bhh-rules]');
          for (var i = 0; i < boxes.length; i++) if (boxes[i].value) check(boxes[i]);
        }, 0);
      });
      if (window.MutationObserver) {
        new MutationObserver(function () { apply(document); }).observe(document.body, { childList: true, subtree: true });
      }
    })
    .catch(function () {});
})();

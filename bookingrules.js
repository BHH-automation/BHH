/* British Heritage Hosts Ltd, booking rules on every enquiry form
   Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd. Written 2 October 2026.

   Reads the two rules the Director sets on his own page, how many days ahead a
   family must ask for and which dates are unavailable, and applies them to
   every "Date From" and "Date To" box on the page, including the enquiry boxes
   that the experience pages build after the page has loaded. If the rules
   cannot be read, the form works exactly as before.
   5 October 2026 (the Director's decision): an Airport Transfer or a Canal Day
   Cruise booked on its own needs 48 hours' notice. Today and tomorrow are
   blocked in the date picker, and a line under the date says why. Every other
   experience keeps the Director's own setting. */
(function () {
  "use strict";
  var FN = "https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/Payments";
  var AR = (document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;
  var rules = null;
  var TRANSFER_GUIDE_DAYS = 2; // 48 hours

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
  // Days of notice for this date box: 2 (48 hours) for an Airport Transfer or
  // Canal Day Cruise on its own, otherwise the Director's setting.
  function leadFor(input) {
    if (!rules) return 0;
    return transferOnly(input) ? TRANSFER_GUIDE_DAYS : rules.min_lead_days;
  }
  function softHint(input) {
    return AR
      ? "يجب الحجز قبل 48 ساعة على الأقل، لذلك لا يتاح اليوم والغد."
      : "Reservations must be made at least 48 hours in advance, so today and tomorrow are not available.";
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
    if (!rules) { note(input, ""); return; }
    if (!input.value) { input.setCustomValidity(""); note(input, transferOnly(input) ? softHint(input) : ""); return; }
    var min = earliest(input);
    var days = leadFor(input);
    var msg = "";
    // iPhone and some other browsers do not grey out early dates, so an early
    // choice is moved to the first date we can accept, and the guest is told.
    if (input.value < min) {
      input.value = min;
      var moved = AR ? " نقلنا التاريخ إلى " + nice(min) + "." : " We have moved your date to " + nice(min) + ".";
      var why = transferOnly(input) ? softHint(input)
        : (AR ? "يجب الحجز قبل " + days + " أيام على الأقل من اليوم، حتى يتسنى لنا ترتيب حجزكم."
              : "Bookings must be made at least " + days + " days from today, so we have time to arrange your booking.");
      if (rules.unavailable.indexOf(input.value) === -1) {
        input.setCustomValidity("");
        input.setAttribute("data-bhh-moved", input.value);
        input.setAttribute("data-bhh-moved-note", why + moved);
        note(input, why + moved);
        return;
      }
    }
    if (rules.unavailable.indexOf(input.value) !== -1) {
      msg = AR
        ? "نعتذر، لا يمكننا ترتيب تجارب يوم " + nice(input.value) + ". يرجى اختيار تاريخ آخر."
        : "Sorry, we cannot arrange experiences on " + nice(input.value) + ". Please choose another date.";
    }
    input.setCustomValidity(msg);
    // keep the "we moved your date" note while the moved date is unchanged
    if (!msg && input.getAttribute("data-bhh-moved") === input.value) msg = input.getAttribute("data-bhh-moved-note") || "";
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
      setTimeout(function () {
        var boxes = document.querySelectorAll('input[type="date"][data-bhh-rules]');
        for (var i = 0; i < boxes.length; i++) check(boxes[i]);
      }, 600);
      // Choosing or clearing an experience can change the notice needed.
      document.addEventListener("click", function (e) {
        if (!e.target.closest || !e.target.closest("#service-card-grid, .tchoice")) return;
        setTimeout(function () {
          apply(document);
          var boxes = document.querySelectorAll('input[type="date"][data-bhh-rules]');
          for (var i = 0; i < boxes.length; i++) check(boxes[i]);
        }, 0);
      });
      if (window.MutationObserver) {
        new MutationObserver(function () { apply(document); }).observe(document.body, { childList: true, subtree: true });
      }
    })
    .catch(function () {});
})();

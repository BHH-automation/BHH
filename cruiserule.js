/* British Heritage Hosts: services booked on their own.
   Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd. Written 3 October 2026.

   The Canal Day Cruise and the Airport Transfer carry passengers, which is a
   different kind of travel service from a dinner, a tea or a guide. Sold
   together for one trip they could form a package, so each is booked on its
   own, never in the same booking as any other experience. In the guest enquiry
   grid, choosing one of them clears the others, and choosing anything else
   clears it, with a short note saying why. The Director page and the payment
   system apply the same rule. Works on English and Arabic pages. */
(function () {
  "use strict";
  var SOLO = { "Canal Day Cruise": "الرحلة النهارية في القناة", "Airport Transfer": "النقل من المطار" };
  var grid = document.getElementById("service-card-grid");
  if (!grid || typeof window.toggleService !== "function") return;
  var ar = (document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;
  var note = document.getElementById("cruise-solo-note");
  var original = window.toggleService;

  function say(text) {
    if (!note) return;
    note.textContent = text;
    note.style.display = text ? "" : "none";
  }
  function nameOf(svc) { return ar ? SOLO[svc] : "The " + svc; }

  window.toggleService = function (card) {
    var selecting = card && !card.classList.contains("selected");
    if (selecting) {
      var mine = card.getAttribute("data-service");
      var isSolo = SOLO.hasOwnProperty(mine);
      var clearedSolo = "";
      var cleared = 0;
      Array.prototype.forEach.call(grid.querySelectorAll(".service-card-v8.selected"), function (other) {
        if (other === card) return;
        var theirs = other.getAttribute("data-service");
        if (isSolo || SOLO.hasOwnProperty(theirs)) {
          if (SOLO.hasOwnProperty(theirs)) clearedSolo = theirs;
          original(other); cleared++;
        }
      });
      if (!cleared) say("");
      else if (isSolo) say(ar
        ? nameOf(mine) + " يُحجز وحده، لذلك أُلغي اختيار التجارب الأخرى. يمكنكم إرسال طلب منفصل لها."
        : nameOf(mine) + " is booked on its own, so the other experiences have been cleared. You can send a separate enquiry for them.");
      else say(ar
        ? "أُلغي اختيار " + nameOf(clearedSolo) + " لأنه يُحجز وحده. يمكنكم إرسال طلب منفصل له."
        : nameOf(clearedSolo) + " has been cleared because it is booked on its own. You can send a separate enquiry for it.");
    }
    var out = original(card);
    setTimeout(syncOneDay, 0);
    return out;
  };

  // 5 October 2026: an Airport Transfer or a Canal Day Cruise happens on one
  // day, so the form asks for one date only. The second date box is hidden
  // and quietly given the same date, so the enquiry still arrives complete.
  function syncOneDay() {
    var form = grid.closest("form");
    var from = form && form.querySelector('input[name="Date From"]');
    var to = form && form.querySelector('input[name="Date To"]');
    if (!from || !to) return;
    var picked = grid.querySelectorAll(".service-card-v8.selected");
    var one = picked.length === 1 && SOLO.hasOwnProperty(picked[0].getAttribute("data-service"));
    var row = to.parentNode;
    var others = Array.prototype.filter.call(row.children, function (c) { return c !== from; });
    var more = document.getElementById("bhhMoreExp");
    var label = form.querySelector('label[for="' + from.id + '"]');
    var hint = row.parentNode.querySelector("p[style*='italic']");
    if (label && !label.hasAttribute("data-orig")) label.setAttribute("data-orig", label.innerHTML);
    if (one) {
      to.required = false; to.value = from.value;
      others.forEach(function (c) { c.style.setProperty("display", "none", "important"); });
      if (more) more.style.setProperty("display", "none", "important");
      if (hint) hint.style.display = "none";
      if (label) label.innerHTML = (ar ? "التاريخ" : "Date") + ' <span style="color:#C9A84C">*</span>';
      form.setAttribute("data-one-day", "1");
    } else if (form.getAttribute("data-one-day")) {
      to.required = true;
      others.forEach(function (c) { c.style.removeProperty("display"); });
      if (more) more.style.removeProperty("display");
      if (hint) hint.style.display = "";
      if (label) label.innerHTML = label.getAttribute("data-orig");
      form.removeAttribute("data-one-day");
    }
  }
  (function () {
    var form = grid.closest("form");
    if (!form) return;
    var from = form.querySelector('input[name="Date From"]');
    var to = form.querySelector('input[name="Date To"]');
    function copy() { if (form.getAttribute("data-one-day") && from && to) to.value = from.value; }
    if (from) { from.addEventListener("change", copy); from.addEventListener("input", copy); }
    form.addEventListener("submit", copy, true);
    // Fast request: every experience in a guest enquiry is also sent straight
    // to the BHH system, which asks that service's partners at once. The
    // normal enquiry still goes through as before.
    var NAMES = { "Dinner": "British Dinner", "Cultural Immersion Program": "Cultural Immersion Programme" };
    form.addEventListener("submit", function (e) {
      if (e.defaultPrevented) return;
      function v(n) { var f = form.elements[n]; return f ? String(f.value || "").trim() : ""; }
      var picked = grid.querySelectorAll(".service-card-v8.selected");
      Array.prototype.forEach.call(picked, function (card) {
        var svc = card.getAttribute("data-service");
        try {
          fetch("https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/Payments", {
            method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "rapid", lang: ar ? "ar" : "en", service: NAMES[svc] || svc,
              name: v("Full Name"), email: v("email"), country_code: v("Country Code"), phone: v("Phone Number"),
              date: v("Date From"), date_to: form.getAttribute("data-one-day") ? "" : v("Date To"),
              adults: v("Number of Adults"), children: v("Number of Children"),
              details: v("Special Requests"), website: v("bot-field") })
          }).catch(function () {});
        } catch (err) {}
      });
    }, false);
    grid.addEventListener("click", function () { setTimeout(syncOneDay, 0); });
    setTimeout(syncOneDay, 300); setTimeout(syncOneDay, 1500);
  })();

  // Used by the "Book My Airport Transfer" choice in the Transport tab.
  window.bhhBookOnItsOwn = function (svc) {
    if (typeof window.switchTab === "function") window.switchTab("guest");
    var card = grid.querySelector('.service-card-v8[data-service="' + svc + '"]');
    if (card && !card.classList.contains("selected")) window.toggleService(card);
    var pimg = document.querySelector("#tab-guest > img");
    var PIC = { "Airport Transfer": "/images/airport-private-transportation-airport-p.jpg", "Canal Day Cruise": "/images/narrowboat cabin tea.webp" };
    if (pimg && PIC[svc]) {
      if (!pimg.getAttribute("data-orig")) { pimg.setAttribute("data-orig", pimg.getAttribute("src")); pimg.setAttribute("data-orig-alt", pimg.alt); }
      pimg.src = PIC[svc];
    }
    syncOneDay();
    grid.scrollIntoView({ behavior: "smooth", block: "center" });
  };
})();

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
    return original(card);
  };

  // Used by the "Book My Airport Transfer" choice in the Transport tab.
  window.bhhBookOnItsOwn = function (svc) {
    if (typeof window.switchTab === "function") window.switchTab("guest");
    var card = grid.querySelector('.service-card-v8[data-service="' + svc + '"]');
    if (card && !card.classList.contains("selected")) window.toggleService(card);
    grid.scrollIntoView({ behavior: "smooth", block: "center" });
  };
})();

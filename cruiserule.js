/* British Heritage Hosts: the Canal Day Cruise is booked on its own.
   Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd. Written 3 October 2026.

   A boat carrying passengers is a different kind of travel service from a dinner,
   a tea or a guide. Sold together for one trip they could form a package, so the
   cruise is never in the same booking as another experience. In the guest
   enquiry grid, choosing the cruise clears the others, and choosing another
   experience clears the cruise, with a short note saying why. The Director page
   and the payment system apply the same rule. Works on English and Arabic pages. */
(function () {
  "use strict";
  var SOLO = "Canal Day Cruise";
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

  window.toggleService = function (card) {
    var selecting = card && !card.classList.contains("selected");
    if (selecting) {
      var isSolo = card.getAttribute("data-service") === SOLO;
      var cleared = 0;
      Array.prototype.forEach.call(grid.querySelectorAll(".service-card-v8.selected"), function (other) {
        if (other === card) return;
        var otherSolo = other.getAttribute("data-service") === SOLO;
        if (isSolo || otherSolo) { original(other); cleared++; }
      });
      if (cleared) {
        say(isSolo
          ? (ar ? "تُحجز الرحلة النهارية في القناة وحدها، لذلك أُلغي اختيار التجارب الأخرى. يمكنكم إرسال طلب منفصل لها."
                : "The Canal Day Cruise is booked on its own, so the other experiences have been cleared. You can send a separate enquiry for them.")
          : (ar ? "أُلغي اختيار الرحلة النهارية في القناة لأنها تُحجز وحدها. يمكنكم إرسال طلب منفصل لها."
                : "The Canal Day Cruise has been cleared because it is booked on its own. You can send a separate enquiry for it."));
      } else {
        say("");
      }
    }
    return original(card);
  };
})();

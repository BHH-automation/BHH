/* British Heritage Hosts: a small button on each of the nine experience tiles.
   Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd. Written 14 October 2026.

   The Director's decision (14 October 2026): each tile on the "Nine signature
   experiences" showcase gets a gold button in its top right corner that takes
   the guest straight to the right form with that experience already chosen.
   The seven experiences BHH sells say "Book". The Narrowboat Holiday, which
   BHH only introduces, says "Introduce". Transportation, where BHH sells
   the Airport Transfer but only introduces Chauffeured Hire, says "Options"
   and opens the choice between the two (shorter words so they fit a phone). Tapping the rest of the tile works as before.
   Works on the English and Arabic pages. */
(function () {
  "use strict";
  var grid = document.getElementById("servicesPreviewGrid");
  if (!grid) return;
  var AR = (document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;
  // tile number (data-i) : what the button does
  var MAP = {
    0: { kind: "book", svc: "English Tea" },
    1: { kind: "book", svc: "Dinner" },
    2: { kind: "book", svc: "Riverside Grill" },
    3: { kind: "book", svc: "Heritage Guide" },
    4: { kind: "book", svc: "Canal Day Cruise" },
    5: { kind: "intro", mode: "narrowboat" },
    6: { kind: "both" },
    7: { kind: "book", svc: "Cultural Immersion Program" },
    8: { kind: "book", svc: "Personal Interpreter Service" }
  };
  var WORDS = AR
    ? { book: "احجزوا", intro: "تعريف", both: "الخيارات" }
    : { book: "Book", intro: "Introduce", both: "Options" };

  var css = document.createElement("style");
  css.textContent =
    ".services-preview__book{position:absolute;top:0.3rem;" + (AR ? "left" : "right") + ":0.3rem;z-index:2;" +
    "background:var(--gold,#C9A84C);color:#0D1B2A;font-family:var(--ff-body);font-weight:700;font-size:0.6rem;" +
    "letter-spacing:0.03em;line-height:1;padding:0.32rem 0.5rem;border-radius:999px;white-space:nowrap;cursor:pointer;" +
    "box-shadow:0 1px 3px rgba(13,27,42,0.35)}" +
    ".services-preview__book:hover,.services-preview__book:focus-visible{background:#fff;outline:none}" +
    "@media (max-width:900px){.services-preview__book{font-size:0.62rem}}";
  document.head.appendChild(css);

  Array.prototype.forEach.call(grid.querySelectorAll(".services-preview__tile"), function (tile) {
    var m = MAP[tile.getAttribute("data-i")];
    if (!m || tile.querySelector(".services-preview__book")) return;
    var b = document.createElement("span");
    b.className = "services-preview__book";
    b.setAttribute("role", "link");
    b.setAttribute("tabindex", "0");
    b.setAttribute("data-i", tile.getAttribute("data-i"));
    b.textContent = WORDS[m.kind] + (AR ? " ‹" : " ›");
    tile.appendChild(b);
  });

  function only(tab) { if (typeof window.bhhOnlyTab === "function") window.bhhOnlyTab(tab); }
  function land() {
    var el = document.getElementById("enquire");
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function go(i) {
    var m = MAP[i]; if (!m) return;
    // A page without the booking form (the experiences page) sends the
    // guest to the home page form, which opens with the right choice.
    if (!document.getElementById("service-card-grid")) {
      var home = AR ? "/ar/" : "/";
      window.location.href = m.kind === "book" ? home + "?service=" + encodeURIComponent(m.svc) + "#enquire"
        : home + "?transport=" + (m.kind === "intro" ? "narrowboat" : "transport") + "#enquire";
      return;
    }
    if (m.kind === "book") {
      if (typeof window.switchTab === "function") window.switchTab("guest");
      only("guest");
      var card = document.querySelector('#service-card-grid .service-card-v8[data-service="' + m.svc + '"]');
      if (card && !card.classList.contains("selected") && typeof window.toggleService === "function") window.toggleService(card);
    } else if (m.kind === "intro") {
      if (typeof window.goToTransportTab === "function") window.goToTransportTab(m.mode);
      only("transport");
    } else {
      if (typeof window.goToTransportTab === "function") window.goToTransportTab();
      only("transport");
    }
    land();
  }
  // Runs before the tile's own click, so the tile's showcase does not open.
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".services-preview__book");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    go(b.getAttribute("data-i"));
  }, true);
  document.addEventListener("keydown", function (e) {
    var b = e.target.closest && e.target.closest(".services-preview__book");
    if (!b || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); e.stopPropagation();
    go(b.getAttribute("data-i"));
  }, true);
})();

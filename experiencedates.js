/* British Heritage Hosts: a date for each experience on the guest enquiry form.
   Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd. Written 13 October 2026.

   The Director's decision (13 October 2026): a family may want a dinner on one
   day and a guide on another, and an airport transfer can be asked for today
   while a dinner needs more notice. So the single "Preferred dates" box is
   replaced by one date box under the experiences, one for each experience the
   family ticks. Each box follows that experience's own notice rule (the
   Airport Transfer and the Canal Day Cruise from today, everything else the
   Director's notice in days) and the dates the Director marked unavailable.

   The old Date From and Date To fields stay in the form, out of sight, and are
   filled with the first and last chosen dates, so the enquiry email and every
   older script still work. All the dates also go in "Experience Dates", and
   each partner request is sent with its own experience's date. Works on the
   English and Arabic pages. */
(function () {
  "use strict";
  var FN = "https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/Payments";
  var grid = document.getElementById("service-card-grid");
  if (!grid) return;
  var form = grid.closest("form");
  var from = form && form.querySelector('input[name="Date From"]');
  var to = form && form.querySelector('input[name="Date To"]');
  if (!form || !from || !to) return;
  var AR = (document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;
  var SAME_DAY = { "Airport Transfer": 1, "Canal Day Cruise": 1 };
  // 14 October 2026 (the Director's decision): these can last several days,
  // so they get a "from" and a "to" date.
  var RANGE = { "Heritage Guide": 1, "Cultural Immersion Program": 1, "Personal Interpreter Service": 1 };
  var rules = { min_lead_days: 7, unavailable: [] };

  // The old dates box is kept but taken out of sight (not display:none, so it
  // is still sent with the form).
  var oldGroup = from.closest(".form-group");
  if (oldGroup) {
    oldGroup.style.cssText += ";height:0;overflow:hidden;margin:0;padding:0;opacity:0;pointer-events:none";
    oldGroup.setAttribute("aria-hidden", "true");
  }
  from.required = false; to.required = false;
  from.tabIndex = -1; to.tabIndex = -1;

  var all = document.createElement("input");
  all.type = "hidden"; all.name = "Experience Dates";
  form.appendChild(all);

  var box = document.createElement("div");
  box.className = "form-group";
  box.id = "bhh-exp-dates";
  box.style.display = "none";
  box.innerHTML = '<label>' + (AR ? "تاريخ كل تجربة" : "Date for each experience") + ' <span style="color:#C9A84C">*</span></label>' +
    '<p class="bhh-exp-hint" style="font-size:0.82rem;margin:-0.2rem 0 0.8rem;font-style:italic">' +
    (AR ? "اختاروا تاريخًا لكل تجربة، ويمكن أن تختلف التواريخ من تجربة إلى أخرى. للمرشد وبرنامج الانغماس والمترجم اختاروا تاريخ البداية والنهاية."
        : "Choose a date for each experience. Each one can be on a different day. For the guide, the immersion programme and the interpreter, choose a start and an end date.") + "</p>" +
    '<div class="bhh-exp-rows"></div>';
  var tier = document.getElementById("per-service-tier-container");
  var anchor = tier || grid.closest(".form-group");
  anchor.parentNode.insertBefore(box, anchor.nextSibling);
  var rowsEl = box.querySelector(".bhh-exp-rows");
  // Same look as the hint under "Experiences of Interest".
  var hintSrc = grid.closest(".form-group").querySelector("p[style*='italic']");
  var hintEl = box.querySelector(".bhh-exp-hint");
  if (hintSrc) hintEl.style.cssText = hintSrc.style.cssText;
  hintEl.style.setProperty("color", hintSrc ? getComputedStyle(hintSrc).color : "#666055", "important");
  var kept = {}, keptTo = {}; // dates already typed, kept when cards are ticked again

  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function earliest(svc) { var d = new Date(); d.setDate(d.getDate() + (SAME_DAY[svc] ? 0 : rules.min_lead_days)); return iso(d); }
  function nice(v) { return new Date(v + "T12:00:00").toLocaleDateString(AR ? "ar-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric" }); }
  function picked() {
    return Array.prototype.map.call(grid.querySelectorAll(".service-card-v8.selected"), function (c) {
      var l = c.querySelector(".svc-label");
      return { svc: c.getAttribute("data-service"), label: l ? l.textContent.trim() : c.getAttribute("data-service") };
    });
  }

  function note(row, text) { var p = row.querySelector(".bhh-exp-note"); p.textContent = text || ""; p.style.display = text ? "" : "none"; }
  function check(input) {
    var row = input.closest(".bhh-exp-row"), svc = input.getAttribute("data-exp-date");
    kept[svc] = input.value;
    if (!input.value) { input.setCustomValidity(""); note(row, ""); return; }
    var min = earliest(svc);
    if (input.value < min) {
      input.value = min; kept[svc] = min;
      note(row, SAME_DAY[svc]
        ? (AR ? "لا يمكن الحجز لتاريخ مضى. نقلنا التاريخ إلى " + nice(min) + "." : "Please choose today or a later date. We have moved it to " + nice(min) + ".")
        : (AR ? "يجب الحجز قبل " + rules.min_lead_days + " أيام على الأقل. نقلنا التاريخ إلى " + nice(min) + "."
              : "This experience needs at least " + rules.min_lead_days + " days' notice. We have moved it to " + nice(min) + "."));
    } else note(row, "");
    if (rules.unavailable.indexOf(input.value) !== -1) {
      var msg = AR ? "نعتذر، لا يمكننا ترتيب تجارب يوم " + nice(input.value) + ". يرجى اختيار تاريخ آخر."
                   : "Sorry, we cannot arrange experiences on " + nice(input.value) + ". Please choose another date.";
      input.setCustomValidity(msg); note(row, msg);
    } else input.setCustomValidity("");
    fill();
  }

  // Copies the chosen dates into the fields that are sent.
  function checkTo(input) {
    var row = input.closest(".bhh-exp-row"), svc = input.getAttribute("data-exp-to");
    var start = row.querySelector("input[data-exp-date]").value;
    keptTo[svc] = input.value;
    if (input.value && start && input.value < start) {
      input.value = start; keptTo[svc] = start;
      note(row, AR ? "يجب أن يكون تاريخ النهاية بعد تاريخ البداية أو في اليوم نفسه." : "The end date must be on or after the start date.");
    }
    fill();
  }
  function fill() {
    var inputs = rowsEl.querySelectorAll("input[data-exp-date]"), dates = [], parts = [];
    Array.prototype.forEach.call(inputs, function (i) {
      if (!i.value) return;
      var end = i.closest(".bhh-exp-row").querySelector("input[data-exp-to]");
      var last = end && end.value && end.value > i.value ? end.value : "";
      dates.push(i.value); if (last) dates.push(last);
      parts.push(i.getAttribute("data-exp-label") + ": " + i.value + (last ? " to " + last : ""));
    });
    dates.sort();
    from.value = dates[0] || "";
    to.value = dates.length ? (dates.length > 1 ? dates[dates.length - 1] : dates[0]) : "";
    all.value = parts.join("; ");
  }

  var svcLabel = grid.querySelector(".svc-label");
  var labelColor = svcLabel ? getComputedStyle(svcLabel).color : "#1A1A1A";
  function draw() {
    var list = picked();
    box.style.display = list.length ? "" : "none";
    rowsEl.innerHTML = list.map(function (x) {
      var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
      return '<div class="bhh-exp-row" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:0.6rem">' +
        '<span style="flex:1 1 180px;color:' + labelColor + '">' + esc(x.label) + "</span>" +
        (RANGE[x.svc]
          ? '<span style="flex:2 1 260px;display:flex;gap:8px;align-items:center">' +
            '<input type="date" required data-exp-date="' + esc(x.svc) + '" data-exp-label="' + esc(x.label) + '" min="' + earliest(x.svc) + '" value="' + esc(kept[x.svc] || "") + '" style="flex:1;min-width:0" aria-label="' + esc(x.label) + (AR ? "، من" : ", from") + '">' +
            '<span style="color:' + labelColor + ';opacity:0.6;font-size:0.85rem">' + (AR ? "إلى" : "to") + "</span>" +
            '<input type="date" required data-exp-to="' + esc(x.svc) + '" min="' + earliest(x.svc) + '" value="' + esc(keptTo[x.svc] || "") + '" style="flex:1;min-width:0" aria-label="' + esc(x.label) + (AR ? "، إلى" : ", to") + '"></span>'
          : '<input type="date" required data-exp-date="' + esc(x.svc) + '" data-exp-label="' + esc(x.label) + '" min="' + earliest(x.svc) + '" value="' + esc(kept[x.svc] || "") + '" style="flex:1 1 180px" aria-label="' + esc(x.label) + '">') +
        '<p class="bhh-exp-note" role="alert" style="display:none;flex-basis:100%;font-size:0.85rem;color:#B5503F;margin:0.2rem 0 0"></p></div>';
    }).join("");
    Array.prototype.forEach.call(rowsEl.querySelectorAll("input[data-exp-date]"), function (i) {
      i.addEventListener("change", function () { check(i); var e = i.closest(".bhh-exp-row").querySelector("input[data-exp-to]"); if (e) { e.min = i.value || e.min; if (e.value) checkTo(e); } });
      i.addEventListener("input", function () { check(i); });
    });
    Array.prototype.forEach.call(rowsEl.querySelectorAll("input[data-exp-to]"), function (i) {
      i.addEventListener("change", function () { checkTo(i); });
    });
    fill();
  }

  new MutationObserver(draw).observe(grid, { attributes: true, attributeFilter: ["class"], subtree: true });
  form.addEventListener("submit", fill, true);
  draw();

  fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings" }) })
    .then(function (r) { return r.json(); })
    .then(function (r) {
      if (!r || !r.ok) return;
      rules = { min_lead_days: Number(r.min_lead_days) || 0, unavailable: r.unavailable || [] };
      draw();
    }).catch(function () {});

  // Used by cruiserule.js: the date chosen for one experience.
  window.bhhExperienceDate = function (svc) {
    var i = rowsEl.querySelector('input[data-exp-date="' + svc + '"]');
    return i ? i.value : "";
  };
  // The end date for an experience that lasts several days, or "".
  window.bhhExperienceDateTo = function (svc) {
    var i = rowsEl.querySelector('input[data-exp-to="' + svc + '"]');
    return i && i.value ? i.value : "";
  };
})();

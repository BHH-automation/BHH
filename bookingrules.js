/* British Heritage Hosts Ltd, booking rules on every enquiry form
   Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd. Written 2 October 2026.

   Reads the two rules the Director sets on his own page, how many days ahead a
   family must ask for and which dates are unavailable, and applies them to
   every "Date From" and "Date To" box on the page, including the enquiry boxes
   that the experience pages build after the page has loaded. If the rules
   cannot be read, the form works exactly as before. */
(function () {
  "use strict";
  var FN = "https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/payments";
  var AR = (document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;
  var rules = null;

  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function earliest() {
    var d = new Date();
    d.setDate(d.getDate() + (rules ? rules.min_lead_days : 0));
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
    var min = earliest();
    var msg = "";
    if (input.value < min) {
      msg = AR
        ? "يرجى اختيار تاريخ بعد " + rules.min_lead_days + " أيام على الأقل من اليوم، حتى يتسنى لنا ترتيب المضيف أو المرشد."
        : "Please choose a date at least " + rules.min_lead_days + " days from today, so we have time to arrange your host or guide.";
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
      var min = earliest();
      if (!b.min || b.min < min) b.min = min;
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
      if (window.MutationObserver) {
        new MutationObserver(function () { apply(document); }).observe(document.body, { childList: true, subtree: true });
      }
    })
    .catch(function () {});
})();

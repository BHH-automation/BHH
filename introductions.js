/* British Heritage Hosts: introduction requests for transport and boat partners.
   Owner: Faleh al Bishi, Director, British Heritage Hosts Ltd. Written 3 October 2026.

   The "Request an introduction" form no longer goes to Netlify. It goes to the
   BHH system (the Payments function), which keeps a full day between a BHH
   payment and an introduction for the same guest, so the two can never form a
   linked travel arrangement. If the guest paid BHH less than a day ago, the
   request is accepted and held, and the guest is told the day and time the
   provider's details will be emailed. Works on the English and Arabic pages. */
(function () {
  "use strict";
  var FN = "https://pwqdzitsezblncmewxsf.supabase.co/functions/v1/Payments";
  var form = document.getElementById("introduce-form");
  if (!form) return;
  var ar = (document.documentElement.lang || "").toLowerCase().indexOf("ar") === 0;

  var T = ar ? {
    sending: "جارٍ الإرسال…",
    ready: "شكرًا لكم. وصلنا طلبكم، وسنرسل إليكم بيانات المزوّد بالبريد الإلكتروني، غالبًا في اليوم نفسه. يكون الحجز والدفع مع المزوّد مباشرة.",
    held: function (t) { return "شكرًا لكم. وصلنا طلبكم، وسنرسل إليكم بيانات المزوّد بالبريد الإلكتروني يوم " + t + " بتوقيت لندن. يكون الحجز والدفع مع المزوّد مباشرة."; },
    failed: "تعذّر إرسال طلبكم. يرجى المحاولة مرة أخرى، أو مراسلتنا على info@britishheritagehosts.com."
  } : {
    sending: "Sending…",
    ready: "Thank you. Your request has reached us and we will email you the provider's details, usually the same day. The booking and the payment are made directly with the provider.",
    held: function (t) { return "Thank you. Your request has reached us and we will email you the provider's details on " + t + ", London time. The booking and the payment are made directly with the provider."; },
    failed: "Your request could not be sent. Please try again, or write to us at info@britishheritagehosts.com."
  };

  function val(name) { var f = form.elements[name]; return f ? String(f.value || "").trim() : ""; }
  function box(text, good) {
    var d = document.createElement("div");
    d.className = "bhh-intro-msg";
    d.setAttribute("role", "status");
    d.style.cssText = "margin-top:1.2rem;padding:1rem 1.1rem;border-radius:4px;font-size:0.95rem;line-height:1.7;" +
      (good ? "background:#F5F0E8;border:1px solid #C9A84C;color:#0D1B2A"
            : "background:#FBEDED;border:1px solid #E7C3C3;color:#8A2B2B");
    d.textContent = text;
    return d;
  }

  form.addEventListener("submit", function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    var old = form.querySelector(".bhh-intro-msg");
    if (old) old.remove();
    var btn = form.querySelector('button[type="submit"]');
    var label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = T.sending; }

    var consent = form.elements["GDPR Consent"];
    var body = {
      action: "introduce",
      lang: ar ? "ar" : "en",
      service: val("Partner Service"),
      name: val("Full Name"),
      email: val("email"),
      country_code: val("Country Code"),
      phone: val("Phone Number"),
      date_from: val("Date From"),
      date_to: val("Date To"),
      party_size: val("Party Size"),
      notes: val("Notes"),
      website: val("bot-field"),
      consent: !!(consent && consent.checked)
    };

    fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.message) || "");
        var msg = r.held ? T.held(r.release_text) : T.ready;
        form.reset();
        Array.prototype.forEach.call(form.children, function (c) { c.style.display = "none"; });
        form.appendChild(box(msg, true));
        form.scrollIntoView({ behavior: "smooth", block: "center" });
      })
      .catch(function (err) {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        var m = err && err.message && !(err instanceof TypeError) && !(err instanceof SyntaxError) ? err.message : T.failed;
        (btn ? btn.parentNode : form).appendChild(box(m, false));
      });
  });
})();

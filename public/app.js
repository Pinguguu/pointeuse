(() => {
  const $ = id => document.getElementById(id);

  // ---------- Dates & durées ----------
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
  const isoWeek = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const k = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - k); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 864e5 + 1) / 7); };
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const toMin = s => { if (!s) return null; const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const dur = m => { if (m == null) return "—"; const s = m < 0 ? "−" : ""; m = Math.abs(Math.round(m)); return `${s}${Math.floor(m / 60)} h ${pad(m % 60)}`; };
  const fr = (d, o) => d.toLocaleDateString("fr-FR", o);
  const dayName = d => fr(d, { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");

  // ---------- État ----------
  const DEFAULTS = { weekly: 35 };
  const S = { months: {}, plans: {}, settings: { ...DEFAULTS } };
  const now = () => new Date();

  const span = (a, b) => { let x = toMin(b) - toMin(a); if (x < 0) x += 1440; return x; };
  // Pause comprise dans les horaires (restauration) : temps travaillé = arrivée → départ, rien n'est déduit.
  function worked(e, live) {
    if (!e || e.off || !e.in) return null;
    let out = e.out; if (!out) { if (!live) return null; out = hm(now()); }
    return span(e.in, out);
  }
  function planned(p) { if (!p || p.off || !p.start || !p.end) return null; return span(p.start, p.end); }
  const entry = ds => (S.months[ds.slice(0, 7)] || {})[ds];
  const planFor = ds => (S.plans[ymd(monday(parse(ds)))] || {})[ds];

  // ---------- Stockage (serveur, avec copie sur l'appareil) ----------
  // Chaque document (un mois, une semaine de planning, les réglages) est envoyé au serveur.
  // Tant qu'un envoi n'a pas abouti (réseau coupé en cuisine, par exemple), il reste dans le
  // navigateur et repart dès que la connexion revient.
  let me = null, offline = false, pending = {};
  function docName(kind, key) { return kind === "m" ? "m-" + key : kind === "p" ? "p-" + key : "settings"; }
  function applyDoc(id, data) {
    if (id === "settings") S.settings = { ...DEFAULTS, ...(data || {}) };
    else if (id.startsWith("m-")) { if (data && data.days && Object.keys(data.days).length) S.months[id.slice(2)] = data.days; else delete S.months[id.slice(2)]; }
    else if (id.startsWith("p-")) { if (data && data.days && Object.keys(data.days).length) S.plans[id.slice(2)] = data.days; else delete S.plans[id.slice(2)]; }
  }
  function bodyOf(id) {
    if (id === "settings") return { ...S.settings };
    if (id.startsWith("m-")) return { days: S.months[id.slice(2)] || {} };
    return { days: S.plans[id.slice(2)] || {} };
  }
  const lsRead = k => { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch { return {}; } };
  const lsWrite = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const lsDel = k => { try { localStorage.removeItem(k); } catch {} };
  const cacheKey = () => "pointeuse-cache:" + me, pendKey = () => "pointeuse-pending:" + me;
  function saveCache() {
    const all = { settings: bodyOf("settings") };
    Object.keys(S.months).forEach(k => all["m-" + k] = bodyOf("m-" + k));
    Object.keys(S.plans).forEach(k => all["p-" + k] = bodyOf("p-" + k));
    lsWrite(cacheKey(), all);
  }

  async function api(method, path, body) {
    const opts = { method, credentials: "same-origin", headers: {} };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, opts); } catch { throw { status: 0, message: "Connexion impossible. Vérifiez le réseau puis réessayez." }; }
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) throw { status: res.status, message: (data && data.error) || "Erreur du serveur. Réessayez dans un instant.", inviteRequired: !!(data && data.inviteRequired) };
    return data;
  }

  let flushing = null, flushAgain = false;
  function flush() {
    if (flushing) { flushAgain = true; return flushing; }
    flushing = (async () => {
      for (const id of Object.keys(pending)) {
        const body = pending[id];
        try { await api("PUT", "/api/docs/" + encodeURIComponent(id), body); if (pending[id] === body) delete pending[id]; offline = false; }
        catch (e) {
          if (e.status === 401) { sessionLost(); return; }
          if (e.status === 0 || e.status === 429 || e.status >= 500) { offline = e.status === 0; break; }
          delete pending[id]; toast(e.message); // refus définitif : inutile de renvoyer
        }
      }
      lsWrite(pendKey(), pending); renderSync();
    })().finally(() => { flushing = null; if (flushAgain) { flushAgain = false; flush(); } });
    return flushing;
  }
  function persist(id) {
    pending[id] = JSON.parse(JSON.stringify(bodyOf(id)));
    lsWrite(pendKey(), pending); saveCache(); renderSync();
    return flush();
  }
  function renderSync() {
    const n = Object.keys(pending).length, el = $("syncNotice");
    if (n) { el.textContent = `${n > 1 ? n + " modifications pas encore envoyées : elles partiront" : "1 modification pas encore envoyée : elle partira"} dès que la connexion reviendra. Gardez la Pointeuse ouverte ou rouvrez-la plus tard.`; el.hidden = false; }
    else if (offline) { el.textContent = "Hors connexion : vous voyez la dernière copie enregistrée sur cet appareil."; el.hidden = false; }
    else el.hidden = true;
  }
  window.addEventListener("online", () => { if (me) { flush(); if (offline) boot(); } });
  setInterval(() => { if (me && Object.keys(pending).length) flush(); }, 60000);

  function sessionLost() {
    if (!me) return;
    me = null; toast("Votre session a expiré : reconnectez-vous.");
    setTimeout(() => location.reload(), 1400);
  }

  // Ouverture : session valide → heures du serveur ; pas de réseau → copie de l'appareil ; sinon écran de connexion.
  async function boot() {
    let r = null, err = null;
    try { r = await api("GET", "/api/docs"); } catch (e) { err = e; }
    let last = null; try { last = localStorage.getItem("pointeuse-user"); } catch {}
    if (err && (err.status !== 0 || !last)) { showAuth(err.inviteRequired, err.status === 0 ? err.message : ""); return; }
    const firstOpen = !me;
    me = r ? r.user.username : last; offline = !r;
    try { localStorage.setItem("pointeuse-user", me); } catch {}
    S.months = {}; S.plans = {}; S.settings = { ...DEFAULTS };
    Object.entries(r ? r.docs : lsRead(cacheKey())).forEach(([id, d]) => applyDoc(id, d));
    pending = lsRead(pendKey());
    Object.entries(pending).forEach(([id, d]) => applyDoc(id, d));
    saveCache();
    $("who").textContent = me; $("aUser").textContent = me;
    $("auth").hidden = true;
    if (firstOpen) { $("app").hidden = true; $("badge").hidden = false; badgeTouched = false; tickBadge(); }
    renderSync(); render();
    if (Object.keys(pending).length && r) flush();
  }

  // ---------- Connexion ----------
  let authMode = "login", inviteRequired = false;
  function setAuthMode(m) {
    authMode = m;
    $("mLogin").setAttribute("aria-checked", m === "login"); $("mRegister").setAttribute("aria-checked", m === "register");
    $("auUserHint").hidden = $("auPassHint").hidden = m === "login";
    $("auInviteF").hidden = !(m === "register" && inviteRequired);
    $("auPass").autocomplete = m === "login" ? "current-password" : "new-password";
    $("auSubmit").textContent = m === "login" ? "Se connecter" : "Créer mon compte";
    $("auForgot").hidden = m !== "login";
    $("auErr").hidden = true;
  }
  function showAuth(invite, msg) {
    inviteRequired = !!invite;
    $("badge").hidden = true; $("app").hidden = true; $("auth").hidden = false;
    setAuthMode(authMode);
    if (msg) { $("auErr").textContent = msg; $("auErr").hidden = false; }
  }
  $("mLogin").onclick = () => setAuthMode("login");
  $("mRegister").onclick = () => setAuthMode("register");
  ["auUser", "auPass", "auInvite"].forEach(id => $(id).addEventListener("input", () => { $("auErr").hidden = true; }));
  $("authForm").onsubmit = async ev => {
    ev.preventDefault();
    const username = $("auUser").value.trim().toLowerCase(), password = $("auPass").value;
    const fail = m => { $("auErr").textContent = m; $("auErr").hidden = false; };
    if (!username || !password) { fail("Saisissez votre identifiant et votre mot de passe."); return; }
    const body = { username, password };
    if (authMode === "register") body.invite = $("auInvite").value.trim();
    const btn = $("auSubmit"); btn.disabled = true;
    try { await api("POST", authMode === "login" ? "/api/login" : "/api/register", body); }
    catch (e) { btn.disabled = false; if (e.inviteRequired && !inviteRequired) { inviteRequired = true; setAuthMode(authMode); } fail(e.message); return; }
    btn.disabled = false; $("auPass").value = "";
    await boot();
  };

  // ---------- Compte ----------
  $("aLogout").onclick = async () => {
    if (Object.keys(pending).length) { await flush(); if (Object.keys(pending).length) { toast("Des heures ne sont pas encore envoyées : attendez d'avoir du réseau pour vous déconnecter."); return; } }
    try { await api("POST", "/api/logout"); } catch (e) { toast("Déconnexion impossible : " + e.message); return; }
    lsDel(cacheKey()); lsDel(pendKey()); lsDel("pointeuse-user");
    location.reload();
  };
  $("pwForm").onsubmit = async ev => {
    ev.preventDefault();
    const err = $("pwErr"), cur = $("pwCur").value, nw = $("pwNew").value;
    err.hidden = true;
    if (nw.length < 8) { err.textContent = "Le nouveau mot de passe doit contenir au moins 8 caractères."; err.hidden = false; return; }
    try { await api("POST", "/api/password", { current: cur, next: nw }); }
    catch (e) { err.textContent = e.message; err.hidden = false; return; }
    $("pwCur").value = $("pwNew").value = ""; toast("Mot de passe changé. Vos autres appareils devront se reconnecter.");
  };
  $("delPw").addEventListener("input", () => { $("delBtn").dataset.confirm = ""; $("delBtn").textContent = "Supprimer mon compte et mes heures"; });
  $("delForm").onsubmit = async ev => {
    ev.preventDefault();
    const err = $("delErr"), btn = $("delBtn"); err.hidden = true;
    if (!$("delPw").value) { err.textContent = "Saisissez votre mot de passe pour confirmer."; err.hidden = false; return; }
    if (!btn.dataset.confirm) { btn.dataset.confirm = "1"; btn.textContent = `Confirmer : supprimer le compte ${me}`; return; }
    try { await api("DELETE", "/api/me", { password: $("delPw").value }); }
    catch (e) { err.textContent = e.message; err.hidden = false; return; }
    lsDel(cacheKey()); lsDel(pendKey()); lsDel("pointeuse-user");
    location.reload();
  };

  function setEntry(ds, patch) {
    const k = ds.slice(0, 7); S.months[k] = { ...(S.months[k] || {}) };
    const cur = { ...(S.months[k][ds] || {}), ...patch };
    Object.keys(cur).forEach(f => (cur[f] === null || cur[f] === "" || cur[f] === false) && delete cur[f]);
    if (Object.keys(cur).length) S.months[k][ds] = cur; else delete S.months[k][ds];
    render(); return persist(docName("m", k));
  }

  // ---------- Toast ----------
  let tt; function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2600); }

  // ---------- Créneaux de 15 minutes ----------
  const SLOTS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
  const roundQ = t => { const m = Math.round(toMin(t) / 15) * 15 % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  // Liste déroulante au quart d'heure ; garde une ancienne valeur hors quart d'heure si elle existe.
  function slotOptions(value, emptyLabel) {
    const list = value && !SLOTS.includes(value) ? [...SLOTS, value].sort() : SLOTS;
    return (emptyLabel != null ? `<option value="">${emptyLabel}</option>` : "") + list.map(s => `<option value="${s}" ${s === value ? "selected" : ""}>${s}</option>`).join("");
  }
  const slotSelect = (id, value, extra = "") => `<select class="tsel" id="${id}" ${extra}>${slotOptions(value, "—")}</select>`;
  // Heure d'arrivée habituelle : la plus récente saisie, sinon 09:00.
  function lastArrival() {
    const all = Object.values(S.months).flatMap(m => Object.entries(m)).filter(([, e]) => e.in).sort((a, b) => b[0].localeCompare(a[0]));
    return all[0] ? roundQ(all[0][1].in) : "09:00";
  }

  // ---------- Écran de pointage ----------
  let badgeTouched = false;
  function tickBadge() {
    const d = now();
    $("bClock").innerHTML = `${hm(d)}<span class="sec">${pad(d.getSeconds())}</span>`;
    $("bDate").textContent = fr(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase());
  }
  function fillBadgeSelects() {
    const ds = ymd(now()), e = entry(ds) || {}, p = planFor(ds) || {};
    const vIn = e.in || (p.start && !p.off ? p.start : lastArrival());
    let vOut = e.out || "";
    if (!vOut) { const r = roundQ(hm(now())); vOut = toMin(r) > toMin(vIn) ? r : (p.end && !p.off ? p.end : ""); }
    $("bInSel").innerHTML = slotOptions(vIn);
    $("bOutSel").innerHTML = slotOptions(vOut, "Pas encore parti");
  }
  function renderBadge() {
    const e = entry(ymd(now())) || {};
    if (!badgeTouched) fillBadgeSelects();
    const vIn = $("bInSel").value, vOut = $("bOutSel").value;
    $("bPreview").innerHTML = vIn && vOut ? `Temps travaillé : <b>${dur(worked({ in: vIn, out: vOut }))}</b>` : "Vous pouvez enregistrer l'arrivée seule et compléter le départ plus tard.";
    $("bStatus").textContent = e.off ? "Aujourd'hui est marqué comme jour off." : e.in && e.out ? `Déjà enregistré aujourd'hui : ${e.in} – ${e.out}.` : e.in ? `Arrivée déjà enregistrée à ${e.in}.` : "";
  }
  ["bInSel", "bOutSel"].forEach(id => $(id).addEventListener("change", () => { badgeTouched = true; renderBadge(); }));
  $("bSave").onclick = () => {
    const ds = ymd(now()), vIn = $("bInSel").value, vOut = $("bOutSel").value;
    setEntry(ds, { in: vIn, out: vOut || null, off: null });
    toast(vOut ? `Journée enregistrée · ${vIn} – ${vOut}` : `Arrivée enregistrée · ${vIn}`);
    showApp();
  };
  $("bOff").onclick = () => { setEntry(ymd(now()), { off: true, in: null, out: null }); toast("Jour off enregistré"); showApp(); };
  $("bSkip").onclick = showApp;
  $("openBadge").onclick = () => { badgeTouched = false; tickBadge(); $("app").hidden = true; $("badge").hidden = false; renderBadge(); window.scrollTo(0, 0); };
  function showApp() { $("badge").hidden = true; $("app").hidden = false; render(); window.scrollTo(0, 0); }

  // ---------- Onglets ----------
  let tab = "dash";
  try { tab = localStorage.getItem("pointeuse-tab") || "dash"; } catch {}
  function setTab(t) {
    tab = t; try { localStorage.setItem("pointeuse-tab", t); } catch {}
    document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    document.querySelectorAll("[data-view]").forEach(v => v.hidden = v.dataset.view !== t);
    render();
  }
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
    // Si la page est descendue, le nouvel onglet s'ouvre en haut, juste sous la barre d'onglets.
    const bar = document.querySelector(".tabs"), stickTop = parseFloat(getComputedStyle(bar).top) || 0;
    let above = bar.previousElementSibling; while (above && above.hidden) above = above.previousElementSibling;
    const natural = window.scrollY + above.getBoundingClientRect().bottom + parseFloat(getComputedStyle($("app")).rowGap) - stickTop;
    const stuck = window.scrollY > natural;
    setTab(b.dataset.tab);
    if (stuck) window.scrollTo(0, natural);
    bar.scrollTo({ left: b.offsetLeft - 16, behavior: "smooth" });
  });

  // ---------- Tableau de bord ----------
  function monthStats(key) {
    const days = S.months[key] || {}; let tot = 0, n = 0, off = 0, plan = 0, real = 0;
    const today = ymd(now());
    Object.entries(days).forEach(([ds, e]) => { if (e.off) off++; const w = worked(e); if (w != null) { tot += w; n++; } });
    // écart : jours passés (jusqu'à aujourd'hui) ayant un planning
    const [y, m] = key.split("-").map(Number); const last = new Date(y, m, 0).getDate();
    for (let i = 1; i <= last; i++) { const ds = `${key}-${pad(i)}`; if (ds > today) break; const p = planFor(ds); if (!p) continue; const pm = planned(p) || 0; plan += pm; real += worked(days[ds]) || 0; }
    return { tot, n, off, plan, real };
  }
  function renderDash() {
    const d = now(), ds = ymd(d), e = entry(ds) || {}, p = planFor(ds);
    $("tIn").textContent = e.in || "—"; $("tOut").textContent = e.out || "—";
    const w = worked(e, true);
    $("tWork").textContent = e.off ? "Off" : dur(w);
    $("todayChip").innerHTML = e.off ? '<span class="chip off">Jour off</span>' : e.in && !e.out ? '<span class="chip open">En poste</span>' : e.in ? '<span class="chip in">Terminée</span>' : '<span class="chip miss">Pas pointé</span>';
    $("tPlan").textContent = p ? (p.off ? "Prévu : repos" : `Prévu : ${p.start} – ${p.end} (${dur(planned(p))})`) : "Pas de planning pour aujourd'hui.";

    const key = ym(d), st = monthStats(key);
    $("mTitle").textContent = fr(d, { month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase());
    $("mTotal").textContent = dur(st.tot); $("mDays").textContent = st.n; $("mOff").textContent = st.off;
    $("mAvg").textContent = st.n ? dur(st.tot / st.n) : "—";
    const dl = st.real - st.plan; $("mDelta").textContent = st.plan ? (dl >= 0 ? "+" : "") + dur(dl) : "—";
    $("mDelta").className = "v " + (st.plan ? (dl >= 0 ? "delta-pos" : "delta-neg") : "");

    const mon = monday(d); let wt = 0; const rows = [];
    let max = 600;
    for (let i = 0; i < 7; i++) { const x = ymd(addDays(mon, i)); max = Math.max(max, worked(entry(x), x === ds) || 0, planned(planFor(x)) || 0); }
    for (let i = 0; i < 7; i++) {
      const x = addDays(mon, i), xs = ymd(x), ex = entry(xs), wm = worked(ex, xs === ds), pm = planned(planFor(xs));
      wt += wm || 0;
      rows.push(`<div class="wb ${ex && ex.off ? "off" : ""} ${xs === ds ? "today" : ""}">
        <div class="h">${wm ? dur(wm).replace(" h ", "h") : ex && ex.off ? "off" : ""}</div>
        <div class="track">${wm ? `<div class="fill" style="height:${(wm / max) * 100}%"></div>` : ""}${pm ? `<div class="plan" style="bottom:${(pm / max) * 100}%"></div>` : ""}</div>
        <div class="d">${fr(x, { weekday: "short" }).replace(".", "")}</div></div>`);
    }
    $("wBars").innerHTML = rows.join("");
    $("wTitle").textContent = `Semaine ${isoWeek(d)}`;
    const target = +S.settings.weekly * 60;
    $("wTotal").innerHTML = `${dur(wt)} <span style="color:var(--muted)">/ ${dur(target)}</span>`;

    const nm = addDays(mon, 7), plan = S.plans[ymd(nm)];
    $("nTitle").textContent = `Semaine prochaine · S${isoWeek(nm)}`;
    if (!plan || !Object.keys(plan).length) {
      $("nBody").innerHTML = `<p style="margin:0;color:var(--muted)">Le planning du ${fr(nm, { day: "numeric", month: "long" })} au ${fr(addDays(nm, 6), { day: "numeric", month: "long" })} n'est pas encore renseigné.</p>`;
      $("nEdit").textContent = "Renseigner le planning"; $("nEdit").className = "btn primary";
    } else {
      let tot = 0; const r = [];
      for (let i = 0; i < 7; i++) { const x = addDays(nm, i), p = plan[ymd(x)]; const pm = planned(p); tot += pm || 0;
        r.push(`<div><span class="num" style="text-transform:capitalize">${dayName(x)}</span><span class="num">${p ? (p.off ? '<span class="chip off">Repos</span>' : `${p.start} – ${p.end}`) : '<span style="color:var(--muted)">—</span>'}</span><span class="num">${pm ? dur(pm) : ""}</span></div>`); }
      $("nBody").innerHTML = `<div class="plan-mini">${r.join("")}</div><div class="ptotal"><span>Total prévu</span><span class="num">${dur(tot)}</span></div>`;
      $("nEdit").textContent = "Modifier le planning"; $("nEdit").className = "btn";
    }
  }
  $("nEdit").onclick = () => { pWeek = addDays(monday(now()), 7); pDraft = null; setTab("plan"); };

  // ---------- Historique ----------
  let hMonth = new Date(now().getFullYear(), now().getMonth(), 1), openDay = null;
  $("hPrev").onclick = () => { hMonth = new Date(hMonth.getFullYear(), hMonth.getMonth() - 1, 1); openDay = null; render(); };
  $("hNext").onclick = () => { hMonth = new Date(hMonth.getFullYear(), hMonth.getMonth() + 1, 1); openDay = null; render(); };
  function statusChip(e, ds) {
    if (e && e.off) return '<span class="chip off">Off</span>';
    if (e && e.in && e.out) return '<span class="chip in">Pointé</span>';
    if (e && e.in) return ds === ymd(now()) ? '<span class="chip open">En poste</span>' : '<span class="chip miss">Départ ?</span>';
    return "";
  }
  function renderHist() {
    const key = ym(hMonth), y = hMonth.getFullYear(), m = hMonth.getMonth(), last = new Date(y, m + 1, 0).getDate();
    $("hTitle").textContent = fr(hMonth, { month: "long", year: "numeric" });
    $("hNext").disabled = key >= ym(now());
    const today = ymd(now()), out = [`<div class="hrow head"><span>Jour</span><span>Arrivée</span><span>Départ</span><span>Travaillé</span><span>Prévu</span><span>Statut</span></div>`];
    let total = 0, wk = 0, wkp = 0;
    const lastDay = key === ym(now()) ? now().getDate() : last;
    for (let i = 1; i <= lastDay; i++) {
      const d = new Date(y, m, i), ds = ymd(d), e = entry(ds), p = planFor(ds), w = worked(e, ds === today), pm = planned(p);
      const we = d.getDay() === 0 || d.getDay() === 6;
      total += w || 0; wk += w || 0; wkp += pm || 0;
      out.push(`<button class="hrow day ${we ? "weekend" : ""}" data-day="${ds}" aria-expanded="${openDay === ds}">
        <span class="dn">${dayName(d)}<span class="times-m num">${e && e.in ? `${e.in} → ${e.out || "…"}` : ""}</span></span>
        <span class="t">${e && e.in || ""}</span><span class="t">${e && e.out || ""}</span>
        <span class="t">${w != null ? dur(w) : ""}</span><span class="t">${pm != null ? dur(pm) : p && p.off ? "repos" : ""}</span><span>${statusChip(e, ds)}</span></button>`);
      if (openDay === ds) out.push(editorHtml(ds, e || {}));
      if (d.getDay() === 0 || i === lastDay) {
        out.push(`<div class="hrow wk"><span>Semaine ${isoWeek(d)}</span><span></span><span></span><span class="t">${dur(wk)}</span><span class="t">${wkp ? dur(wkp) : ""}</span><span></span></div>`);
        wk = 0; wkp = 0;
      }
    }
    $("hList").innerHTML = out.join("");
    $("hTotal").textContent = `Total : ${dur(total)}`;
    $("hList").querySelectorAll(".hrow.day").forEach(b => b.onclick = () => { openDay = openDay === b.dataset.day ? null : b.dataset.day; render(); });
    const ed = $("hList").querySelector(".editor"); if (ed) bindEditor(ed);
  }
  function editorHtml(ds, e) {
    return `<div class="editor" data-ed="${ds}">
      <div class="fields">
        <div class="field"><label for="eIn">Arrivée</label>${slotSelect("eIn", e.in || "")}</div>
        <div class="field"><label for="eOut">Départ</label>${slotSelect("eOut", e.out || "")}</div>
        <label class="check"><input type="checkbox" id="eOff" ${e.off ? "checked" : ""}> Jour off</label>
        <div class="field"><label for="eNote">Note</label><input id="eNote" maxlength="80" value="${(e.note || "").replace(/"/g, "&quot;")}" placeholder="Congé, RTT, formation…"></div>
      </div>
      <div class="actions"><button class="btn primary" id="eSave">Enregistrer</button><button class="btn ghost" id="eCancel">Fermer</button><button class="btn ghost danger" id="eDel">Effacer ce jour</button></div>
    </div>`;
  }
  function bindEditor(ed) {
    const ds = ed.dataset.ed, off = ed.querySelector("#eOff");
    const sync = () => ["#eIn", "#eOut"].forEach(s => ed.querySelector(s).disabled = off.checked);
    off.onchange = sync; sync();
    ed.querySelector("#eSave").onclick = () => {
      const o = off.checked;
      const vIn = ed.querySelector("#eIn").value, vOut = ed.querySelector("#eOut").value;
      if (!o && vOut && !vIn) { toast("Indiquez l'heure d'arrivée."); return; }
      setEntry(ds, o ? { off: true, in: null, out: null, note: ed.querySelector("#eNote").value.trim() || null }
                     : { off: null, in: vIn || null, out: vOut || null, note: ed.querySelector("#eNote").value.trim() || null });
      openDay = null; toast("Journée mise à jour"); render();
    };
    ed.querySelector("#eCancel").onclick = () => { openDay = null; render(); };
    ed.querySelector("#eDel").onclick = function () {
      if (this.dataset.confirm) { setEntry(ds, { off: null, in: null, out: null, note: null }); openDay = null; toast("Journée effacée"); render(); }
      else { this.dataset.confirm = "1"; this.textContent = "Confirmer l'effacement"; }
    };
  }
  $("hExport").onclick = () => {
    const key = ym(hMonth), rows = [["Date", "Arrivée", "Départ", "Travaillé (h)", "Jour off", "Prévu (h)", "Note"]];
    const [y, m] = key.split("-").map(Number), last = new Date(y, m, 0).getDate();
    for (let i = 1; i <= last; i++) { const ds = `${key}-${pad(i)}`, e = entry(ds), p = planFor(ds); if (!e && !p) continue;
      const w = worked(e), pm = planned(p);
      rows.push([ds, e?.in || "", e?.out || "", w != null ? (w / 60).toFixed(2).replace(".", ",") : "", e?.off ? "oui" : "", pm != null ? (pm / 60).toFixed(2).replace(".", ",") : "", (e?.note || "").replace(/;/g, ",")]); }
    // BOM UTF-8 + point-virgule : Excel en français ouvre le fichier correctement.
    const blob = new Blob(["\ufeff" + rows.map(r => r.join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `heures-${key}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---------- Planning ----------
  let pWeek = addDays(monday(now()), 7), pDraft = null;
  const pKey = () => ymd(pWeek);
  $("pPrev").onclick = () => { pWeek = addDays(pWeek, -7); pDraft = null; render(); };
  $("pNext").onclick = () => { pWeek = addDays(pWeek, 7); pDraft = null; render(); };
  function draft() { if (!pDraft) pDraft = JSON.parse(JSON.stringify(S.plans[pKey()] || {})); return pDraft; }
  function renderPlan() {
    const mon = pWeek, dr = draft(), thisMon = ymd(monday(now()));
    const rel = pKey() === thisMon ? " · cette semaine" : ymd(addDays(monday(now()), 7)) === pKey() ? " · semaine prochaine" : "";
    $("pTitle").textContent = `Semaine ${isoWeek(mon)}`;
    $("pRange").textContent = `Du ${fr(mon, { weekday: "long", day: "numeric", month: "long" })} au ${fr(addDays(mon, 6), { weekday: "long", day: "numeric", month: "long" })}${rel}`;
    const r = []; let tot = 0;
    for (let i = 0; i < 7; i++) {
      const x = addDays(mon, i), ds = ymd(x), p = dr[ds] || {}, pm = planned(p); tot += pm || 0;
      r.push(`<div class="prow" data-pd="${ds}"><span class="dn">${fr(x, { weekday: "long", day: "numeric" })}</span>
        <span class="a">${slotSelect("ps-" + ds, p.start || "", `aria-label="Début ${ds}" ${p.off ? "disabled" : ""}`)}</span>
        <span class="b">${slotSelect("pe-" + ds, p.end || "", `aria-label="Fin ${ds}" ${p.off ? "disabled" : ""}`)}</span>
        <label class="check"><input type="checkbox" id="po-${ds}" ${p.off ? "checked" : ""}> Repos</label>
        <span class="tot num">${pm ? dur(pm) : ""}</span></div>`);
    }
    $("pList").innerHTML = r.join(""); $("pTotal").textContent = dur(tot);
    $("pList").querySelectorAll(".prow").forEach(row => {
      const ds = row.dataset.pd;
      const upd = () => {
        const off = row.querySelector(`#po-${ds}`).checked, s = row.querySelector(`#ps-${ds}`).value, e = row.querySelector(`#pe-${ds}`).value;
        if (off) dr[ds] = { off: true }; else if (s || e) dr[ds] = { start: s, end: e }; else delete dr[ds];
        renderPlan();
      };
      row.querySelectorAll("input, select").forEach(i => i.addEventListener("change", upd));
    });
  }
  $("pCopy").onclick = () => {
    const prev = S.plans[ymd(addDays(pWeek, -7))];
    if (!prev || !Object.keys(prev).length) { toast("La semaine précédente n'a pas de planning."); return; }
    pDraft = {}; Object.entries(prev).forEach(([ds, p]) => { pDraft[ymd(addDays(parse(ds), 7))] = { ...p }; });
    renderPlan(); toast("Planning copié. Pensez à enregistrer.");
  };
  $("pClear").onclick = () => { pDraft = {}; renderPlan(); };
  $("pSave").onclick = () => {
    const bad = Object.entries(draft()).find(([, p]) => !p.off && (!p.start || !p.end));
    if (bad) { toast(`Complétez le début et la fin du ${fr(parse(bad[0]), { weekday: "long" })}.`); return; }
    S.plans[pKey()] = draft(); pDraft = null; persist(docName("p", pKey())); toast("Planning enregistré"); render();
  };

  // ---------- Réglages ----------
  function renderSet() { if (document.activeElement?.id !== "sWeek") $("sWeek").value = S.settings.weekly; }
  $("sSave").onclick = () => {
    const wk = Math.max(0, Math.min(80, +$("sWeek").value || 0));
    S.settings = { weekly: wk }; persist("settings"); toast("Réglages enregistrés"); render();
  };

  // ---------- Rendu ----------
  function render() {
    if (!$("badge").hidden) renderBadge();
    if ($("app").hidden) return;
    if (tab === "dash") renderDash(); else if (tab === "hist") renderHist(); else if (tab === "plan") renderPlan(); else renderSet();
  }

  tickBadge(); setInterval(() => { if (!$("badge").hidden) tickBadge(); }, 1000);
  setInterval(() => { if (!$("app").hidden && tab === "dash") renderDash(); }, 30000);
  setTab(tab); $("app").hidden = true;
  boot();
})();

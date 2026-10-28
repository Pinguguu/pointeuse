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
  // Une journée peut avoir une coupure : premier service in → out, puis second service in2 → out2.
  const segs = e => [[e.in, e.out], [e.in2, e.out2]].filter(([a]) => a);
  const openShift = e => !!e && !e.off && ((e.in && !e.out) || (e.in2 && !e.out2));
  const lastOut = e => e.in2 ? e.out2 : e.out;
  const timesText = e => segs(e).map(([a, b]) => `${a} – ${b || "…"}`).join(" · ");
  // Un service pas encore terminé compte jusqu'à maintenant (live) ; sinon seuls les services complets comptent.
  function worked(e, live) {
    if (!e || e.off || !e.in) return null;
    let t = 0, any = false;
    for (const [a, b] of segs(e)) {
      const o = b || (live ? hm(now()) : null);
      if (o) { t += span(a, o); any = true; }
    }
    return any ? t : null;
  }
  function planned(p) {
    if (!p || p.off || !p.start || !p.end) return null;
    return span(p.start, p.end) + (p.start2 && p.end2 ? span(p.start2, p.end2) : 0);
  }
  const planText = p => `${p.start} – ${p.end}${p.start2 && p.end2 ? ` · ${p.start2} – ${p.end2}` : ""}`;
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
  let badgeTouched = false, cutOn = false;
  function tickBadge() {
    const d = now();
    $("bClock").innerHTML = `${hm(d)}<span class="sec">${pad(d.getSeconds())}</span>`;
    $("bDate").textContent = fr(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase());
  }
  const nowAfter = t => { const r = roundQ(hm(now())); return t && toMin(r) > toMin(t) ? r : ""; };
  // Préremplissage : ce qui est déjà pointé aujourd'hui, sinon le planning, sinon l'heure qu'il est.
  function fillBadgeSelects() {
    const ds = ymd(now()), e = entry(ds) || {}, p = (planFor(ds) && !planFor(ds).off) ? planFor(ds) : {};
    cutOn = !!(e.in2 || (!e.out2 && p.start2 && (!e.out || e.out === p.end)));
    const vIn = e.in || p.start || lastArrival();
    let vOut, vIn2 = "", vOut2 = "";
    if (cutOn) {
      vOut = e.out || p.end || "";
      vIn2 = e.in2 || p.start2 || "";
      vOut2 = e.out2 || nowAfter(vIn2) || p.end2 || "";
    } else vOut = e.out || nowAfter(vIn) || p.end || "";
    setBadgeValues(vIn, vOut, vIn2, vOut2);
  }
  function setBadgeValues(vIn, vOut, vIn2, vOut2) {
    $("bInSel").innerHTML = slotOptions(vIn);
    $("bOutSel").innerHTML = slotOptions(vOut, cutOn ? "Pas encore" : "Pas encore parti");
    $("bIn2Sel").innerHTML = slotOptions(vIn2, "Pas encore repris");
    $("bOut2Sel").innerHTML = slotOptions(vOut2, "Pas encore parti");
  }
  const badgeEntry = () => {
    const v = id => $(id).value || null;
    const e = { in: v("bInSel"), out: v("bOutSel") };
    if (cutOn) { if (v("bIn2Sel")) e.in2 = v("bIn2Sel"); if (v("bOut2Sel")) e.out2 = v("bOut2Sel"); }
    return e;
  };
  // Message d'erreur si les horaires ne se suivent pas, sinon null.
  function shiftError(e) {
    if (e.out2 && !e.in2) return "Indiquez l'heure de reprise.";
    if (e.in2 && !e.out) return "Indiquez l'heure de début de la coupure.";
    if (e.in2 && toMin(e.out) >= toMin(e.in) && toMin(e.in2) <= toMin(e.out)) return "La reprise doit être après le début de la coupure.";
    return null;
  }
  function renderBadge() {
    const e = entry(ymd(now())) || {};
    if (!badgeTouched) fillBadgeSelects();
    $("bCutRow").hidden = !cutOn;
    $("bCut").textContent = cutOn ? "Retirer la coupure" : "Ajouter une coupure";
    $("bCut").setAttribute("aria-expanded", cutOn);
    $("bOutLbl").textContent = cutOn ? "Coupure" : "Départ";
    const b = badgeEntry(), err = shiftError(b);
    $("bPreview").innerHTML = err ? `<span class="err">${err}</span>`
      : !b.out ? "Vous pouvez enregistrer l'arrivée seule et compléter le reste plus tard."
      : cutOn && !b.in2 ? `Premier service : <b>${dur(worked(b))}</b>. Vous pourrez ajouter la reprise plus tard.`
      : `Temps travaillé : <b>${dur(worked(b))}</b>${b.in2 ? ` (${timesText(b)})` : ""}`;
    $("bSave").disabled = !!err;
    $("bStatus").textContent = e.off ? "Aujourd'hui est marqué comme jour off." : e.in ? `Déjà enregistré aujourd'hui : ${timesText(e)}.` : "";
  }
  ["bInSel", "bOutSel", "bIn2Sel", "bOut2Sel"].forEach(id => $(id).addEventListener("change", () => { badgeTouched = true; renderBadge(); }));
  $("bCut").onclick = () => {
    // Ajouter : l'heure de départ choisie devient la fin du second service. Retirer : l'inverse.
    const vIn = $("bInSel").value, vOut = $("bOutSel").value, vOut2 = $("bOut2Sel").value;
    const p = planFor(ymd(now())) || {};
    cutOn = !cutOn; badgeTouched = true;
    if (cutOn) setBadgeValues(vIn, p.start2 ? p.end || "" : "", p.start2 || "", vOut || p.end2 || "");
    else setBadgeValues(vIn, vOut2 || vOut, "", "");
    renderBadge();
  };
  $("bSave").onclick = () => {
    const ds = ymd(now()), b = badgeEntry();
    if (shiftError(b)) return;
    setEntry(ds, { in: b.in, out: b.out, in2: b.in2 || null, out2: b.in2 ? b.out2 || null : null, off: null });
    toast(b.out ? `Journée enregistrée · ${timesText(b)}` : `Arrivée enregistrée · ${b.in}`);
    showApp();
  };
  $("bOff").onclick = () => { setEntry(ymd(now()), { off: true, in: null, out: null, in2: null, out2: null }); toast("Jour off enregistré"); showApp(); };
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
    $("tIn").textContent = e.in || "—"; $("tOut").textContent = (e.in2 ? e.out2 : e.out) || "—";
    const w = worked(e, true);
    $("tWork").textContent = e.off ? "Off" : dur(w);
    // En coupure : premier service terminé, reprise prévue au planning mais pas encore pointée.
    const inCut = e.in && e.out && !e.in2 && p && p.start2 && hm(d) < p.end2;
    $("todayChip").innerHTML = e.off ? '<span class="chip off">Jour off</span>' : openShift(e) ? '<span class="chip open">En poste</span>' : inCut ? '<span class="chip open">En coupure</span>' : e.in ? '<span class="chip in">Terminée</span>' : '<span class="chip miss">Pas pointé</span>';
    const cut = e.in2 ? `Coupure ${e.out} – ${e.in2} · ` : "";
    $("tPlan").textContent = cut + (p ? (p.off ? "Prévu : repos" : `Prévu : ${planText(p)} (${dur(planned(p))})`) : "Pas de planning pour aujourd'hui.");

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
        r.push(`<div><span class="num" style="text-transform:capitalize">${dayName(x)}</span><span class="num">${p ? (p.off ? '<span class="chip off">Repos</span>' : planText(p)) : '<span style="color:var(--muted)">—</span>'}</span><span class="num">${pm ? dur(pm) : ""}</span></div>`); }
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
    if (openShift(e)) return ds === ymd(now()) ? '<span class="chip open">En poste</span>' : '<span class="chip miss">Départ ?</span>';
    if (e && e.in) return '<span class="chip in">Pointé</span>';
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
        <span class="dn">${dayName(d)}<span class="times-m num">${e && e.in ? timesText(e) : ""}</span></span>
        <span class="t">${e && e.in ? e.in + (e.in2 ? `<br>${e.in2}` : "") : ""}</span><span class="t">${e && e.in ? (e.out || "") + (e.in2 ? `<br>${e.out2 || "…"}` : "") : ""}</span>
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
        <div class="field"><label for="eOut" id="eOutLbl">${e.in2 ? "Coupure" : "Départ"}</label>${slotSelect("eOut", e.out || "")}</div>
        <div class="field"><label for="eIn2">Reprise <span class="opt">(si coupure)</span></label>${slotSelect("eIn2", e.in2 || "")}</div>
        <div class="field"><label for="eOut2">Départ</label>${slotSelect("eOut2", e.out2 || "")}</div>
        <label class="check"><input type="checkbox" id="eOff" ${e.off ? "checked" : ""}> Jour off</label>
        <div class="field"><label for="eNote">Note</label><input id="eNote" maxlength="80" value="${(e.note || "").replace(/"/g, "&quot;")}" placeholder="Congé, RTT, formation…"></div>
      </div>
      <div class="actions"><button class="btn primary" id="eSave">Enregistrer</button><button class="btn ghost" id="eCancel">Fermer</button><button class="btn ghost danger" id="eDel">Effacer ce jour</button></div>
    </div>`;
  }
  function bindEditor(ed) {
    const ds = ed.dataset.ed, off = ed.querySelector("#eOff");
    const v = id => ed.querySelector(id).value || null;
    const sync = () => {
      ["#eIn", "#eOut", "#eIn2", "#eOut2"].forEach(s => ed.querySelector(s).disabled = off.checked);
      ed.querySelector("#eOutLbl").textContent = v("#eIn2") ? "Coupure" : "Départ";
    };
    off.onchange = sync; ed.querySelector("#eIn2").onchange = sync; sync();
    ed.querySelector("#eSave").onclick = () => {
      const o = off.checked, note = ed.querySelector("#eNote").value.trim() || null;
      const e = { in: v("#eIn"), out: v("#eOut"), in2: v("#eIn2"), out2: v("#eOut2") };
      if (!o) {
        const err = (!e.in && (e.out || e.in2 || e.out2)) ? "Indiquez l'heure d'arrivée." : shiftError(e);
        if (err) { toast(err); return; }
      }
      setEntry(ds, o ? { off: true, in: null, out: null, in2: null, out2: null, note }
                     : { off: null, ...e, out2: e.in2 ? e.out2 : null, note });
      openDay = null; toast("Journée mise à jour"); render();
    };
    ed.querySelector("#eCancel").onclick = () => { openDay = null; render(); };
    ed.querySelector("#eDel").onclick = function () {
      if (this.dataset.confirm) { setEntry(ds, { off: null, in: null, out: null, in2: null, out2: null, note: null }); openDay = null; toast("Journée effacée"); render(); }
      else { this.dataset.confirm = "1"; this.textContent = "Confirmer l'effacement"; }
    };
  }
  $("hExport").onclick = () => {
    const key = ym(hMonth), rows = [["Date", "Arrivée", "Départ", "Reprise", "Départ 2", "Travaillé (h)", "Jour off", "Prévu (h)", "Note"]];
    const [y, m] = key.split("-").map(Number), last = new Date(y, m, 0).getDate();
    for (let i = 1; i <= last; i++) { const ds = `${key}-${pad(i)}`, e = entry(ds), p = planFor(ds); if (!e && !p) continue;
      const w = worked(e), pm = planned(p);
      rows.push([ds, e?.in || "", e?.out || "", e?.in2 || "", e?.out2 || "", w != null ? (w / 60).toFixed(2).replace(".", ",") : "", e?.off ? "oui" : "", pm != null ? (pm / 60).toFixed(2).replace(".", ",") : "", (e?.note || "").replace(/;/g, ",")]); }
    // BOM UTF-8 + point-virgule : Excel en français ouvre le fichier correctement.
    const blob = new Blob(["\ufeff" + rows.map(r => r.join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `heures-${key}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ---------- Relevé à envoyer (image) ----------
  // Une fiche lisible sur un téléphone : chaque jour du mois, le total de chaque semaine et le total du mois.
  // Dessinée sur un canvas, toujours en clair (elle part chez le patron, quel que soit le thème de l'appareil).
  const RC = { bg: "#ffffff", ink: "#16233b", muted: "#5b667a", line: "#dfe3ea", band: "#eef1f5", accent: "#2346c9", off: "#a2610a" };
  const RF = { display: '"Bricolage Grotesque", system-ui, sans-serif', body: '"IBM Plex Sans", system-ui, sans-serif', mono: '"IBM Plex Mono", ui-monospace, monospace' };
  async function buildReport(key) {
    try { await Promise.all(['700 30px "Bricolage Grotesque"', '400 15px "IBM Plex Sans"', '600 15px "IBM Plex Sans"', '500 15px "IBM Plex Mono"', '600 15px "IBM Plex Mono"'].map(f => document.fonts.load(f))); } catch {}
    const [y, m] = key.split("-").map(Number), monthEnd = new Date(y, m, 0).getDate();
    const partial = key === ym(now()), lastDay = partial ? now().getDate() : monthEnd;
    const rows = []; let total = 0, wk = 0, nDays = 0, nOff = 0;
    for (let i = 1; i <= lastDay; i++) {
      const d = new Date(y, m - 1, i), ds = ymd(d), e = entry(ds), w = worked(e);
      total += w || 0; wk += w || 0; if (w != null) nDays++; if (e && e.off) nOff++;
      rows.push({ kind: "day", d, e, w });
      if (d.getDay() === 0 || i === lastDay) { rows.push({ kind: "week", n: isoWeek(d), w: wk }); wk = 0; }
    }
    const W = 720, P = 36, RH = 36, WH = 34, HEAD = 168, TH = 34, FOOT = 150;
    const H = P + HEAD + TH + rows.reduce((h, r) => h + (r.kind === "day" ? RH : WH), 0) + FOOT + P;
    const scale = 2, cv = document.createElement("canvas");
    cv.width = W * scale; cv.height = H * scale;
    const c = cv.getContext("2d"); c.scale(scale, scale); c.textBaseline = "middle";
    const text = (s, x, y, font, color, align = "left") => { c.font = font; c.fillStyle = color; c.textAlign = align; c.fillText(s, x, y); };
    const fit = (s, maxW) => { if (c.measureText(s).width <= maxW) return s; while (s.length > 1 && c.measureText(s + "…").width > maxW) s = s.slice(0, -1); return s + "…"; };
    const hline = (y, color = RC.line) => { c.fillStyle = color; c.fillRect(P, y, W - 2 * P, 1); };
    c.fillStyle = RC.bg; c.fillRect(0, 0, W, H);

    // En-tête : qui, quel mois, et le total tout de suite visible.
    const month = fr(new Date(y, m - 1, 1), { month: "long", year: "numeric" }).replace(/^./, s => s.toUpperCase());
    let yy = P + 10;
    text("RELEVÉ D'HEURES", P, yy, `600 12px ${RF.body}`, RC.muted);
    yy += 36; text(month, P, yy, `700 32px ${RF.display}`, RC.ink);
    yy += 34; text(S.settings.name || me || "", P, yy, `600 17px ${RF.body}`, RC.ink);
    yy += 24; text(partial ? `Arrêté au ${fr(now(), { day: "numeric", month: "long" })}` : `Du 1er au ${monthEnd} ${fr(new Date(y, m - 1, 1), { month: "long" })}`, P, yy, `400 14px ${RF.body}`, RC.muted);
    text("Total", W - P, P + 46, `600 13px ${RF.body}`, RC.muted, "right");
    text(dur(total), W - P, P + 82, `600 34px ${RF.mono}`, RC.accent, "right");
    yy = P + HEAD;

    // Tableau
    const xT = P + 150, xW = W - P;
    text("JOUR", P, yy + TH / 2, `600 11.5px ${RF.body}`, RC.muted);
    text("HORAIRES", xT, yy + TH / 2, `600 11.5px ${RF.body}`, RC.muted);
    text("TRAVAILLÉ", xW, yy + TH / 2, `600 11.5px ${RF.body}`, RC.muted, "right");
    yy += TH; hline(yy - 1, RC.ink);
    for (const r of rows) {
      if (r.kind === "week") {
        c.fillStyle = RC.band; c.fillRect(P, yy + 3, W - 2 * P, WH - 6);
        text(`Semaine ${r.n}`, P + 10, yy + WH / 2, `600 14px ${RF.body}`, RC.ink);
        text(dur(r.w), xW - 10, yy + WH / 2, `600 15px ${RF.mono}`, RC.ink, "right");
        yy += WH; continue;
      }
      const { d, e, w } = r, we = d.getDay() === 0 || d.getDay() === 6, mid = yy + RH / 2;
      text(dayName(d).replace(/^./, s => s.toUpperCase()), P, mid, `${we ? 400 : 500} 15px ${RF.body}`, we ? RC.muted : RC.ink);
      if (e && e.off) text("Jour off", xT, mid, `600 15px ${RF.body}`, RC.off);
      else if (e && e.in) {
        c.font = `500 15px ${RF.mono}`; const t = timesText(e), tw = c.measureText(t).width;
        text(t, xT, mid, c.font, RC.ink);
        if (e.note) { c.font = `400 13px ${RF.body}`; text(fit(e.note, xW - 90 - xT - tw - 14), xT + tw + 14, mid, c.font, RC.muted); }
      } else text("—", xT, mid, `400 15px ${RF.body}`, RC.line);
      if (e && e.off && e.note) { c.font = `400 13px ${RF.body}`; text(fit(e.note, xW - 90 - xT - 90), xT + 80, mid, c.font, RC.muted); }
      if (w != null) text(dur(w), xW, mid, `500 15px ${RF.mono}`, RC.ink, "right");
      yy += RH; hline(yy - 1);
    }

    // Pied : total du mois et résumé
    yy += 22; hline(yy, RC.ink); yy += 36;
    text("Total du mois", P, yy, `700 20px ${RF.display}`, RC.ink);
    text(dur(total), xW, yy, `600 24px ${RF.mono}`, RC.accent, "right");
    yy += 32;
    const parts = [`${nDays} jour${nDays > 1 ? "s" : ""} travaillé${nDays > 1 ? "s" : ""}`, `${nOff} jour${nOff > 1 ? "s" : ""} off`];
    if (nDays) parts.push(`moyenne ${dur(total / nDays)} par jour`);
    text(parts.join(" · "), P, yy, `400 14px ${RF.body}`, RC.muted);
    yy += 26;
    text(`Établi le ${fr(now(), { day: "numeric", month: "long", year: "numeric" })} avec Pointeuse · pause comprise dans les horaires`, P, yy, `400 12px ${RF.body}`, RC.muted);
    return new Promise(res => cv.toBlob(res, "image/png"));
  }

  let reportFile = null, reportUrl = null, reportOpener = null;
  $("hReport").onclick = async () => {
    const key = ym(hMonth), btn = $("hReport");
    btn.disabled = true;
    let blob = null; try { blob = await buildReport(key); } catch {}
    btn.disabled = false;
    if (!blob) { toast("Impossible de créer l'image. Réessayez."); return; }
    const who = (S.settings.name || me || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    reportFile = new File([blob], `releve-heures-${key}${who ? "-" + who : ""}.png`, { type: "image/png" });
    if (reportUrl) URL.revokeObjectURL(reportUrl);
    reportUrl = URL.createObjectURL(blob);
    $("rImg").src = reportUrl;
    $("rTitle").textContent = `Relevé · ${fr(hMonth, { month: "long", year: "numeric" })}`;
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [reportFile] }));
    $("rShare").hidden = !canShare;
    $("rHint").textContent = S.settings.name ? "" : "Astuce : indiquez votre nom dans Réglages pour qu'il apparaisse sur le relevé.";
    reportOpener = btn; $("report").hidden = false; (canShare ? $("rShare") : $("rSave")).focus();
  };
  function closeReport() { $("report").hidden = true; if (reportOpener) reportOpener.focus(); }
  $("rClose").onclick = closeReport;
  $("report").addEventListener("click", ev => { if (ev.target === $("report")) closeReport(); });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !$("report").hidden) closeReport(); });
  $("rShare").onclick = async () => {
    try { await navigator.share({ files: [reportFile], title: "Relevé d'heures" }); }
    catch (err) { if (err && err.name !== "AbortError") toast("Partage impossible. Utilisez « Enregistrer l'image »."); }
  };
  $("rSave").onclick = () => {
    const a = document.createElement("a"); a.href = reportUrl; a.download = reportFile.name;
    document.body.append(a); a.click(); a.remove();
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
      const x = addDays(mon, i), ds = ymd(x), p = dr[ds] || {}, pm = planned(p), cut = "start2" in p; tot += pm || 0;
      const dis = p.off ? "disabled" : "";
      r.push(`<div class="prow ${cut ? "cut" : ""}" data-pd="${ds}"><span class="dn">${fr(x, { weekday: "long", day: "numeric" })}</span>
        <span class="a">${slotSelect("ps-" + ds, p.start || "", `aria-label="Début ${ds}" ${dis}`)}</span>
        <span class="b">${slotSelect("pe-" + ds, p.end || "", `aria-label="${cut ? "Coupure" : "Fin"} ${ds}" ${dis}`)}</span>
        <span class="checks"><label class="check"><input type="checkbox" id="po-${ds}" ${p.off ? "checked" : ""}> Repos</label>
        <label class="check"><input type="checkbox" id="pc-${ds}" ${cut ? "checked" : ""} ${dis}> Coupure</label></span>
        ${cut ? `<span class="a2">${slotSelect("ps2-" + ds, p.start2 || "", `aria-label="Reprise ${ds}"`)}</span>
        <span class="b2">${slotSelect("pe2-" + ds, p.end2 || "", `aria-label="Fin ${ds}"`)}</span>` : ""}
        <span class="tot num">${pm ? dur(pm) : ""}</span></div>`);
    }
    $("pList").innerHTML = r.join(""); $("pTotal").textContent = dur(tot);
    $("pList").querySelectorAll(".prow").forEach(row => {
      const ds = row.dataset.pd;
      const upd = () => {
        const val = id => { const el = row.querySelector(`#${id}-${ds}`); return el ? el.value : ""; };
        const off = row.querySelector(`#po-${ds}`).checked, cut = row.querySelector(`#pc-${ds}`).checked;
        const s = val("ps"), e = val("pe"), s2 = val("ps2"), e2 = val("pe2");
        if (off) dr[ds] = { off: true };
        else if (s || e || cut) dr[ds] = cut ? { start: s, end: e, start2: s2, end2: e2 } : { start: s, end: e };
        else delete dr[ds];
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
    const day = ds => fr(parse(ds), { weekday: "long" });
    for (const [ds, p] of Object.entries(draft())) {
      if (p.off) continue;
      if (!p.start || !p.end) { toast(`Complétez le début et la fin du ${day(ds)}.`); return; }
      if ("start2" in p && (!p.start2 || !p.end2)) { toast(`Complétez la reprise et la fin du ${day(ds)}, ou décochez « Coupure ».`); return; }
      if (p.start2 && toMin(p.end) >= toMin(p.start) && toMin(p.start2) <= toMin(p.end)) { toast(`Le ${day(ds)}, la reprise doit être après le début de la coupure.`); return; }
    }
    S.plans[pKey()] = draft(); pDraft = null; persist(docName("p", pKey())); toast("Planning enregistré"); render();
  };

  // ---------- Réglages ----------
  function renderSet() {
    if (document.activeElement?.id !== "sWeek") $("sWeek").value = S.settings.weekly;
    if (document.activeElement?.id !== "sName") $("sName").value = S.settings.name || "";
  }
  $("sSave").onclick = () => {
    const wk = Math.max(0, Math.min(80, +$("sWeek").value || 0));
    const name = $("sName").value.trim().slice(0, 60);
    S.settings = { weekly: wk, ...(name ? { name } : {}) }; persist("settings"); toast("Réglages enregistrés"); render();
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

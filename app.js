"use strict";

/* ============================================================
   HELPERS AND CONFIG
   ============================================================ */
const $ = id => document.getElementById(id);
const $$ = s => [...document.querySelectorAll(s)];
const ic = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const esc = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CONFIG = {
  api: "https://oxford.uk.eu.org/ai/oxford",
  timeout: 75000,
  routesKey: "transpogo_routes_v9",
  userKey: "transpogo_user",
  themeKey: "transpogo_theme",
  maxTries: 5,
  lockMs: 30000
};
const VEHICLES = ["Bus", "Jeepney", "Tricycle", "UV Express"];
const DISCOUNTS = { Regular: 0, Student: 0.2, Senior: 0.2, PWD: 0.2 };
const HTTP_ERRORS = {
  403: "Service is available only in the Philippines.",
  429: "Too many requests. Wait a minute and try again.",
  413: "Request too large. Use shorter place names."
};
const ACCOUNTS = [
  { username: "admin", password: "admin123", role: "admin" },
  { username: "user", password: "user123", role: "passenger" }
];
const SAMPLE = [
  ["Tuguegarao", "Aparri", "Bus", 150], ["Tuguegarao", "Ilagan", "Bus", 120], ["Tuguegarao", "Enrile", "Jeepney", 40],
  ["Tuguegarao", "Solana", "Jeepney", 25], ["Tuguegarao", "Lallo", "Bus", 90], ["Tuguegarao", "Gattaran", "Bus", 60],
  ["Tuguegarao", "Santo Niño", "Tricycle", 30], ["Tuguegarao", "Baguio", "Bus", 750], ["Tuguegarao", "Manila", "Bus", 900],
  ["Tuguegarao", "Vigan", "Bus", 650], ["Tuguegarao", "Banaue", "Bus", 500], ["Tuguegarao", "Dagupan", "Bus", 600],
  ["Aparri", "Ilagan", "Bus", 200], ["Aparri", "Lallo", "Jeepney", 60], ["Enrile", "Solana", "Tricycle", 20],
  ["Gattaran", "Lallo", "Bus", 45], ["Ilagan", "Baguio", "Bus", 800], ["Manila", "Aparri", "Bus", 850],
  ["Vigan", "Manila", "Bus", 500], ["Manila", "Baguio", "Bus", 450]
];

/* Friendly display names for the default demo accounts so the greeting
   never repeats the username ("Good day, user" next to a "Passenger" pill). */
const DISPLAY_NAMES = { admin: "Administrator", user: "Passenger" };

/* ============================================================
   DATA CLASSES
   ============================================================ */
class Store {
  constructor(key, area = localStorage) { this.key = key; this.area = area; }
  get(fallback) { try { const v = this.area.getItem(this.key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
  set(value) { try { this.area.setItem(this.key, JSON.stringify(value)); } catch {} }
}

class Route {
  constructor(origin, destination, vehicle, fare, id = Date.now()) {
    Object.assign(this, { id, origin, destination, vehicle, fare });
  }
  static isValid(o) { return o && typeof o.origin === "string" && typeof o.destination === "string" && typeof o.fare === "number"; }
  static from(o) { return new Route(o.origin, o.destination, o.vehicle, o.fare, o.id); }
  get title() { return `${this.origin} → ${this.destination}`; }
  same(o, d, v) { return this.origin.toLowerCase() === o.toLowerCase() && this.destination.toLowerCase() === d.toLowerCase() && this.vehicle === v; }
  matches(o, d) { return this.origin.toLowerCase().includes(o.toLowerCase()) && this.destination.toLowerCase().includes(d.toLowerCase()); }
}

class RouteDatabase {
  constructor(store) {
    this.store = store;
    this.items = store.get([]).filter(Route.isValid).map(Route.from);
  }
  save() { this.store.set(this.items); }
  get count() { return this.items.length; }
  places() { return [...new Set(this.items.flatMap(r => [r.origin, r.destination]))].sort(); }
  average() { return this.count ? Math.round(this.items.reduce((s, r) => s + r.fare, 0) / this.count) : 0; }
  countByVehicle() { return VEHICLES.map(v => this.items.filter(r => r.vehicle === v).length); }
  popular() {
    const tally = {};
    this.items.forEach(r => { tally[r.origin] = (tally[r.origin] || 0) + 1; });
    return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }
  find(o, d) { return this.items.filter(r => r.matches(o, d)); }
  filter(query, vehicle) {
    return this.items.filter(r => (!vehicle || r.vehicle === vehicle) && `${r.origin} ${r.destination}`.toLowerCase().includes(query.toLowerCase()));
  }
  has(o, d, v) { return this.items.some(r => r.same(o, d, v)); }
  add(o, d, v, fare) {
    if (this.has(o, d, v)) return false;
    this.items.push(new Route(o, d, v, fare)); this.save(); return true;
  }
  remove(id) { this.items = this.items.filter(r => String(r.id) !== String(id)); this.save(); }
  clear() { this.items = []; this.save(); }
  loadSample() {
    let n = 0;
    SAMPLE.forEach(([o, d, v, f]) => [[o, d], [d, o]].forEach(([a, b]) => {
      if (!this.has(a, b, v)) this.items.push(new Route(a, b, v, f, Date.now() + n++));
    }));
    this.save();
  }
  reference() {
    return this.count ? "\n\nLocal route database for reference:\n" + this.items.map(r => `${r.origin} -> ${r.destination} (${r.vehicle}, PHP ${r.fare})`).join("\n") : "";
  }
}

class Auth {
  constructor(accounts) {
    this.accounts = accounts; this.user = null; this.fails = 0; this.lockUntil = 0;
    this.areas = [localStorage, sessionStorage];
  }
  get isAdmin() { return !!this.user && this.user.role === "admin"; }
  get displayName() {
    if (!this.user) return "";
    return this.user.name || DISPLAY_NAMES[this.user.username.toLowerCase()] || this.user.username;
  }
  get secondsLeft() { return Math.max(0, Math.ceil((this.lockUntil - Date.now()) / 1000)); }
  attempt(username, password) {
    const account = this.accounts.find(a => a.username === username.trim().toLowerCase() && a.password === password);
    if (account) { this.fails = 0; return { ok: true, account }; }
    if (++this.fails >= CONFIG.maxTries) { this.fails = 0; this.lockUntil = Date.now() + CONFIG.lockMs; }
    return { ok: false, left: CONFIG.maxTries - this.fails, locked: this.secondsLeft > 0 };
  }
  signIn(account, remember) {
    this.user = account;
    new Store(CONFIG.userKey, remember ? localStorage : sessionStorage).set({ username: account.username, role: account.role });
  }
  signOut() { this.user = null; this.areas.forEach(a => { try { a.removeItem(CONFIG.userKey); } catch {} }); }
  restore() {
    for (const area of this.areas) {
      const saved = new Store(CONFIG.userKey, area).get(null);
      const account = saved && this.accounts.find(a => a.username === saved.username && a.role === saved.role);
      if (account) { this.user = account; return true; }
    }
    return false;
  }
}

class History {
  constructor(auth) { this.auth = auth; }
  get store() { return new Store("transpogo_hist_" + this.auth.user.username); }
  list() { return this.store.get([]); }
  add(o, d) {
    const rest = this.list().filter(h => !(h.o.toLowerCase() === o.toLowerCase() && h.d.toLowerCase() === d.toLowerCase()));
    this.store.set([{ o, d }, ...rest].slice(0, 8));
  }
}

class AIClient {
  constructor(endpoint, timeout) { this.endpoint = endpoint; this.timeout = timeout; this.jobs = {}; }
  static parse(text) {
    if (!text) return null;
    const t = String(text).replace(/```(?:json)?/gi, "").trim(), s = t.indexOf("{");
    if (s < 0) return null;
    let c = t.slice(s); const last = c.lastIndexOf("}");
    if (last >= 0) c = c.slice(0, last + 1);
    try { return JSON.parse(c); } catch {}
    const stack = []; let inStr = false, esc1 = false;
    for (const ch of c) {
      if (esc1) { esc1 = false; continue; }
      if (ch === "\\") { esc1 = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{" || ch === "[") stack.push(ch); else if (ch === "}" || ch === "]") stack.pop();
    }
    if (inStr) c += '"';
    c = c.replace(/,\s*$/, "");
    while (stack.length) c += stack.pop() === "{" ? "}" : "]";
    try { return JSON.parse(c); } catch { return null; }
  }
  cancel(key) { if (this.jobs[key]) this.jobs[key].abort(); }
  cancelAll() { Object.keys(this.jobs).forEach(k => this.cancel(k)); }
  async ask(key, prompt, maxTokens) {
    if (prompt.length > 24000) throw new Error("Input too long. Use shorter place names.");
    this.cancel(key);
    const ctrl = this.jobs[key] = new AbortController(), timer = setTimeout(() => ctrl.abort(), this.timeout);
    try {
      let res;
      try {
        res = await fetch(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: prompt }], max_tokens: maxTokens }), signal: ctrl.signal });
      } catch (e) {
        throw new Error(e.name === "AbortError" ? "The request timed out or was cancelled. Try again." : "Network error. Check your connection and try again.");
      }
      let data;
      try { data = await res.json(); } catch { throw new Error("The service returned an unreadable response. Try again."); }
      if (!res.ok) throw new Error(HTTP_ERRORS[res.status] || (res.status >= 500 ? "The service is temporarily unavailable. Try again shortly." : data.error || "Something went wrong. Try again."));
      const raw = data.reply || data.assistant || "";
      if (!raw.trim()) throw new Error("No response received. Try different places.");
      return { data: AIClient.parse(raw), raw };
    } finally {
      clearTimeout(timer);
      if (this.jobs[key] === ctrl) delete this.jobs[key];
    }
  }
}

/* ============================================================
   VIEW CLASSES
   ============================================================ */
class View {
  constructor(app) { this.app = app; }
}

class AIView extends View {
  async run(key, prompt, maxTokens, out, render) {
    const btn = $(key + "Btn"), cancel = $(key + "Cancel");
    out.innerHTML = '<div class="skel"></div><div class="skel"></div>';
    btn.disabled = true; btn.classList.add("busy"); cancel.classList.remove("hidden");
    try {
      const { data, raw } = await this.app.ai.ask(key, prompt, maxTokens);
      render(data, raw);
    } catch (e) {
      out.innerHTML = `<div class="note err">${ic("alert")}${esc(e.message)}</div>`;
    } finally {
      if (!this.app.ai.jobs[key]) { btn.disabled = false; btn.classList.remove("busy"); cancel.classList.add("hidden"); }
    }
  }
  fallback(p, raw) { return `<div class="note${p && p.error ? " err" : ""}">${p && p.error ? ic("alert") : ""}${esc((p && p.error) || raw)}</div>`; }
}

class Dashboard extends View {
  bind() {
    $("heroForm").onsubmit = e => {
      e.preventDefault();
      const o = $("dFrom").value.trim(), d = $("dTo").value.trim();
      if (!o || !d) return this.app.toast("Enter a start and a destination");
      $("origin").value = o; $("destination").value = d;
      this.app.go("routes"); this.app.finder.search();
    };
  }
  render() {
    const { db, auth, history } = this.app, adm = auth.isAdmin, pop = db.popular();
    $("dashPassenger").classList.toggle("hidden", adm);
    $("dashAdmin").classList.toggle("hidden", !adm);

    // Header: friendly display name, never repeats "admin"/"user" next to the role pill
    const display = auth.displayName;
    $("greetAvatar").textContent = display.charAt(0).toUpperCase();
    $("greetAvatar").classList.toggle("admin", adm);
    $("rolePill").textContent = adm ? "Admin" : "Passenger";
    $("rolePill").classList.toggle("admin", adm);
    $("greetKicker").textContent = adm ? "Admin console" : "Welcome back";
    $("greet").textContent = `Good day, ${display}`;
    $("greetSub").textContent = adm
      ? "Manage routes, monitor coverage, and keep fares accurate."
      : "Your transportation overview.";

    if (!adm) {
      $("pRoutes").textContent = db.count; $("pAvg").textContent = db.count ? "₱" + db.average() : "—";
      $("pRecent").innerHTML = history.list().slice(0, 5).map(h => `<button class="chip" data-o="${esc(h.o)}" data-d="${esc(h.d)}">${esc(h.o)} → ${esc(h.d)}</button>`).join("") || '<span class="dim">Your searches show up here.</span>';
      $("pPop").innerHTML = pop.map(([n, c]) => `<button class="chip" data-from="${esc(n)}">${esc(n)} · ${c}</button>`).join("") || '<span class="dim">No routes yet. Ask an admin to add some.</span>';
      return;
    }
    const total = db.count, counts = db.countByVehicle(), C = 2 * Math.PI * 40;
    let offset = 0;
    const arcs = counts.map((n, i) => {
      const len = total ? n / total * C : 0;
      const gap = len > 0 ? Math.min(6, len * 0.12) : 0;
      const dash = Math.max(0, len - gap);
      const arc = len > 0
        ? `<circle cx="50" cy="50" r="40" fill="none" stroke="var(--c${i})" stroke-width="12" stroke-linecap="round" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"/>`
        : "";
      offset += len; return arc;
    }).join("");
    $("ring").innerHTML = `<svg viewBox="0 0 100 100" role="img" aria-label="Routes by vehicle"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--field)" stroke-width="12"/>${arcs}<text x="50" y="57" text-anchor="middle" class="rt">${total}</text></svg>`;
    $("legend").innerHTML = VEHICLES.map((v, i) => `<li><i style="background:var(--c${i})"></i>${v}<b>${counts[i]}</b></li>`).join("");
    $("aRoutes").textContent = total; $("aPlaces").textContent = db.places().length; $("aAvg").textContent = total ? "₱" + db.average() : "—";
    $("aPop").innerHTML = pop.map(([n, c]) => `<li><span>${esc(n)}</span><b>${c}</b></li>`).join("") || '<li class="dim">No routes yet.</li>';
    $("aEmpty").classList.toggle("hidden", total > 0);
  }
}

class RouteFinder extends AIView {
  static card(r, tag) {
    const fare = Number(r.fare);
    return `<article class="tile rc"><header><span class="ico">${ic("route")}</span><div><b>${esc(r.origin || "?")} → ${esc(r.destination || "?")}</b><small>${esc(r.vehicle || "—")}</small></div><em class="tag">${tag}</em></header>
<dl><dt>Fare</dt><dd class="fare">${fare > 0 ? "₱" + fare.toFixed(2) : "—"}</dd>${r.travelTime ? `<dt>Travel time</dt><dd>${esc(r.travelTime)}</dd>` : ""}${r.transfers ? `<dt>Transfers</dt><dd>${esc(r.transfers)}</dd>` : ""}</dl>
${r.note ? `<p class="note">${esc(r.note)}</p>` : ""}<button class="btn sec" data-fo="${esc(r.origin || "")}" data-fd="${esc(r.destination || "")}">${ic("cash")}Estimate fare</button></article>`;
  }
  bind() {
    $("routeForm").onsubmit = e => { e.preventDefault(); this.search(); };
    $("routeCancel").onclick = () => this.app.ai.cancel("route");
  }
  search() {
    const o = $("origin").value.trim(), d = $("destination").value.trim(), out = $("routeResults");
    if (!o || !d) { out.innerHTML = '<p class="note">Enter a starting point and a destination.</p>'; return; }
    this.app.history.add(o, d);
    const local = this.app.db.find(o, d);
    $("routeLocal").innerHTML = local.length ? `<h3 class="sec">In your database</h3><div class="grid">${local.map(r => RouteFinder.card(r, "In database")).join("")}</div><h3 class="sec">AI estimate</h3>` : "";
    const prompt = `You are a transportation route expert for the Philippines. A user wants to travel from "${o}" to "${d}".${this.app.db.reference()}\n\nReply with ONLY a valid JSON object, no markdown, no code fences. Use this exact shape:\n{"routes":[{"origin":"","destination":"","vehicle":"","fare":0,"travelTime":"","transfers":"","note":""}]}\nProvide 1-3 route options. Keep each field SHORT: vehicle <= 8 words, travelTime <= 10 words, note <= 25 words. If no route is possible, return {"routes":[],"error":"reason"}.`;
    this.run("route", prompt, 1200, out, (p, raw) => {
      const list = p && Array.isArray(p.routes) ? p.routes.filter(r => r && (r.origin || r.destination || r.vehicle)) : [];
      out.innerHTML = list.length ? `<div class="grid">${list.map(r => RouteFinder.card(r, "AI estimate")).join("")}</div>` : this.fallback(p, raw);
    });
  }
}

class FareCalculator extends AIView {
  constructor(app) { super(app); this.last = null; }
  bind() {
    $("fareForm").onsubmit = e => { e.preventDefault(); this.calculate(); };
    $("fareCancel").onclick = () => this.app.ai.cancel("fare");
    ["ptype", "pcount"].forEach(id => $(id).addEventListener("input", () => this.show()));
  }
  calculate() {
    const o = $("fareOrigin").value.trim(), d = $("fareDestination").value.trim(), out = $("fareResult");
    if (!o || !d) { out.innerHTML = '<p class="note">Enter a starting point and a destination.</p>'; return; }
    this.app.history.add(o, d); this.last = null;
    const prompt = `You are a fare estimation expert for Philippine transportation. A user wants to know the estimated fare from "${o}" to "${d}".${this.app.db.reference()}\n\nReply with ONLY a valid JSON object, no markdown, no code fences. Use this exact shape:\n{"totalFare":0,"travelTime":"","route":"","breakdown":[{"item":"","cost":0}],"additionalCosts":"","note":""}\nKeep fields SHORT. If no estimate is possible, return {"error":"reason"}.`;
    this.run("fare", prompt, 800, out, (p, raw) => { this.last = { p, raw }; this.show(); });
  }
  show() {
    if (!this.last) return;
    const { p, raw } = this.last, out = $("fareResult");
    if (!p || (p.totalFare == null && !p.breakdown)) { out.innerHTML = this.fallback(p, raw); return; }
    const type = $("ptype").value, base = Number(p.totalFare) || 0, rate = DISCOUNTS[type] || 0;
    const people = Math.max(1, parseInt($("pcount").value) || 1), each = base * (1 - rate);
    const money = x => x > 0 ? "₱" + x.toFixed(2) : "—";
    const rows = (Array.isArray(p.breakdown) ? p.breakdown : []).map(b => `<div class="line"><span>${esc(b.item || "Item")}</span><b>${Number.isFinite(+b.cost) ? "₱" + (+b.cost).toFixed(2) : "—"}</b></div>`).join("");
    out.innerHTML = `<div class="grid3"><div class="tile"><span class="lb">Total for ${people}</span><div class="big">${money(each * people)}</div></div><div class="tile"><span class="lb">Per passenger</span><div class="big">${money(each)}</div></div><div class="tile"><span class="lb">Travel time</span><div class="big sm">${esc(p.travelTime || "—")}</div></div></div>
<div class="tile">${p.route ? `<p class="dim">${esc(p.route)}</p>` : ""}${rows}${rate ? `<div class="line"><span>${type} discount (20%)</span><b>-₱${(base * rate).toFixed(2)}</b></div>` : ""}${p.additionalCosts ? `<p class="note">${esc(p.additionalCosts)}</p>` : ""}${p.note ? `<p class="note">${esc(p.note)}</p>` : ""}</div>`;
  }
}

class RouteManager extends View {
  bind() {
    $("addRouteBtn").onclick = () => this.add();
    $("mSearch").addEventListener("input", () => this.render());
    $("mVeh").addEventListener("change", () => this.render());
  }
  add() {
    if (!this.app.auth.isAdmin) return;
    const o = $("newOrigin").value.trim(), d = $("newDestination").value.trim(), v = $("newVehicle").value, f = Number($("newFare").value);
    if (!o || !d || !(f > 0)) return this.app.toast("Fill in every field with a valid fare");
    if (!this.app.db.add(o, d, v, f)) return this.app.toast("That route already exists");
    ["newOrigin", "newDestination", "newFare"].forEach(id => { $(id).value = ""; });
    this.app.refresh(); this.app.toast("Route added");
  }
  render() {
    const { db } = this.app, list = db.filter($("mSearch").value.trim(), $("mVeh").value);
    $("adminRouteList").innerHTML = list.length
      ? list.map(r => `<div class="row tile"><div><b>${esc(r.title)}</b><small>${esc(r.vehicle)} · ₱${Number(r.fare).toFixed(2)}</small></div><button class="btn danger" data-del="${r.id}">${ic("x")}Delete</button></div>`).join("")
      : `<p class="note">${db.count ? "No routes match." : "No routes yet. Add one above or load sample routes."}</p>`;
  }
  export() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(this.app.db.items, null, 2)], { type: "application/json" }));
    a.download = "transpogo-routes.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

/* ============================================================
   APP
   ============================================================ */
class App {
  constructor() {
    this.db = new RouteDatabase(new Store(CONFIG.routesKey));
    this.auth = new Auth(ACCOUNTS);
    this.history = new History(this.auth);
    this.ai = new AIClient(CONFIG.api, CONFIG.timeout);
    this.dashboard = new Dashboard(this);
    this.finder = new RouteFinder(this);
    this.fare = new FareCalculator(this);
    this.manager = new RouteManager(this);
    this.themeStore = new Store(CONFIG.themeKey);
  }

  init() {
    document.documentElement.dataset.theme = this.themeStore.get("dark");
    $("themeBtn").onclick = () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next; this.themeStore.set(next);
    };
    [this.dashboard, this.finder, this.fare, this.manager].forEach(v => v.bind());
    this.bindLogin(); this.bindActions();
    $$("[data-swap]").forEach(b => { b.onclick = () => { const [a, c] = b.dataset.swap.split(",").map($); [a.value, c.value] = [c.value, a.value]; }; });
    this.fillPlaces();
    if (this.auth.restore()) this.enter();
  }

  toast(message) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = message;
    $("toasts").append(t); setTimeout(() => t.remove(), 3200);
  }
  fillPlaces() { $("places").innerHTML = this.db.places().map(p => `<option value="${esc(p)}">`).join(""); }
  refresh() { this.fillPlaces(); if (this.auth.user) { this.dashboard.render(); this.manager.render(); } }

  go(page) {
    if (page === "manage" && !this.auth.isAdmin) return;
    $$(".page").forEach(p => p.classList.add("hidden")); $(page).classList.remove("hidden");
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.page === page));
    this.fillPlaces();
    if (page === "dashboard") this.dashboard.render();
    if (page === "manage") this.manager.render();
  }
  enter() {
    const adm = this.auth.isAdmin, display = this.auth.displayName;
    $("loginPage").classList.add("hidden"); $("appPage").classList.remove("hidden");
    $("welcomeUser").textContent = display;
    $$(".admin-only").forEach(b => b.classList.toggle("hidden", !adm));
    this.go("dashboard");
  }

  bindLogin() {
    const err = $("loginError"), btn = $("loginBtn");
    const tick = () => {
      const s = this.auth.secondsLeft;
      if (s > 0) { err.innerHTML = `${ic("alert")}Too many attempts. Try again in ${s}s.`; btn.disabled = true; setTimeout(tick, 500); }
      else { err.textContent = ""; btn.disabled = false; }
    };
    $("loginForm").addEventListener("submit", e => {
      e.preventDefault();
      if (this.auth.secondsLeft > 0) return;
      const result = this.auth.attempt($("username").value, $("password").value);
      if (!result.ok) {
        const card = $("loginCard"); card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
        if (result.locked) tick();
        else err.innerHTML = `${ic("alert")}Wrong username or password. ${result.left} ${result.left === 1 ? "try" : "tries"} left.`;
        $("password").value = ""; $("password").focus(); return;
      }
      err.textContent = ""; btn.disabled = true; btn.classList.add("busy");
      setTimeout(() => {
        btn.disabled = false; btn.classList.remove("busy");
        this.auth.signIn(result.account, $("remember").checked); this.enter();
      }, 500);
    });
    $("eye").onclick = () => { const p = $("password"); p.type = p.type === "password" ? "text" : "password"; };
    $("password").addEventListener("keyup", e => $("caps").classList.toggle("hidden", !(e.getModifierState && e.getModifierState("CapsLock"))));
    $$("[data-u]").forEach(b => { b.onclick = () => { $("username").value = b.dataset.u; $("password").value = b.dataset.p; }; });
    $("logoutBtn").onclick = () => {
      this.ai.cancelAll(); this.auth.signOut();
      $("appPage").classList.add("hidden"); $("loginPage").classList.remove("hidden");
      $("loginForm").reset(); err.textContent = ""; $("username").focus();
    };
  }

  bindActions() {
    const adminActions = {
      export: () => this.manager.export(),
      sample: () => { this.db.loadSample(); this.refresh(); this.toast("Sample routes loaded"); },
      reset: () => { if (confirm("Remove all routes?")) { this.db.clear(); this.refresh(); this.toast("Routes cleared"); } }
    };
    document.addEventListener("click", e => {
      const t = e.target.closest("[data-page],[data-act],[data-o],[data-from],[data-fo],[data-del]");
      if (!t) return;
      const d = t.dataset;
      if (d.page) this.go(d.page);
      else if (d.act && this.auth.isAdmin) adminActions[d.act]();
      else if (d.o !== undefined) { $("dFrom").value = d.o; $("dTo").value = d.d; }
      else if (d.from !== undefined) { $("dFrom").value = d.from; $("dTo").focus(); }
      else if (d.fo !== undefined) { $("fareOrigin").value = d.fo; $("fareDestination").value = d.fd; this.go("fare"); $("fareBtn").focus(); }
      else if (d.del && this.auth.isAdmin) { this.db.remove(d.del); this.refresh(); this.toast("Route deleted"); }
    });
  }
}

new App().init();

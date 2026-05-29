const SESSION_KEY = "trip-split-session-v2";

const categoryList = ["ที่พัก", "เดินทาง", "อาหาร", "กิจกรรม", "อื่นๆ"];
const refundCategoryList = ["เงินคืน", "ส่วนลด", "สนับสนุน"];
const categoryIcons = {
  "ที่พัก": "🏨",
  "เดินทาง": "🚗",
  "อาหาร": "🍜",
  "กิจกรรม": "🎟",
  "อื่นๆ": "📌",
  "เงินคืน": "↩",
  "ส่วนลด": "%",
  "สนับสนุน": "＋",
};
const categoryColors = {
  "ที่พัก": "#2f82f6",
  "เดินทาง": "#22a6b3",
  "อาหาร": "#ff6b6b",
  "กิจกรรม": "#f7b731",
  "อื่นๆ": "#a7b1b5",
};

const SUPABASE_URL = "https://fqitbwbpniribbhbgfbb.supabase.co";
// Publishable key — safe to ship in client code (maps to the anon role, guarded by RLS).
const SUPABASE_KEY = "sb_publishable_SqQVH0oBwuEr0CGk22kUng_wdVFtNt4";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Trips live in the cloud so every device sees the same data. `store` is just an
// in-memory cache of trips loaded from Supabase, keyed by code. Only this device's
// identity/tokens stay in localStorage via `session`.
let store = { trips: {} };
let session = loadSession();

const app = document.querySelector("#app");

let activeChannel = null;
// The signed-in Google user (null when logged out).
let currentUser = null;

function defaultName() {
  return currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || "";
}

function loadSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return {};

  try {
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

// Load a single trip by code into the cache. Returns the trip or null.
async function fetchTrip(code) {
  const { data, error } = await sb
    .from("trips")
    .select("data")
    .eq("code", code)
    .maybeSingle();
  if (error) {
    showToast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    return store.trips[code] || null;
  }
  if (!data) return null;
  store.trips[code] = normalizeTripData(data.data);
  return store.trips[code];
}

// Load every trip this device belongs to (the codes saved in `session`).
async function fetchMyTrips() {
  const codes = Object.keys(session);
  if (!codes.length) {
    store.trips = {};
    return;
  }
  const { data, error } = await sb.from("trips").select("code,data").in("code", codes);
  if (error) {
    showToast("โหลดทริปไม่สำเร็จ");
    return;
  }
  store.trips = {};
  data.forEach((row) => {
    store.trips[row.code] = normalizeTripData(row.data);
  });
}

// Upsert one trip's full state to the cloud (last write wins).
async function saveTrip(trip) {
  store.trips[trip.code] = trip;
  const { error } = await sb.from("trips").upsert({ code: trip.code, data: trip });
  if (error) showToast("บันทึกขึ้นคลาวด์ไม่สำเร็จ");
}

// Subscribe to live changes for one trip; pass null to stop watching.
function watchTrip(code) {
  if (activeChannel) {
    sb.removeChannel(activeChannel);
    activeChannel = null;
  }
  if (!code) return;
  activeChannel = sb
    .channel(`trip-${code}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "trips", filter: `code=eq.${code}` },
      (payload) => onTripChange(code, payload),
    )
    .subscribe();
}

function onTripChange(code, payload) {
  const params = new URLSearchParams(location.search);
  if (params.get("trip") !== code) return;

  if (payload.eventType === "DELETE") {
    delete store.trips[code];
    history.pushState(null, "", location.pathname);
    renderStart();
    showToast("ทริปนี้ถูกลบแล้ว");
    return;
  }

  store.trips[code] = normalizeTripData(payload.new.data);
  const access = getTripAccess(store.trips[code]);
  if (access.type !== "member") {
    route();
    return;
  }
  // Don't yank the UI out from under someone who is mid-typing.
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  renderDashboard(store.trips[code]);
}

function renderLogin() {
  watchTrip(null);
  app.className = "app-shell auth-shell";
  app.innerHTML = `
    <section class="auth-card login-card">
      <img class="login-art" src="assets/logo.png" alt="" />
      <h1 class="login-title">Trip Split</h1>
      <p class="muted">เข้าสู่ระบบเพื่อสร้างและแชร์ทริปข้ามอุปกรณ์</p>
      <button class="primary-button google-button" id="googleLogin" type="button">
        <svg class="google-icon" width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.33z"/>
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.67 5.16 6.66 3.58 9 3.58z"/>
        </svg>
        <span>เข้าสู่ระบบด้วย Google</span>
      </button>
    </section>
  `;

  document.querySelector("#googleLogin").addEventListener("click", async () => {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname + location.search },
    });
    if (error) showToast("เข้าสู่ระบบไม่สำเร็จ");
  });
}

async function route() {
  if (!currentUser) {
    renderLogin();
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const tripCode = normalizeCode(params.get("trip") || "");
  if (tripCode) await fetchTrip(tripCode);
  const currentTrip = tripCode ? store.trips[tripCode] : null;
  const access = currentTrip ? getTripAccess(currentTrip) : { type: "none" };

  if (tripCode && currentTrip && access.type === "none") {
    renderJoin(currentTrip);
    return;
  }

  if (tripCode && currentTrip && access.type === "pending") {
    renderPending(currentTrip, access.request);
    return;
  }

  if (tripCode && currentTrip && access.type === "rejected") {
    renderRejected(currentTrip, access.request);
    return;
  }

  if (tripCode && currentTrip && access.type === "member") {
    renderDashboard(currentTrip);
    return;
  }

  renderStart();
}

async function renderStart() {
  watchTrip(null);
  await fetchMyTrips();
  const recentTrips = getRecentTrips();
  app.className = "app-shell auth-shell";
  app.innerHTML = `
    <section class="welcome">
      <div class="brand-row">
        <img class="logo" src="assets/logo.png" alt="" />
        <div>
          <h1>Trip Split</h1>
          <p>สร้างทริป แชร์ลิงก์ให้น้อง แล้วช่วยกันลงค่าใช้จ่าย</p>
        </div>
        <button class="secondary-button" id="logoutButton" type="button">ออกจากระบบ</button>
      </div>
      <div class="choice-grid">
        <button class="choice-card" id="showCreate" type="button">
          <img class="choice-art" src="assets/create-trip.png" alt="" />
          <strong>สร้างทริปใหม่</strong>
          <small>ตั้งชื่อทริป วันเดินทาง และชื่อเล่นของคุณ</small>
        </button>
        <button class="choice-card" id="showJoin" type="button">
          <img class="choice-art" src="assets/join-trip.png.png" alt="" />
          <strong>เข้าร่วมทริป</strong>
          <small>กรอกรหัสที่เพื่อนส่งมา แล้วใส่ชื่อเล่นก่อนเข้า</small>
        </button>
      </div>
      ${recentTrips.length ? `
        <section class="recent-trips">
          <div class="panel-title">
            <h2>ทริปที่เคยสร้าง</h2>
            <span>${recentTrips.length} ทริป</span>
          </div>
          <div class="recent-trip-list">
            ${recentTrips.map((trip) => {
              const totals = getTotals(trip);
              return `
                <article class="recent-trip-card">
                  <button class="trip-delete-button" type="button" data-delete-trip="${escapeHtml(trip.code)}" title="ลบทริป" aria-label="ลบทริป ${escapeHtml(trip.name)}">×</button>
                  <div class="item-meta">
                    <strong>${escapeHtml(trip.name)}</strong>
                    <span>${formatDateRange(trip)} · ${escapeHtml(trip.code)}</span>
                  </div>
                  <div class="recent-trip-meta">
                    <span>${trip.members.length} คน</span>
                    <strong>${money(trip, totals.total)}</strong>
                  </div>
                  <button class="secondary-button" type="button" data-open-trip="${escapeHtml(trip.code)}">เปิดแดชบอร์ด</button>
                </article>
              `;
            }).join("")}
          </div>
        </section>
      ` : ""}
    </section>
  `;

  document.querySelector("#showCreate").addEventListener("click", renderCreateTrip);
  document.querySelector("#showJoin").addEventListener("click", renderJoinByCode);
  document.querySelector("#logoutButton").addEventListener("click", () => sb.auth.signOut());
  document.querySelectorAll("[data-open-trip]").forEach((button) => {
    button.addEventListener("click", () => openTrip(button.dataset.openTrip));
  });
  document.querySelectorAll("[data-delete-trip]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteTrip(button.dataset.deleteTrip);
    });
  });
}

function renderCreateTrip() {
  app.className = "app-shell auth-shell";
  app.innerHTML = `
    <section class="auth-card">
      <button class="back-button" type="button" data-back>ย้อนกลับ &lt;</button>
      <img class="form-art" src="assets/create-trip.png" alt="" />
      <h1>สร้างทริปใหม่</h1>
      <form id="createTripForm" class="stack-form">
        <label>ชื่อทริป
          <input id="newTripName" type="text" placeholder="เช่น เชียงใหม่ 2026" autocomplete="off" required />
        </label>
        <div class="two-col">
          <label>วันเริ่มต้น
            <input id="startDate" type="date" required />
          </label>
          <label>วันสิ้นสุด
            <input id="endDate" type="date" required />
          </label>
        </div>
        <label>ชื่อเล่นของคุณ
          <input id="ownerName" type="text" placeholder="เช่น กอล์ฟ" autocomplete="off" value="${escapeHtml(defaultName())}" required />
        </label>
        <button class="primary-button" type="submit">สร้างทริป</button>
      </form>
    </section>
  `;

  bindBackButtons();
  document.querySelector("#createTripForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = createCode();
    const ownerName = document.querySelector("#ownerName").value.trim();
    const ownerId = crypto.randomUUID();

    const trip = {
      code,
      name: document.querySelector("#newTripName").value.trim(),
      startDate: document.querySelector("#startDate").value,
      endDate: document.querySelector("#endDate").value,
      currency: "฿",
      ownerId,
      members: [{ id: ownerId, name: ownerName }],
      joinRequests: [],
      expenses: [],
      createdAt: new Date().toISOString(),
    };

    seedExampleExpenses(trip, ownerId);
    store.trips[code] = trip;
    session[code] = ownerId;
    saveTrip(trip);
    saveSession();
    history.pushState(null, "", `?trip=${code}`);
    renderInvite(trip);
  });
}

function renderJoinByCode() {
  app.className = "app-shell auth-shell";
  app.innerHTML = `
    <section class="auth-card">
      <button class="back-button" type="button" data-back>ย้อนกลับ &lt;</button>
      <img class="form-art" src="assets/join-trip.png.png" alt="" />
      <h1>เข้าร่วมทริป</h1>
      <form id="codeForm" class="stack-form">
        <label>รหัสทริป
          <input id="tripCodeInput" type="text" placeholder="เช่น TRIP-8XK29Q" autocomplete="off" required />
        </label>
        <button class="primary-button" type="submit">ไปต่อ</button>
      </form>
    </section>
  `;

  bindBackButtons();
  document.querySelector("#codeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = normalizeCode(document.querySelector("#tripCodeInput").value);
    const trip = await fetchTrip(code);
    if (!trip) {
      showToast("ไม่พบทริปนี้");
      return;
    }
    history.pushState(null, "", `?trip=${code}`);
    renderJoin(trip);
  });
}

function renderJoin(trip) {
  app.className = "app-shell auth-shell";
  app.innerHTML = `
    <section class="auth-card">
      <button class="back-button" type="button" data-back>ย้อนกลับ &lt;</button>
      <img class="form-art" src="assets/join-trip.png.png" alt="" />
      <p class="eyebrow">${escapeHtml(trip.code)}</p>
      <h1>${escapeHtml(trip.name)}</h1>
      <form id="joinForm" class="stack-form">
        <label>ชื่อเล่น
          <input id="joinName" type="text" placeholder="เช่น น้อง" autocomplete="off" value="${escapeHtml(defaultName())}" required />
        </label>
        <button class="primary-button" type="submit">เข้าร่วมทริป</button>
      </form>
    </section>
  `;

  bindBackButtons();
  document.querySelector("#joinForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.querySelector("#joinName").value.trim();
    const request = {
      id: crypto.randomUUID(),
      nickname: name,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    trip.joinRequests.push(request);
    session[trip.code] = `request:${request.id}`;
    saveTrip(trip);
    saveSession();
    renderPending(trip, request);
  });
}

function renderPending(trip, request) {
  watchTrip(trip.code);
  app.className = "app-shell auth-shell";
  app.innerHTML = `
    <section class="auth-card">
      <button class="back-button" type="button" data-back>ย้อนกลับ &lt;</button>
      <div class="form-art party" aria-hidden="true"></div>
      <p class="eyebrow">${escapeHtml(trip.code)}</p>
      <h1>รอเจ้าของทริปอนุมัติ</h1>
      <p class="muted">${escapeHtml(request.nickname)} ส่งคำขอเข้าร่วมทริป ${escapeHtml(trip.name)} แล้ว</p>
      <button class="primary-button" id="checkApproval" type="button">ตรวจสถานะอีกครั้ง</button>
    </section>
  `;

  bindBackButtons();
  document.querySelector("#checkApproval").addEventListener("click", route);
}

function renderRejected(trip, request) {
  app.className = "app-shell auth-shell";
  app.innerHTML = `
    <section class="auth-card">
      <button class="back-button" type="button" data-back>ย้อนกลับ &lt;</button>
      <img class="form-art" src="assets/join-trip.png.png" alt="" />
      <p class="eyebrow">${escapeHtml(trip.code)}</p>
      <h1>คำขอไม่ได้รับอนุมัติ</h1>
      <p class="muted">${escapeHtml(request.nickname)} ยังเข้าแดชบอร์ดทริปนี้ไม่ได้</p>
      <button class="primary-button" id="tryJoinAgain" type="button">ส่งคำขอใหม่</button>
    </section>
  `;

  bindBackButtons();
  document.querySelector("#tryJoinAgain").addEventListener("click", () => {
    delete session[trip.code];
    saveSession();
    renderJoin(trip);
  });
}

function renderInvite(trip) {
  app.className = "app-shell auth-shell";
  app.innerHTML = `
    <section class="auth-card">
      <button class="close-button" type="button" data-dashboard>×</button>
      <div class="form-art party" aria-hidden="true"></div>
      <p class="eyebrow">${escapeHtml(trip.code)}</p>
      <h1>ทริปของคุณสร้างสำเร็จแล้ว</h1>
      <p class="muted">แชร์ลิงก์นี้ให้น้องเพื่อเข้าร่วมทริป</p>
      <div class="copy-row">
        <input id="shareLink" type="text" readonly value="${escapeHtml(getShareLink(trip.code))}" />
        <button id="copyLink" class="icon-button" type="button" title="คัดลอกลิงก์">⧉</button>
      </div>
      <div class="share-actions">
        <button type="button">LINE</button>
        <button type="button">Messenger</button>
        <button type="button" id="copyCode">คัดลอกรหัส</button>
      </div>
      <button class="primary-button" type="button" data-dashboard>เข้าแดชบอร์ด</button>
    </section>
  `;

  document.querySelectorAll("[data-dashboard]").forEach((button) => {
    button.addEventListener("click", () => renderDashboard(trip));
  });
  document.querySelector("#copyLink").addEventListener("click", () => copyText(getShareLink(trip.code), "คัดลอกลิงก์แล้ว"));
  document.querySelector("#copyCode").addEventListener("click", () => copyText(trip.code, "คัดลอกรหัสแล้ว"));
}

function renderDashboard(trip) {
  watchTrip(trip.code);
  app.className = "app-shell";
  const totals = getTotals(trip);
  const settlements = getSettlements(trip);
  const currentMember = getCurrentMember(trip);
  const headline = settlements.length
    ? `${settlements[0].from} ต้องโอนให้ ${settlements[0].to}`
    : totals.total > 0
      ? "ยอดลงตัวแล้ว"
      : "เริ่มลงรายจ่ายแรกได้เลย";

  app.innerHTML = `
    <section class="trip-hero ${trip.coverImage ? "has-cover" : ""}" style="${getCoverStyle(trip)}">
      <div class="trip-topbar">
        <button class="icon-button" id="leaveTrip" type="button" title="ออกจากทริป">☰</button>
        <div class="trip-actions">
          <button class="icon-button" id="changeCover" type="button" title="เปลี่ยนภาพปก">▧</button>
          <button class="icon-button" id="openInvite" type="button" title="แชร์ลิงก์">⚙</button>
        </div>
      </div>
      <div>
        <p class="eyebrow">${formatDateRange(trip)}</p>
        <h1>${escapeHtml(trip.name)}</h1>
        <span class="trip-chip">${escapeHtml(trip.code)}</span>
      </div>
      <input id="coverInput" type="file" accept="image/*" hidden />
      <div class="temple-art" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
    </section>

    <section class="dashboard-money">
      <article class="money-total-card">
        <span>ยอดรวมทั้งหมด</span>
        <strong>${money(trip, totals.total)}</strong>
        <small>เฉลี่ย ${money(trip, totals.share)} / คน</small>
      </article>
      <div class="paid-card-grid">
        ${totals.balances.map((person) => `
          <article class="paid-card ${person.balance >= 0 ? "is-positive" : "is-negative"}">
            <span>${escapeHtml(person.name)} จ่ายไป</span>
            <strong>${money(trip, person.paid)}</strong>
          </article>
        `).join("")}
      </div>
      <article class="settlement-card">
        <span>สรุปยอดที่ต้องจ่าย</span>
        <strong>${escapeHtml(headline)}</strong>
        <b>${settlements[0] ? money(trip, settlements[0].amount) : totals.total > 0 ? money(trip, 0) : ""}</b>
      </article>
    </section>

    <div class="content-grid">
      <section class="panel">
        <div class="panel-title">
          <h2>แดชบอร์ด</h2>
          <span>${trip.members.length} คน</span>
        </div>
        <div class="donut-row">
          <div class="donut" style="${getDonutStyle(trip)}"></div>
          <div id="categoryList" class="category-list"></div>
        </div>
      </section>

      <section class="panel expense-panel">
        <div class="panel-title">
          <h2>เพิ่มรายการ</h2>
          <span id="payerDisplayName">โดย ${escapeHtml(currentMember?.name || "-")}</span>
        </div>
        <form id="expenseForm" class="expense-form">
          <div class="mode-toggle" role="group" aria-label="ประเภทรายการ">
            <label>
              <input type="radio" name="entryType" value="expense" checked />
              <span>รายจ่าย</span>
            </label>
            <label>
              <input type="radio" name="entryType" value="refund" />
              <span>เงินคืน</span>
            </label>
          </div>
          <label>รายการ
            <input id="expenseTitle" type="text" placeholder="เช่น โรงแรม, น้ำมัน, แม่ให้คืน" autocomplete="off" required />
          </label>
          <label>จำนวนเงิน
            <input id="expenseAmount" type="number" min="0" step="0.01" placeholder="0.00" required />
          </label>
          <label><span id="payerLabel">ใครจ่าย</span>
            <select id="expensePayer" required></select>
          </label>
          <label>หมวดหมู่
            <select id="expenseCategory">
              ${categoryList.map((name) => `<option value="${name}">${name}</option>`).join("")}
            </select>
          </label>
          <button class="primary-button" id="expenseSubmit" type="submit">บันทึกรายจ่าย</button>
        </form>
      </section>

      <section class="panel">
        <div class="panel-title">
          <h2>รายการค่าใช้จ่าย</h2>
          <span>${trip.expenses.length} รายการ</span>
        </div>
        <div id="expenseList" class="expense-list"></div>
      </section>

      <section class="panel settlement-panel">
        <div class="panel-title">
          <h2>Settlement</h2>
          <span>${money(trip, totals.total)}</span>
        </div>
        <div id="settlementList" class="settlement-list"></div>
        <div class="balance-box">
          <h3>ยอดจ่ายสะสม</h3>
          <div id="balanceList"></div>
        </div>
      </section>

      <section class="panel members-panel">
        <div class="panel-title">
          <h2>สมาชิกในทริป</h2>
          <span>${trip.members.length} คน</span>
        </div>
        <div id="memberList" class="member-list"></div>
        ${isTripOwner(trip) ? `
          <div class="approval-box">
            <div class="panel-title">
              <h3>คำขอเข้าร่วม</h3>
              <span>${getPendingRequests(trip).length} รออนุมัติ</span>
            </div>
            <div id="requestList" class="request-list"></div>
          </div>
        ` : ""}
      </section>
    </div>
  `;

  renderMembers(trip, totals.balances);
  if (isTripOwner(trip)) renderJoinRequests(trip);
  renderCategoryList(trip);
  renderExpensePayers(trip);
  renderExpenses(trip);
  renderSettlements(trip, settlements);
  renderBalances(trip, totals.balances);
  bindDashboard(trip);
}

function bindDashboard(trip) {
  document.querySelector("#leaveTrip").addEventListener("click", () => {
    history.pushState(null, "", location.pathname);
    renderStart();
  });
  document.querySelector("#openInvite").addEventListener("click", () => renderInvite(trip));
  document.querySelector("#changeCover").addEventListener("click", () => {
    document.querySelector("#coverInput").click();
  });
  document.querySelector("#coverInput").addEventListener("change", (event) => {
    changeCover(trip, event.target.files[0]);
  });
  document.querySelectorAll('input[name="entryType"]').forEach((input) => {
    input.addEventListener("change", updateEntryFormMode);
  });
  updateEntryFormMode();
  document.querySelector("#expensePayer").addEventListener("change", (event) => {
    const member = trip.members.find((m) => m.id === event.target.value);
    const display = document.querySelector("#payerDisplayName");
    if (display && member) display.textContent = `โดย ${member.name}`;
  });
  document.querySelector("#expenseForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(document.querySelector("#expenseAmount").value);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const type = document.querySelector('input[name="entryType"]:checked').value;

    trip.expenses.push({
      id: crypto.randomUUID(),
      type,
      title: document.querySelector("#expenseTitle").value.trim(),
      amount,
      payerId: document.querySelector("#expensePayer").value,
      category: document.querySelector("#expenseCategory").value,
      createdAt: new Date().toISOString(),
    });
    saveTrip(trip);
    renderDashboard(trip);
  });
}

function updateEntryFormMode() {
  const type = document.querySelector('input[name="entryType"]:checked')?.value || "expense";
  const categorySelect = document.querySelector("#expenseCategory");
  const payerLabel = document.querySelector("#payerLabel");
  const submitButton = document.querySelector("#expenseSubmit");
  const titleInput = document.querySelector("#expenseTitle");
  const categories = type === "refund" ? refundCategoryList : categoryList;

  categorySelect.innerHTML = categories.map((name) => `<option value="${name}">${name}</option>`).join("");
  payerLabel.textContent = type === "refund" ? "ใครรับเงิน" : "ใครจ่าย";
  submitButton.textContent = type === "refund" ? "บันทึกเงินคืน" : "บันทึกรายจ่าย";
  titleInput.placeholder = type === "refund" ? "เช่น แม่ให้คืน, ส่วนลดที่พัก" : "เช่น โรงแรม, น้ำมัน, อาหารเย็น";
}

function renderJoinRequests(trip) {
  const list = document.querySelector("#requestList");
  if (!list) return;
  const pendingRequests = getPendingRequests(trip);

  if (!pendingRequests.length) {
    list.innerHTML = `<div class="empty-state">ยังไม่มีคำขอใหม่</div>`;
    return;
  }

  list.innerHTML = pendingRequests
    .map((request) => `
      <div class="request-item">
        <div class="avatar">${avatar(request.nickname)}</div>
        <div class="item-meta">
          <strong>${escapeHtml(request.nickname)}</strong>
          <span>ขอเข้าร่วมทริปนี้</span>
        </div>
        <div class="request-actions">
          <button class="secondary-button" type="button" data-approve-request="${request.id}">อนุมัติ</button>
          <button class="danger-button" type="button" data-reject-request="${request.id}" title="ปฏิเสธ">×</button>
        </div>
      </div>
    `)
    .join("");

  document.querySelectorAll("[data-approve-request]").forEach((button) => {
    button.addEventListener("click", () => approveRequest(trip, button.dataset.approveRequest));
  });
  document.querySelectorAll("[data-reject-request]").forEach((button) => {
    button.addEventListener("click", () => rejectRequest(trip, button.dataset.rejectRequest));
  });
}

function bindBackButtons() {
  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => {
      history.pushState(null, "", location.pathname);
      renderStart();
    });
  });
}

function getRecentTrips() {
  return Object.values(store.trips)
    .map((trip) => normalizeTripData(trip))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function openTrip(code) {
  const trip = store.trips[code];
  if (!trip) return;

  history.pushState(null, "", `?trip=${trip.code}`);
  const access = getTripAccess(trip);
  if (access.type === "member") {
    renderDashboard(trip);
    return;
  }
  if (access.type === "pending") {
    renderPending(trip, access.request);
    return;
  }
  if (access.type === "rejected") {
    renderRejected(trip, access.request);
    return;
  }
  renderJoin(trip);
}

async function deleteTrip(code) {
  const trip = store.trips[code];
  if (!trip) return;

  const confirmed = window.confirm(`ลบทริป "${trip.name}" ใช่ไหม?`);
  if (!confirmed) return;

  delete store.trips[code];
  delete session[code];
  saveSession();
  const { error } = await sb.from("trips").delete().eq("code", code);
  if (error) showToast("ลบบนคลาวด์ไม่สำเร็จ");

  if (new URLSearchParams(location.search).get("trip") === code) {
    history.pushState(null, "", location.pathname);
  }

  renderStart();
  showToast("ลบทริปแล้ว");
}

async function changeCover(trip, file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("เลือกไฟล์รูปภาพเท่านั้น");
    return;
  }

  showToast("กำลังอัปโหลดรูป…");
  try {
    const blob = await resizeCoverImage(file);
    const path = `${trip.code}-${Date.now()}.jpg`;
    const { error } = await sb.storage
      .from("covers")
      .upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    const { data } = sb.storage.from("covers").getPublicUrl(path);
    trip.coverImage = data.publicUrl;
    await saveTrip(trip);
    renderDashboard(trip);
    showToast("เปลี่ยนภาพปกแล้ว");
  } catch {
    showToast("อัปโหลดรูปไม่สำเร็จ");
  }
}

// Read, downscale, and re-encode the chosen image into a JPEG Blob for upload.
function resizeCoverImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(new Error("read")));
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("error", () => reject(new Error("decode")));
      image.addEventListener("load", () => {
        const maxWidth = 1600;
        const scale = Math.min(1, maxWidth / image.naturalWidth);
        const width = Math.round(image.naturalWidth * scale);
        const height = Math.round(image.naturalHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(image, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("encode"))),
          "image/jpeg",
          0.86,
        );
      });
      image.src = reader.result;
    });
    reader.readAsDataURL(file);
  });
}

function getCoverStyle(trip) {
  if (!trip.coverImage) return "";
  return `background-image:url("${trip.coverImage}")`;
}

function approveRequest(trip, requestId) {
  const request = trip.joinRequests.find((item) => item.id === requestId);
  if (!request || request.status !== "pending") return;

  const member = { id: crypto.randomUUID(), name: request.nickname };
  trip.members.push(member);
  request.status = "approved";
  request.memberId = member.id;
  request.reviewedAt = new Date().toISOString();
  saveTrip(trip);
  renderDashboard(trip);
  showToast(`อนุมัติ ${request.nickname} แล้ว`);
}

function rejectRequest(trip, requestId) {
  const request = trip.joinRequests.find((item) => item.id === requestId);
  if (!request || request.status !== "pending") return;

  request.status = "rejected";
  request.reviewedAt = new Date().toISOString();
  saveTrip(trip);
  renderDashboard(trip);
  showToast(`ปฏิเสธ ${request.nickname} แล้ว`);
}

function removeMember(trip, memberId) {
  if (memberId === trip.ownerId) return;
  const member = trip.members.find((item) => item.id === memberId);
  if (!member) return;

  const confirmed = window.confirm(`ลบ ${member.name} ออกจากทริปใช่ไหม? รายจ่ายที่เขาเป็นคนจ่ายจะถูกลบด้วย`);
  if (!confirmed) return;

  trip.members = trip.members.filter((item) => item.id !== memberId);
  trip.expenses = trip.expenses.filter((expense) => expense.payerId !== memberId);
  trip.joinRequests.forEach((request) => {
    if (request.memberId === memberId) request.status = "removed";
  });
  saveTrip(trip);
  renderDashboard(trip);
  showToast(`ลบ ${member.name} แล้ว`);
}

function getPendingRequests(trip) {
  return (trip.joinRequests || []).filter((request) => request.status === "pending");
}

function isTripOwner(trip) {
  return session[trip.code] === trip.ownerId;
}

function getTripAccess(trip) {
  normalizeTripData(trip);
  const token = session[trip.code];
  if (!token) return { type: "none" };
  if (trip.members.some((member) => member.id === token)) return { type: "member" };

  if (String(token).startsWith("request:")) {
    const requestId = String(token).replace("request:", "");
    const request = trip.joinRequests.find((item) => item.id === requestId);
    if (!request) return { type: "none" };
    if (request.status === "approved" && request.memberId) {
      session[trip.code] = request.memberId;
      saveSession();
      return { type: "member" };
    }
    return { type: request.status, request };
  }

  return { type: "none" };
}

function normalizeTripData(trip) {
  trip.members = Array.isArray(trip.members) ? trip.members : [];
  trip.expenses = Array.isArray(trip.expenses) ? trip.expenses : [];
  trip.joinRequests = Array.isArray(trip.joinRequests) ? trip.joinRequests : [];
  trip.ownerId = trip.ownerId || trip.members[0]?.id || "";
  return trip;
}

function renderMembers(trip, balances) {
  const list = document.querySelector("#memberList");
  list.innerHTML = balances
    .map((person) => `
      <div class="member-item">
        <div class="avatar">${avatar(person.name)}</div>
        <div class="item-meta">
          <strong>${escapeHtml(person.name)}</strong>
          <span>จ่ายไปแล้ว ${money(trip, person.paid)}</span>
        </div>
        <span class="pill ${person.balance >= 0 ? "positive" : "negative"}">
          ${person.balance >= 0 ? "ควรได้คืน" : "ควรจ่ายเพิ่ม"}
        </span>
        ${isTripOwner(trip) && person.id !== trip.ownerId ? `
          <button class="expense-delete-btn" type="button" data-remove-member="${person.id}" title="ลบสมาชิก">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>` : ""}
      </div>
    `)
    .join("");

  document.querySelectorAll("[data-remove-member]").forEach((button) => {
    button.addEventListener("click", () => removeMember(trip, button.dataset.removeMember));
  });
}

function renderCategoryList(trip) {
  const totals = getCategoryTotals(trip);
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const list = document.querySelector("#categoryList");

  list.innerHTML = categoryList
    .filter((name) => totals[name] > 0)
    .map((name) => `
      <div class="category-row">
        <span style="background:${categoryColors[name]}"></span>
        <strong>${name}</strong>
        <small>${money(trip, totals[name])} (${Math.round((totals[name] / total) * 100)}%)</small>
      </div>
    `)
    .join("") || `<div class="empty-state">ยังไม่มีหมวดค่าใช้จ่าย</div>`;
}

function renderExpensePayers(trip) {
  const select = document.querySelector("#expensePayer");
  select.innerHTML = trip.members
    .map((member) => `<option value="${member.id}" ${member.id === session[trip.code] ? "selected" : ""}>${escapeHtml(member.name)}</option>`)
    .join("");
}

function renderExpenses(trip) {
  const list = document.querySelector("#expenseList");
  if (!trip.expenses.length) {
    list.innerHTML = `<div class="empty-state">ยังไม่มีรายการในทริปนี้</div>`;
    return;
  }

  list.innerHTML = trip.expenses
    .slice()
    .reverse()
    .map((expense) => {
      const type = expense.type || "expense";
      const payer = trip.members.find((member) => member.id === expense.payerId);
      const iconSrc = type === "refund" ? "assets/Green.png" : "assets/Red.png";
      return `
        <div class="expense-item ${type === "refund" ? "refund-item" : ""}">
          <div class="category-dot">
            <img src="${iconSrc}" alt="" />
          </div>
          <div class="item-meta">
            <strong>${escapeHtml(expense.title)}</strong>
            <span>${type === "refund" ? "เงินคืน" : escapeHtml(expense.category)} · ${type === "refund" ? "รับโดย" : "จ่ายโดย"} ${escapeHtml(payer?.name || "สมาชิกที่ถูกลบ")}</span>
          </div>
          <div class="amount ${type === "refund" ? "positive" : ""}">${type === "refund" ? "-" : ""}${money(trip, expense.amount)}</div>
          <button class="expense-delete-btn" type="button" data-remove-expense="${expense.id}" title="ลบ">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll("[data-remove-expense]").forEach((button) => {
    button.addEventListener("click", () => {
      trip.expenses = trip.expenses.filter((expense) => expense.id !== button.dataset.removeExpense);
      saveTrip(trip);
      renderDashboard(trip);
    });
  });
}

function renderSettlements(trip, settlements) {
  const list = document.querySelector("#settlementList");
  if (!getExpenseItems(trip).length) {
    list.innerHTML = `<div class="empty-state">เมื่อมีรายจ่ายแล้ว ระบบจะสรุปยอดโอนให้อัตโนมัติ</div>`;
    return;
  }

  if (!settlements.length) {
    list.innerHTML = `<div class="empty-state">ทุกคนจ่ายเท่ากันแล้ว ไม่ต้องโอนเพิ่ม</div>`;
    return;
  }

  list.innerHTML = settlements
    .map((settlement) => `
      <div class="settlement-item">
        <span>${escapeHtml(settlement.from)}</span>
        <strong>${money(trip, settlement.amount)}</strong>
        <span>โอนให้ ${escapeHtml(settlement.to)}</span>
      </div>
    `)
    .join("");
}

function renderBalances(trip, balances) {
  const list = document.querySelector("#balanceList");
  list.innerHTML = balances
    .map((person) => `
      <div class="balance-item">
        <div class="avatar">${avatar(person.name)}</div>
        <div class="item-meta">
          <strong>${escapeHtml(person.name)}</strong>
          <span>จ่ายไปแล้ว ${money(trip, person.paid)}</span>
        </div>
        <div class="amount ${person.balance >= 0 ? "positive" : "negative"}">
          ${person.balance >= 0 ? money(trip, person.balance) : money(trip, Math.abs(person.balance))}
        </div>
      </div>
    `)
    .join("");
}

function getTotals(trip) {
  const paidByMember = new Map(trip.members.map((member) => [member.id, 0]));
  let grossTotal = 0;
  let refundTotal = 0;

  trip.expenses.forEach((expense) => {
    const type = expense.type || "expense";
    if (type === "refund") {
      refundTotal += expense.amount;
      paidByMember.set(expense.payerId, (paidByMember.get(expense.payerId) || 0) - expense.amount);
      return;
    }

    grossTotal += expense.amount;
    paidByMember.set(expense.payerId, (paidByMember.get(expense.payerId) || 0) + expense.amount);
  }, 0);
  const total = Math.max(0, grossTotal - refundTotal);
  const share = trip.members.length ? total / trip.members.length : 0;
  const balances = trip.members.map((member) => ({
    ...member,
    paid: paidByMember.get(member.id) || 0,
    balance: (paidByMember.get(member.id) || 0) - share,
  }));
  return { total, grossTotal, refundTotal, share, balances };
}

function getSettlements(trip) {
  const { balances } = getTotals(trip);
  const creditors = balances
    .filter((person) => person.balance > 0.009)
    .map((person) => ({ ...person }))
    .sort((a, b) => b.balance - a.balance);
  const debtors = balances
    .filter((person) => person.balance < -0.009)
    .map((person) => ({ ...person, balance: Math.abs(person.balance) }))
    .sort((a, b) => b.balance - a.balance);
  const settlements = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = Math.min(creditor.balance, debtor.balance);
    settlements.push({ from: debtor.name, to: creditor.name, amount });
    creditor.balance -= amount;
    debtor.balance -= amount;
    if (creditor.balance < 0.01) creditorIndex += 1;
    if (debtor.balance < 0.01) debtorIndex += 1;
  }

  return settlements;
}

function getCategoryTotals(trip) {
  return getExpenseItems(trip).reduce((totals, expense) => {
    totals[expense.category] = (totals[expense.category] || 0) + expense.amount;
    return totals;
  }, Object.fromEntries(categoryList.map((name) => [name, 0])));
}

function getExpenseItems(trip) {
  return trip.expenses.filter((expense) => (expense.type || "expense") === "expense");
}

function getDonutStyle(trip) {
  const totals = getCategoryTotals(trip);
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  if (!total) return "background:#edf3f1";

  let cursor = 0;
  const stops = categoryList
    .filter((name) => totals[name] > 0)
    .map((name) => {
      const start = cursor;
      cursor += (totals[name] / total) * 100;
      return `${categoryColors[name]} ${start}% ${cursor}%`;
    });
  return `background:conic-gradient(${stops.join(",")})`;
}

function seedExampleExpenses(trip, ownerId) {
  const siblingId = crypto.randomUUID();
  trip.members.push({ id: siblingId, name: "น้อง" });
  trip.expenses = [
    { id: crypto.randomUUID(), title: "โรงแรม", amount: 2000, payerId: ownerId, category: "ที่พัก" },
    { id: crypto.randomUUID(), title: "น้ำมัน", amount: 1500, payerId: ownerId, category: "เดินทาง" },
    { id: crypto.randomUUID(), title: "อาหารเย็น", amount: 800, payerId: siblingId, category: "อาหาร" },
    { id: crypto.randomUUID(), title: "ค่าเข้าดอย", amount: 400, payerId: siblingId, category: "กิจกรรม" },
  ];
}

function createCode() {
  let code = "";
  do {
    code = `TRIP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  } while (store.trips[code]);
  return code;
}

function normalizeCode(value) {
  return value.trim().toUpperCase();
}

function getCurrentMember(trip) {
  return trip.members.find((member) => member.id === session[trip.code]);
}

function getShareLink(code) {
  return `${location.origin}${location.pathname}?trip=${code}`;
}

function money(trip, value) {
  return `${trip.currency || "฿"}${Number(value).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateRange(trip) {
  if (!trip.startDate || !trip.endDate) return "ทริปส่วนตัว";
  return `${formatThaiDate(trip.startDate)} - ${formatThaiDate(trip.endDate)}`;
}

function formatThaiDate(value) {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function avatar(name) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    showToast("คัดลอกไม่ได้ในเบราว์เซอร์นี้");
  }
}

function showToast(message) {
  const oldToast = document.querySelector(".toast");
  if (oldToast) oldToast.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

window.addEventListener("popstate", route);

// Auth drives the first render: INITIAL_SESSION fires on load, SIGNED_IN after the
// Google redirect, and SIGNED_OUT when logging out.
sb.auth.onAuthStateChange((event, sessionData) => {
  currentUser = sessionData?.user || null;
  if (currentUser) {
    route();
  } else {
    renderLogin();
  }
});

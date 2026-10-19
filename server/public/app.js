const $ = (selector) => document.querySelector(selector);
const loginView = $("#login-view");
const appView = $("#app-view");
let currentUser = null;
let allOrders = [];

const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);
  return data;
}
function showMessage(message = "") { $("#notice").textContent = message; }
function setView(loggedIn) {
  loginView.hidden = loggedIn;
  appView.hidden = !loggedIn;
}
function roleLabel(role) {
  return ({ GERENCIA: "GERÊNCIA", COZINHA: "COZINHA", CAIXA: "CAIXA" })[role] || role;
}
async function loadOrders() {
  if (!currentUser) return;
  const params = new URLSearchParams(new FormData($("#filters")));
  try {
    allOrders = await api(`/api/orders?${params.toString()}`);
    renderOrders(allOrders);
  } catch (error) {
    showMessage(error.message);
  }
}
function renderOrders(orders) {
  $("#count").textContent = orders.length;
  $("#sum").textContent = money(orders.reduce((sum, order) => sum + order.total, 0));
  const container = $("#orders");
  if (!orders.length) {
    container.innerHTML = '<div class="empty">Nenhum pedido para este perfil/filtro.</div>';
    return;
  }
  container.innerHTML = orders.map(order => {
    const items = order.itens.map(item => `<li>${item.quantidade}x ${escapeHtml(item.nome)} — ${money(item.precoUnitario * item.quantidade)}</li>`).join("");
    const date = new Date(order.created_at).toLocaleString("pt-BR");
    const actions = [];
    if (currentUser.role === "COZINHA" && order.status === "PREPARANDO") actions.push(`<button data-status="PRONTO" data-id="${order.id}">Marcar pronto</button>`);
    if (currentUser.role === "CAIXA" && order.status === "PRONTO") actions.push(`<button data-status="PAGO" data-id="${order.id}">Marcar pago</button>`);
    if (currentUser.role === "GERENCIA") {
      if (order.status === "PREPARANDO") actions.push(`<button data-status="PRONTO" data-id="${order.id}">Marcar pronto</button>`);
      if (order.status === "PRONTO") actions.push(`<button data-status="PAGO" data-id="${order.id}">Marcar pago</button>`);
    }
    return `<article class="order-card">
      <div class="order-head"><div><h3>Pedido ${escapeHtml(order.id)}</h3><div class="muted small">Mesa ${order.mesa} · ${escapeHtml(order.cliente)}</div></div><span class="pill">${order.status}</span></div>
      <p class="muted small">${date}</p><ul class="items">${items}</ul><p class="total">Total: ${money(order.total)}</p>
      <div class="order-actions">${actions.join("")}</div>
    </article>`;
  }).join("");
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").textContent = "";
  const form = new FormData(event.currentTarget);
  try {
    const result = await api("/api/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    currentUser = result.user;
    await enterApp();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});
async function enterApp() {
  setView(true);
  $("#profile").textContent = `${currentUser.username.toUpperCase()} • ${roleLabel(currentUser.role)}`;
  $("#new-order-card").hidden = currentUser.role !== "GERENCIA" && currentUser.role !== "CAIXA";
  await loadOrders();
  const events = new EventSource("/api/events");
  events.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      if (event.event === "orders") loadOrders();
    } catch {}
  };
}
$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
  currentUser = null;
  setView(false);
});
$("#filters").addEventListener("submit", (event) => { event.preventDefault(); loadOrders(); });
$("#filters").addEventListener("reset", () => setTimeout(loadOrders, 0));
$("#order-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    mesa: Number(form.get("mesa")),
    cliente: form.get("cliente"),
    itens: [{ nome: form.get("nome"), precoUnitario: Number(form.get("precoUnitario")), quantidade: Number(form.get("quantidade")) }]
  };
  try {
    const order = await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
    showMessage(`Pedido ${order.id} criado. Total: ${money(order.total)}.`);
    await loadOrders();
  } catch (error) { showMessage(error.message); }
});
$("#orders").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-status]");
  if (!button) return;
  try {
    await api(`/api/orders/${button.dataset.id}/status`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status }) });
    showMessage(`Pedido atualizado para ${button.dataset.status}.`);
    await loadOrders();
  } catch (error) { showMessage(error.message); }
});
(async function init() {
  try {
    const result = await api("/api/me");
    if (result.user) {
      currentUser = result.user;
      await enterApp();
    } else setView(false);
  } catch { setView(false); }
})();

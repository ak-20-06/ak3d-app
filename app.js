const CONFIG = window.AK3D_CONFIG || {};

const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_KEY = CONFIG.SUPABASE_ANON_KEY;

let sbClient = null;

if (SUPABASE_URL && SUPABASE_KEY && window.supabase) {
  sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}sbClient

const LS_KEY = '3d_print_prod_system_final_v1';
let calendarMode = 'week';

const num = v => Number(v) || 0;
const fmtKr = v => (Number(v) || 0).toLocaleString('da-DK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}) + ' kr';

const fmtNum = v => (Number(v) || 0).toLocaleString('da-DK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/"/g, '&quot;');

const byId = id => document.getElementById(id);
const uid = () => (crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11));

let state = {
  app: { nextOrderNo: 1001, inventoryPadMode: false },
  currentOrderId: null,
  orderNo: '',
  projectName: '',
  globalUnits: 0,
  order: {
    status: 'Tilbud',
    priority: 'Normal',
    startDate: '',
    deadline: '',
    tags: '',
    notes: '',
    assignedPrinterIds: []
  },
  invoice: {
    customer: '',
    addr1: '',
    addr2: '',
    invoiceNo: '',
    terms: '8 dage netto',
    note: ''
  },
  settings: {
    powerPrice: 2.5,
    defaultPrinterWatt: 120,
    moms: 25,
    marginPct: 30,
    switchMin: 5,
    wearPerHour: 5,
    laborRate: 250,
    defaultHoursPerDay: 16
  },
  filament: [
    { id: uid(), name: 'PLA', price: 200, stockKg: 0 },
    { id: uid(), name: 'PETG', price: 230, stockKg: 0 }
  ],
  parts: [],
  items: [],
  plateProgress: {},
  printers: [],
  customers: [],
  ordersHistory: []
};

window.addEventListener('DOMContentLoaded', () => {
  loadState();

  if (!state.currentOrderId) createNewOrder(false);

  if (byId('today')) {
    byId('today').textContent = new Date().toLocaleDateString('da-DK');
  }

  setupEvents();
  applyUI();
  setupSupabaseRealtime();
  updateInvoiceDates();
});

function loadState() {
  const raw = localStorage.getItem(LS_KEY);

  if (raw) {
    try {
      state = JSON.parse(raw);
    } catch {
      console.warn('Kunne ikke indlæse localStorage');
    }
  }

  state.app ||= { nextOrderNo: 1001, inventoryPadMode: false };
  state.order ||= {};
  state.invoice ||= {};
  state.settings ||= {};
  state.filament ||= [];
  state.parts ||= [];
  state.items ||= [];
  state.plateProgress ||= {};
  state.printers ||= [];
  state.customers ||= [];
  state.ordersHistory ||= [];

  state.order.status ||= 'Tilbud';
  state.order.priority ||= 'Normal';
  state.order.startDate ||= '';
  state.order.deadline ||= '';
  state.order.tags ||= '';
  state.order.notes ||= '';
  state.order.assignedPrinterIds ||= [];

  state.invoice.customer ||= '';
  state.invoice.addr1 ||= '';
  state.invoice.addr2 ||= '';
  state.invoice.invoiceNo ||= '';
  state.invoice.terms ||= '8 dage netto';
  state.invoice.note ||= '';

  state.settings.powerPrice ??= 2.5;
  state.settings.defaultPrinterWatt ??= 120;
  state.settings.moms ??= 25;
  state.settings.marginPct ??= 30;
  state.settings.switchMin ??= 5;
  state.settings.wearPerHour ??= 5;
  state.settings.laborRate ??= 250;
  state.settings.defaultHoursPerDay ??= 16;

  if (state.filament.length === 0) {
    state.filament = [
      { id: uid(), name: 'PLA', price: 200, stockKg: 0 },
      { id: uid(), name: 'PETG', price: 230, stockKg: 0 }
    ];
  }
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function setupEvents() {
  document.querySelectorAll('.navbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      bindChange('showUnitPriceOnInvoice', renderInvoice);
      document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
      byId('tab-' + btn.dataset.tab)?.classList.remove('hidden');

      renderActiveTab(btn.dataset.tab);
    });
  });

  document.querySelectorAll('.modeBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      calendarMode = btn.dataset.mode;
      renderCalendar();
    });
  });

  bindClick('saveBtn', () => {
    syncTopbarToState();
    saveCurrentOrderSnapshot();
    saveState();
    alert('Ordre gemt');
  });

  bindClick('newOrderBtnTop', () => createNewOrder(true));
  bindClick('newOrderBtn', () => createNewOrder(true));
  bindClick('cloneOrderBtn', cloneOrder);

  bindInput('projectName', () => {
    syncTopbarToState();
    renderHeader();
    saveState();
  });

  bindInput('globalUnits', () => {
    state.globalUnits = Math.max(0, Math.floor(num(byId('globalUnits').value)));
    rerender();
  });

  ['orderStatus', 'orderPriority', 'orderStartDate', 'orderDeadline', 'orderTags', 'orderNotes'].forEach(id => {
    bindInput(id, syncOrderFieldsToState);
    bindChange(id, syncOrderFieldsToState);
  });

  bindInput('orderSearch', renderOrderHistory);
  bindChange('orderStatusFilter', renderOrderHistory);

  bindClick('addItemBtn', addItem);
  bindClick('clearItemBtn', clearItemForm);
  bindClick('addFilBtn', addFilament);
  bindClick('addPartBtn', addPart);
  bindClick('addPrinterBtn', addPrinter);
  bindClick('addCustomerBtn', addCustomer);
  bindClick('saveSettingsBtn', saveSettings);
  bindClick('markAllPlatesDoneBtn', markAllPlatesDone);
  bindClick('resetAllPlatesBtn', resetAllPlates);

  bindChange('inventoryPadMode', () => {
    state.app.inventoryPadMode = !!byId('inventoryPadMode').checked;
    saveState();
    renderInventory();
  });

  ['invCustomer', 'invAddr1', 'invAddr2', 'invInvoiceNo', 'invTerms', 'invNote'].forEach(id => {
    bindInput(id, () => {
      state.invoice.customer = byId('invCustomer')?.value || '';
      state.invoice.addr1 = byId('invAddr1')?.value || '';
      state.invoice.addr2 = byId('invAddr2')?.value || '';
      state.invoice.invoiceNo = byId('invInvoiceNo')?.value || '';
      state.invoice.terms = byId('invTerms')?.value || '';
      state.invoice.note = byId('invNote')?.value || '';
      saveState();
    });
  });

  bindClick('backupBtn', backupData);
  bindChange('restoreFile', restoreData);
  bindClick('exportCSVBtn', exportCSV);
  bindClick('printBtn', () => window.print());
}

function bindClick(id, fn) {
  byId(id)?.addEventListener('click', fn);
}

function bindInput(id, fn) {
  byId(id)?.addEventListener('input', fn);
}

function bindChange(id, fn) {
  byId(id)?.addEventListener('change', fn);
}

function applyUI() {
  renderHeader();
  populateTopbar();
  populateOrderFields();
  populateSettings();
  populateFilamentSelect();

  renderOrderHistory();
  renderItems();
  renderOrderStatus();
  renderFilament();
  renderInventory();
  renderPrinters();
  renderCustomers();
  renderDashboard();
  renderCalendar();
  renderShopping();
  renderInvoice();
  renderPrinterAssignments();

  if (byId('inventoryPadMode')) {
    byId('inventoryPadMode').checked = !!state.app.inventoryPadMode;
  }

  document.querySelector('.navbtn[data-tab="dashboard"]')?.click();
}

function renderActiveTab(tab) {
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'orders') { renderOrderHistory(); renderPrinterAssignments(); }
  if (tab === 'order_status') renderOrderStatus();
  if (tab === 'items') renderItems();
  if (tab === 'calendar') renderCalendar();
  if (tab === 'printers') { renderPrinters(); renderPrinterAssignments(); }
  if (tab === 'filament') renderFilament();
  if (tab === 'inventory') renderInventory();
  if (tab === 'shopping') renderShopping();
  if (tab === 'customers') renderCustomers();
  if (tab === 'invoice') renderInvoice();
  if (tab === 'settings') populateSettings();
}

function setVal(id, v) {
  if (byId(id)) byId(id).value = v;
}

function renderHeader() {
  if (byId('headerOrderNo')) byId('headerOrderNo').textContent = state.orderNo || '-';
  if (byId('headerProjectName')) byId('headerProjectName').textContent = state.projectName || '-';
}

function populateTopbar() {
  setVal('projectName', state.projectName || '');
  setVal('globalUnits', state.globalUnits || 0);
  setVal('orderNo', state.orderNo || '');

  if (byId('momsDisplay')) {
    byId('momsDisplay').textContent = `Moms: ${state.settings.moms}%`;
  }
}

function populateOrderFields() {
  setVal('orderStatus', state.order.status || 'Tilbud');
  setVal('orderPriority', state.order.priority || 'Normal');
  setVal('orderStartDate', state.order.startDate || '');
  setVal('orderDeadline', state.order.deadline || '');
  setVal('orderTags', state.order.tags || '');
  setVal('orderNotes', state.order.notes || '');
}

function populateSettings() {
  setVal('setPowerPrice', state.settings.powerPrice);
  setVal('setDefaultWatt', state.settings.defaultPrinterWatt);
  setVal('setMoms', state.settings.moms);
  setVal('setMargin', state.settings.marginPct);
  setVal('setSwitchMin', state.settings.switchMin);
  setVal('setWear', state.settings.wearPerHour);
  setVal('setLaborRate', state.settings.laborRate);
  setVal('setDefaultHours', state.settings.defaultHoursPerDay);
}

function saveSettings() {
  state.settings.powerPrice = num(byId('setPowerPrice')?.value);
  state.settings.defaultPrinterWatt = num(byId('setDefaultWatt')?.value);
  state.settings.moms = num(byId('setMoms')?.value);
  state.settings.marginPct = num(byId('setMargin')?.value);
  state.settings.switchMin = num(byId('setSwitchMin')?.value);
  state.settings.wearPerHour = num(byId('setWear')?.value);
  state.settings.laborRate = num(byId('setLaborRate')?.value);
  state.settings.defaultHoursPerDay = num(byId('setDefaultHours')?.value);

  rerender();
  alert('Indstillinger gemt');
}

function syncTopbarToState() {
  state.projectName = byId('projectName')?.value.trim() || '';
  state.globalUnits = Math.max(0, Math.floor(num(byId('globalUnits')?.value)));
}

function syncOrderFieldsToState() {
  state.order.status = byId('orderStatus')?.value || 'Tilbud';
  state.order.priority = byId('orderPriority')?.value || 'Normal';
  state.order.startDate = byId('orderStartDate')?.value || '';
  state.order.deadline = byId('orderDeadline')?.value || '';
  state.order.tags = byId('orderTags')?.value || '';
  state.order.notes = byId('orderNotes')?.value || '';

  rerender();
}

function createNewOrder(confirmPrompt = true) {
  if (confirmPrompt && !confirm('Vil du oprette en ny tom ordre?')) return;

  const no = String(state.app.nextOrderNo || 1001);
  state.app.nextOrderNo = Number(no) + 1;

  state.currentOrderId = uid();
  state.orderNo = no;
  state.projectName = '';
  state.globalUnits = 0;

  state.order = {
    status: 'Tilbud',
    priority: 'Normal',
    startDate: new Date().toISOString().slice(0, 10),
    deadline: '',
    tags: '',
    notes: '',
    assignedPrinterIds: []
  };

  state.invoice = {
    customer: '',
    addr1: '',
    addr2: '',
    invoiceNo: '',
    terms: '8 dage netto',
    note: ''
  };

  state.items = [];
  state.plateProgress = {};

  saveCurrentOrderSnapshot();
  saveState();
  applyUI();
}

function cloneOrder() {
  const snap = snapshotCurrentOrder();
  const old = state.orderNo;

  createNewOrder(false);

  state.projectName = (snap.projectName || 'Kopi') + ' (kopi)';
  state.globalUnits = snap.globalUnits || 0;
  state.order = JSON.parse(JSON.stringify(snap.order || {}));
  state.order.status = 'Tilbud';
  state.order.startDate = new Date().toISOString().slice(0, 10);
  state.order.deadline = '';
  state.invoice = JSON.parse(JSON.stringify(snap.invoice || {}));
  state.items = JSON.parse(JSON.stringify(snap.items || []));
  state.plateProgress = {};

  saveCurrentOrderSnapshot();
  saveState();
  applyUI();

  alert(`Ordre ${old} kopieret til ny ordre ${state.orderNo}`);
}

function snapshotCurrentOrder() {
  return {
    id: state.currentOrderId,
    orderNo: state.orderNo,
    projectName: state.projectName,
    globalUnits: state.globalUnits,
    order: JSON.parse(JSON.stringify(state.order)),
    invoice: JSON.parse(JSON.stringify(state.invoice)),
    items: JSON.parse(JSON.stringify(state.items)),
    plateProgress: JSON.parse(JSON.stringify(state.plateProgress || {})),
    customer: state.invoice.customer || '',
    totalInc: computePricing().saleInc,
    savedAt: new Date().toISOString()
  };
}

function saveCurrentOrderSnapshot() {
  const snap = snapshotCurrentOrder();
  const idx = state.ordersHistory.findIndex(o => o.id === state.currentOrderId);

  if (idx >= 0) state.ordersHistory[idx] = snap;
  else state.ordersHistory.unshift(snap);
}

function renderOrderHistory() {
  const tbody = byId('orderHistoryBody');
  if (!tbody) return;

  const q = (byId('orderSearch')?.value || '').trim().toLowerCase();
  const sf = byId('orderStatusFilter')?.value || '';

  const rows = state.ordersHistory
    .filter(o => !sf || o.order?.status === sf)
    .filter(o => {
      if (!q) return true;
      return `${o.orderNo} ${o.projectName} ${o.customer}`.toLowerCase().includes(q);
    });

  tbody.innerHTML = rows.map(o => `
    <tr>
      <td>${esc(o.orderNo)}</td>
      <td>${esc(o.projectName || '-')}</td>
      <td>${esc(o.customer || '-')}</td>
      <td>${esc(o.order?.status || '-')}</td>
      <td>${esc(o.order?.deadline || '-')}</td>
      <td class="text-right">${fmtKr(o.totalInc || 0)}</td>
      <td class="text-right">
        <button class="table-btn" onclick="openOrder('${o.id}')">Åbn</button>
        <button class="table-btn danger" onclick="deleteOrder('${o.id}')">Slet</button>
      </td>
    </tr>
  `).join('');
}

window.openOrder = function (id) {
  const o = state.ordersHistory.find(x => x.id === id);
  if (!o) return;

  state.currentOrderId = o.id;
  state.orderNo = o.orderNo;
  state.projectName = o.projectName;
  state.globalUnits = o.globalUnits || 0;
  state.order = JSON.parse(JSON.stringify(o.order || {}));
  state.invoice = JSON.parse(JSON.stringify(o.invoice || {}));
  state.items = JSON.parse(JSON.stringify(o.items || []));
  state.plateProgress = JSON.parse(JSON.stringify(o.plateProgress || {}));

  saveState();
  applyUI();
};

window.deleteOrder = function (id) {
  if (!confirm('Slet ordre fra historik?')) return;

  state.ordersHistory = state.ordersHistory.filter(x => x.id !== id);
  saveState();
  renderOrderHistory();
};

function getAssignedPrinters() {
  return state.printers.filter(p =>
    (state.order.assignedPrinterIds || []).includes(p.id) &&
    p.status === 'Aktiv'
  );
}

function averageAssignedWatt() {
  const ps = getAssignedPrinters();
  if (ps.length === 0) return null;

  return ps
    .map(p => num(p.liveWatt || p.watt || state.settings.defaultPrinterWatt))
    .reduce((a, b) => a + b, 0) / ps.length;
}

function renderPrinterAssignments() {
  const box = byId('orderPrinterAssignments');
  if (!box) return;

  if (state.printers.length === 0) {
    box.innerHTML = '<span class="text-slate-400 text-xs">Ingen printere oprettet endnu</span>';
    return;
  }

  const ids = state.order.assignedPrinterIds || [];

  box.innerHTML = state.printers.map(p => `
    <button type="button"
      onclick="togglePrinterAssign('${p.id}')"
      class="px-2 py-1 rounded text-xs border ${ids.includes(p.id) ? 'bg-sky-700 border-sky-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-200'}">
      ${esc(p.name)}
    </button>
  `).join('');
}

window.togglePrinterAssign = function (id) {
  const ids = state.order.assignedPrinterIds || [];
  state.order.assignedPrinterIds = ids.includes(id)
    ? ids.filter(x => x !== id)
    : [...ids, id];

  rerender();
};

function itemDerived(it) {
  const units = num(it.customQty) > 0
  ? Math.max(0, num(it.customQty))
  : Math.max(0, num(state.globalUnits));
  const totalPieces = units * Math.max(1, num(it.multPerUnit));
  const piecesPerPlate = Math.max(1, num(it.piecesPerPlate));
  const plates = Math.ceil(totalPieces / piecesPerPlate);

  const printHours = plates * (num(it.plateHours) + num(it.plateMinutes) / 60);
  const switchHours = plates * (num(state.settings.switchMin) / 60);
  const totalPrintHours = printHours + switchHours;

  const filamentKg = (plates * num(it.weightPlate)) / 1000;
  const fil = state.filament.find(f => f.name === it.filament) || { price: 0 };

  const filamentCost = filamentKg * num(fil.price);
  const energyCost = printHours * ((averageAssignedWatt() || state.settings.defaultPrinterWatt) / 1000) * num(state.settings.powerPrice);
  const wearCost = printHours * num(state.settings.wearPerHour);
  const partsCostTotal = state.parts.reduce((s, p) => s + num(p.price) * num(p.qtyPerUnit), 0) * units;

  return {
    units,
    totalPieces,
    piecesPerPlate,
    plates,
    printHours,
    switchHours,
    totalPrintHours,
    filamentKg,
    filamentCost,
    energyCost,
    wearCost,
    partsCostTotal
  };
}

function computeCostBreakdown() {
  const momsF = 1 + num(state.settings.moms) / 100;

  const items = state.items.map(it => {
    const d = itemDerived(it);
    const matEx = d.filamentCost + d.energyCost + d.wearCost + d.partsCostTotal;

    return {
      ...it,
      ...d,
      matEx,
      matInc: matEx * momsF
    };
  });

  const totalEx = items.reduce((s, i) => s + i.matEx, 0);
  const totalInc = totalEx * momsF;

  return {
    items,
    totals: {
      totalEx,
      totalInc,
      totalPrintPlus: items.reduce((s, i) => s + i.totalPrintHours, 0)
    }
  };
}

function computePricing() {
  const cb = computeCostBreakdown();
  const saleEx = cb.totals.totalEx * (1 + num(state.settings.marginPct) / 100);
  const saleInc = saleEx * (1 + num(state.settings.moms) / 100);

  return {
    saleEx,
    saleInc,
    costEx: cb.totals.totalEx
  };
}

/* =========================
   ORDRE STATUS / PLADER
========================= */

function getAllPlates() {
  const plates = [];
  let runningNo = 1;

  state.items.forEach(it => {
    const d = itemDerived(it);

    for (let i = 1; i <= d.plates; i++) {
      const key = `${state.currentOrderId || 'order'}::${it.id}::${i}`;
      const saved = state.plateProgress[key];

      plates.push({
        key,
        plateNo: runningNo,
        itemId: it.id,
        itemName: it.name,
        plateIndex: i,
        totalForItem: d.plates,
        status: saved === true
          ? 'Færdig'
          : saved === false
            ? 'Planlagt'
            : (saved || 'Planlagt')
      });

      runningNo++;
    }
  });

  return plates;
}

function setPlateStatus(key, status) {
  state.plateProgress[key] = status;
  saveCurrentOrderSnapshot();
  saveState();
  renderOrderStatus();
}

function markAllPlatesDone() {
  getAllPlates().forEach(p => {
    state.plateProgress[p.key] = 'Færdig';
  });

  saveCurrentOrderSnapshot();
  saveState();
  renderOrderStatus();
}

function resetAllPlates() {
  getAllPlates().forEach(p => {
    state.plateProgress[p.key] = 'Planlagt';
  });

  saveCurrentOrderSnapshot();
  saveState();
  renderOrderStatus();
}

window.updatePlateStatus = function (key, status) {
  setPlateStatus(key, status);
};

function renderOrderStatus() {
  const list = byId('platesList');
  const empty = byId('orderStatusEmpty');
  const summary = byId('orderStatusSummary');
  const bar = byId('orderStatusProgressBar');
  const text = byId('orderStatusProgressText');

  if (!list || !summary || !bar || !text || !empty) return;

  const plates = getAllPlates();
  const doneCount = plates.filter(p => p.status === 'Færdig').length;
  const total = plates.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  summary.textContent = `${doneCount} / ${total} plader færdige`;
  text.textContent = `${pct}% færdig`;
  bar.style.width = `${pct}%`;

  if (total === 0) {
    empty.classList.remove('hidden');
    list.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');

  list.innerHTML = plates.map(p => `
    <div class="flex items-center gap-3 p-3 rounded-xl border border-slate-700 bg-slate-900">
      <div class="w-28 font-bold text-slate-100">
        Emner
      </div>

      <div class="flex-1">
        <div class="font-medium">${esc(p.itemName)}</div>
        <div class="text-sm text-slate-400">Plade ${p.plateNo}</div>
        <div class="text-xs text-slate-500">Plade ${p.plateIndex} af ${p.totalForItem}</div>
      </div>

      <select class="input w-36" onchange="updatePlateStatus('${p.key}', this.value)">
        <option value="Planlagt" ${p.status === 'Planlagt' ? 'selected' : ''}>Planlagt</option>
        <option value="I gang" ${p.status === 'I gang' ? 'selected' : ''}>I gang</option>
        <option value="Færdig" ${p.status === 'Færdig' ? 'selected' : ''}>Færdig</option>
      </select>
    </div>
  `).join('');
}

function rerender() {
  saveCurrentOrderSnapshot();
  saveState();

  renderHeader();
  populateTopbar();
  populateSettings();
  renderOrderHistory();
  populateFilamentSelect();
  renderItems();
  renderOrderStatus();
  renderFilament();
  renderInventory();
  renderPrinters();
  renderDashboard();
  renderCalendar();
  renderShopping();
  renderInvoice();
  renderPrinterAssignments();
}

function addItem() {
  const name = byId('itemName')?.value.trim();
  const weightPlate = num(byId('itemWeightPlate')?.value);

  if (!name || weightPlate <= 0) {
    alert('Udfyld navn og vægt');
    return;
  }

  state.items.push({
    id: uid(),
    name,
    customQty: Math.max(0, Math.floor(num(byId('itemCustomQty')?.value))),
    weightPlate,
    filament: byId('itemFilamentType')?.value || (state.filament[0]?.name || ''),
    status: byId('itemStatus')?.value || 'Planlagt',
    piecesPerPlate: Math.max(1, Math.floor(num(byId('itemPiecesPerPlate')?.value))),
    multPerUnit: Math.max(1, Math.floor(num(byId('itemMultPerUnit')?.value))),
    plateHours: num(byId('itemPlateHours')?.value),
    plateMinutes: num(byId('itemPlateMinutes')?.value)
  });

  clearItemForm();
  rerender();
}

function clearItemForm() {
  ['itemName', 'itemWeightPlate', 'itemPiecesPerPlate', 'itemMultPerUnit', 'itemPlateHours', 'itemPlateMinutes']
    .forEach(id => setVal(id, ''));
}

window.updateItemField = function (id, field, value) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;

  if (['weightPlate', 'piecesPerPlate', 'multPerUnit', 'plateHours', 'plateMinutes'].includes(field)) {
    it[field] = num(value);
  } else {
    it[field] = value;
  }

  rerender();
};

window.removeItem = function (id) {
  if (!confirm('Slet emne?')) return;

  state.items = state.items.filter(x => x.id !== id);
  rerender();
};

function populateFilamentSelect() {
  const sel = byId('itemFilamentType');
  if (!sel) return;

  sel.innerHTML = state.filament.map(f => `<option>${esc(f.name)}</option>`).join('');
}

function renderItems() {
  const tbody = byId('itemsBody');
  if (!tbody) return;

  tbody.innerHTML = state.items.map(it => {
    const d = itemDerived(it);
    const priceEx = d.filamentCost + d.energyCost + d.wearCost + d.partsCostTotal;

    return `
      <tr>
        <td><input class="table-input" value="${esc(it.name)}" oninput="updateItemField('${it.id}','name',this.value)"></td>
        <td><input class="table-input w-20" type="number" value="${num(it.customQty) || num(state.globalUnits)}" oninput="updateItemField('${it.id}','customQty',this.value)"></td>
        <td><input class="table-input w-24" type="number" value="${num(it.weightPlate)}" oninput="updateItemField('${it.id}','weightPlate',this.value)"></td>

        <td>
          <select class="table-input" onchange="updateItemField('${it.id}','filament',this.value)">
            ${state.filament.map(f => `<option ${it.filament === f.name ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
          </select>
        </td>

        <td><input class="table-input w-20" type="number" value="${num(it.piecesPerPlate)}" oninput="updateItemField('${it.id}','piecesPerPlate',this.value)"></td>
        <td><input class="table-input w-20" type="number" value="${num(it.multPerUnit)}" oninput="updateItemField('${it.id}','multPerUnit',this.value)"></td>

        <td class="text-center">${d.totalPieces}</td>
        <td class="text-center">${d.plates}</td>

        <td><input class="table-input w-20" type="number" value="${num(it.plateHours)}" oninput="updateItemField('${it.id}','plateHours',this.value)"></td>

        <td class="text-center">${fmtKr(priceEx)}</td>

        <td>
          <select class="table-input" onchange="updateItemField('${it.id}','status',this.value)">
            ${['Planlagt', 'I gang', 'Pauset', 'Færdig'].map(s => `<option ${it.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>

        <td class="text-center"><button class="table-btn danger" onclick="removeItem('${it.id}')">✖</button></td>
      </tr>
    `;
  }).join('');
}

function addFilament() {
  const name = byId('filName')?.value.trim();
  const price = num(byId('filPrice')?.value);
  const stockKg = num(byId('filStock')?.value);

  if (!name || price <= 0) {
    alert('Udfyld navn og kg pris');
    return;
  }

  state.filament.push({ id: uid(), name, price, stockKg });

  ['filName', 'filPrice', 'filStock'].forEach(id => setVal(id, ''));
  rerender();
}

window.updateFilField = function (id, field, value) {
  const f = state.filament.find(x => x.id === id);
  if (!f) return;

  if (['price', 'stockKg'].includes(field)) f[field] = num(value);
  else f[field] = value;

  rerender();
};

window.removeFil = function (id) {
  if (!confirm('Slet filamenttype?')) return;

  state.filament = state.filament.filter(x => x.id !== id);
  rerender();
};

function renderFilament() {
  const tbody = byId('filamentBody');
  if (!tbody) return;

  const usage = {};

  state.items.forEach(it => {
    const d = itemDerived(it);
    usage[it.filament] = (usage[it.filament] || 0) + d.filamentKg;
  });

  tbody.innerHTML = state.filament.map(f => `
    <tr>
      <td><input class="table-input" value="${esc(f.name)}" oninput="updateFilField('${f.id}','name',this.value)"></td>
      <td><input class="table-input w-24" type="number" value="${num(f.price)}" oninput="updateFilField('${f.id}','price',this.value)"></td>
      <td><input class="table-input w-24" type="number" value="${num(f.stockKg)}" oninput="updateFilField('${f.id}','stockKg',this.value)"></td>
      <td class="text-center">${fmtNum(usage[f.name] || 0)} kg</td>
      <td class="text-center">${fmtNum(num(f.stockKg) - (usage[f.name] || 0))} kg</td>
      <td class="text-center"><button class="table-btn danger" onclick="removeFil('${f.id}')">✖</button></td>
    </tr>
  `).join('');
}

function addPart() {
  const name = byId('partName')?.value.trim();
  const price = num(byId('partPrice')?.value);
  const qtyPerUnit = Math.max(1, Math.floor(num(byId('partQtyPerUnit')?.value)));
  const stock = num(byId('partStock')?.value);

  if (!name || price <= 0) {
    alert('Udfyld varenavn og pris');
    return;
  }

  state.parts.push({ id: uid(), name, price, qtyPerUnit, stock });

  ['partName', 'partPrice', 'partQtyPerUnit', 'partStock'].forEach(id => setVal(id, ''));
  rerender();
}

window.updatePartField = function (id, field, value) {
  const p = state.parts.find(x => x.id === id);
  if (!p) return;

  if (['price', 'qtyPerUnit', 'stock'].includes(field)) p[field] = num(value);
  else p[field] = value;

  rerender();
};

window.bumpPart = function (id, delta) {
  const p = state.parts.find(x => x.id === id);
  if (!p) return;

  p.stock = Math.max(0, num(p.stock) + delta);
  rerender();
};

window.removePart = function (id) {
  if (!confirm('Slet vare?')) return;

  state.parts = state.parts.filter(x => x.id !== id);
  rerender();
};

function renderInvoice() {
  const cb = computeCostBreakdown();
  const momsPct = num(state.settings.moms);
  const momsF = 1 + momsPct / 100;
  const marginF = 1 + num(state.settings.marginPct) / 100;

  const tbody = byId('invoiceBody');
  if (!tbody) return;

  if (byId('invOrderNo')) byId('invOrderNo').textContent = state.orderNo || '-';
  if (byId('invProject')) byId('invProject').textContent = state.projectName || '-';
  if (byId('invUnits')) byId('invUnits').textContent = state.globalUnits || 0;
  if (byId('invMoms')) byId('invMoms').textContent = momsPct + '%';
  if (byId('invStatus')) byId('invStatus').textContent = state.order.status || '-';

  updateInvoiceDates();

  setVal('invCustomer', state.invoice.customer || '');
  setVal('invAddr1', state.invoice.addr1 || '');
  setVal('invAddr2', state.invoice.addr2 || '');
  setVal('invInvoiceNo', state.invoice.invoiceNo || '');
  setVal('invTerms', state.invoice.terms || '');
  setVal('invNote', state.invoice.note || '');

  const lines = [];
  let totalSaleEx = 0;
  let totalSaleInc = 0;

  cb.items.forEach(d => {
    const saleEx = d.matEx * marginF;
    const saleInc = saleEx * momsF;
    const qty = d.totalPieces || 1;

    lines.push({
      desc: 'Emne: ' + d.name,
      qty,
      unitEx: saleEx / qty,
      unitInc: saleInc / qty,
      totalInc: saleInc
    });

    totalSaleEx += saleEx;
    totalSaleInc += saleInc;
  });

  const showUnit = byId('showUnitPriceOnInvoice')?.checked ?? true;

  document.querySelectorAll('.unit-price-col').forEach(el => {
    el.style.display = showUnit ? '' : 'none';
  });

  tbody.innerHTML = lines.map(l => `
    <tr>
      <td>${esc(l.desc)}</td>
      <td class="text-right">${l.qty}</td>
      <td class="text-right unit-price-col" style="${showUnit ? '' : 'display:none'}">${fmtKr(l.unitEx)}</td>
      <td class="text-right unit-price-col" style="${showUnit ? '' : 'display:none'}">${fmtKr(l.unitInc)}</td>
      <td class="text-right">${fmtKr(l.totalInc)}</td>
    </tr>
  `).join('');

  if (byId('invTotalEx')) byId('invTotalEx').textContent = fmtKr(totalSaleEx);
  if (byId('invMomsAmount')) byId('invMomsAmount').textContent = fmtKr(totalSaleInc - totalSaleEx);
  if (byId('invTotalInc')) byId('invTotalInc').textContent = fmtKr(totalSaleInc);

  const info = byId('internalInvoiceInfo');

  if (info) {
    const marginKrEx = totalSaleEx - cb.totals.totalEx;
    const marginKrInc = totalSaleInc - cb.totals.totalInc;
    const realPct = cb.totals.totalEx > 0 ? marginKrEx / cb.totals.totalEx * 100 : 0;

    info.innerHTML = `
      <div class="bg-slate-800/70 border border-slate-700 rounded p-3 inline-block">
        <div class="font-semibold text-slate-200 mb-1">Internt overblik (ikke med på print)</div>
        <div>Kostpris ekskl. moms: <strong>${fmtKr(cb.totals.totalEx)}</strong></div>
        <div>Salgspris inkl. moms: <strong>${fmtKr(totalSaleInc)}</strong></div>
        <div>Avance ekskl. moms: <strong>${fmtKr(marginKrEx)}</strong></div>
        <div>Avance inkl. moms: <strong>${fmtKr(marginKrInc)}</strong></div>
        <div>Reel avance: <strong>${fmtNum(realPct)}%</strong> (mål ${fmtNum(state.settings.marginPct)}%)</div>
      </div>
    `;
  }
}

function updateInvoiceDates() {
  const d = new Date();
  const due = new Date();
  due.setDate(d.getDate() + 8);

  if (byId('invDate')) byId('invDate').textContent = d.toLocaleDateString('da-DK');
  if (byId('invDueDate')) byId('invDueDate').textContent = due.toLocaleDateString('da-DK');
}

function backupData() {
  saveCurrentOrderSnapshot();
  saveState();

  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');

  a.href = URL.createObjectURL(blob);
  a.download = `3d-print-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

function restoreData(e) {
  const f = e.target.files?.[0];
  if (!f) return;

  const r = new FileReader();

  r.onload = ev => {
    try {
      state = JSON.parse(ev.target.result);
      saveState();
      applyUI();
      alert('Backup indlæst');
    } catch {
      alert('Kunne ikke indlæse backup');
    }
  };

  r.readAsText(f, 'utf-8');
}

function exportCSV() {
  const cb = computeCostBreakdown();

  const rows = [['Ordrenr', 'Projekt', 'Emne', 'Antal', 'Plader', 'Printtid_t', 'Filament_kg', 'Pris_ex', 'Status']];

  cb.items.forEach(d => {
    rows.push([
      state.orderNo,
      state.projectName,
      d.name,
      d.totalPieces,
      d.plates,
      d.totalPrintHours.toFixed(2),
      d.filamentKg.toFixed(3),
      d.matEx.toFixed(2),
      d.status
    ]);
  });

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');

  a.href = URL.createObjectURL(blob);
  a.download = `ordre-${state.orderNo || 'export'}.csv`;
  a.click();
}

function setupSupabaseRealtime() {
  if (!sbClient) {
    console.log('Supabase ikke aktiv – app kører kun localStorage');
    return;
  }

  try {
    sbClient
      .channel('orders-changes')F
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        payload => {
          console.log('Supabase ændring:', payload);
        }
      )
      .subscribe();
  } catch (err) {
    console.warn('Supabase realtime kunne ikke startes:', err);
  }
}

window.AK3D_DEBUG = {
  state,
  sbClient,
  rerender,
  saveState,
  getAllPlates
};

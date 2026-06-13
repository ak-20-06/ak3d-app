const CONFIG = window.AK3D_CONFIG || {};

const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_KEY = CONFIG.SUPABASE_ANON_KEY;
const SUPABASE_CDN_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

let sbClient = null;
let supabaseClientPromise = null;

const LS_KEY = '3d_print_prod_system_final_v1';
let calendarMode = 'printer';

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
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const byId = id => document.getElementById(id);
const uid = () => (crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11));
const SUPABASE_STATE_ID = '00000000-0000-4000-8000-000000000001';
const SUPABASE_STATE_ORDER_NO = '__AK3D_APP_STATE__';
const SUPABASE_TIMEOUT_MS = 5000;

let state = defaultState();
let remoteSaveTimer = null;
let initialRemoteSyncDone = false;

function defaultState() {
  return {
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
      defaultHoursPerDay: 16,
      calendarStartDate: '',
      calendarStartTime: '08:00',
      calendarChangeTimes: ['08:00', '12:00', '16:00', '20:00'],
      calendarAllowWeekends: true
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
}

window.addEventListener('DOMContentLoaded', () => {
  const hasLocalState = loadLocalState();
  if (!state.currentOrderId) createNewOrder(false);

  if (byId('today')) byId('today').textContent = new Date().toLocaleDateString('da-DK');

  setupEvents();
  applyUI();
  setupSupabaseRealtime();
  updateInvoiceDates();

  syncStateFromSupabase(hasLocalState).catch(err => {
    console.warn('Supabase baggrundssynk fejlede', err);
    setSaveStatus('Gemmer lokalt');
    initialRemoteSyncDone = true;
  });
});

function normalizeState() {
  state ||= defaultState();
  state.app ||= { nextOrderNo: 1001, inventoryPadMode: false };
  state.app.nextOrderNo ||= 1001;
  state.app.inventoryPadMode ??= false;

  state.order ||= {};
  state.order.status ||= 'Tilbud';
  state.order.priority ||= 'Normal';
  state.order.startDate ||= '';
  state.order.deadline ||= '';
  state.order.tags ||= '';
  state.order.notes ||= '';
  state.order.assignedPrinterIds ||= [];

  state.invoice ||= {};
  state.invoice.customer ||= '';
  state.invoice.addr1 ||= '';
  state.invoice.addr2 ||= '';
  state.invoice.invoiceNo ||= '';
  state.invoice.terms ||= '8 dage netto';
  state.invoice.note ||= '';

  state.settings ||= {};
  state.settings.powerPrice ??= 2.5;
  state.settings.defaultPrinterWatt ??= 120;
  state.settings.moms ??= 25;
  state.settings.marginPct ??= 30;
  state.settings.switchMin ??= 5;
  state.settings.wearPerHour ??= 5;
  state.settings.laborRate ??= 250;
  state.settings.defaultHoursPerDay ??= 16;
  state.settings.calendarStartDate ||= '';
  state.settings.calendarStartTime ||= '08:00';
  state.settings.calendarChangeTimes = [...new Set(
    (Array.isArray(state.settings.calendarChangeTimes)
      ? state.settings.calendarChangeTimes
      : ['08:00', '12:00', '16:00', '20:00'])
      .filter(isValidTime)
  )].sort();
  if (state.settings.calendarChangeTimes.length === 0) {
    state.settings.calendarChangeTimes = ['08:00', '12:00', '16:00', '20:00'];
  }
  state.settings.calendarAllowWeekends ??= true;

  state.filament ||= [];
  state.parts ||= [];
  state.items ||= [];
  state.plateProgress ||= {};
  state.printers ||= [];
  state.customers ||= [];
  state.ordersHistory ||= [];

  if (state.filament.length === 0) {
    state.filament = [
      { id: uid(), name: 'PLA', price: 200, stockKg: 0 },
      { id: uid(), name: 'PETG', price: 230, stockKg: 0 }
    ];
  }

  state.items = state.items.map(it => ({
    id: it.id || uid(),
    name: it.name || '',
    customQty: num(it.customQty),
    weightPlate: num(it.weightPlate),
    filament: it.filament || state.filament[0]?.name || '',
    status: it.status || 'Planlagt',
    piecesPerPlate: Math.max(1, Math.floor(num(it.piecesPerPlate) || 1)),
    multPerUnit: Math.max(1, Math.floor(num(it.multPerUnit) || 1)),
    plateHours: num(it.plateHours),
    plateMinutes: num(it.plateMinutes)
  }));
}

function setSaveStatus(text) {
  if (byId('saveStatus')) byId('saveStatus').textContent = text;
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

function createSupabaseClient() {
  if (sbClient) return sbClient;
  if (SUPABASE_URL && SUPABASE_KEY && window.supabase?.createClient) {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return sbClient;
}

function loadSupabaseClient() {
  const client = createSupabaseClient();
  if (client || !SUPABASE_URL || !SUPABASE_KEY) return Promise.resolve(client);
  if (supabaseClientPromise) return supabaseClientPromise;

  supabaseClientPromise = new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(createSupabaseClient());
    };
    const fail = err => {
      if (done) return;
      done = true;
      console.warn('Supabase bibliotek kunne ikke indlæses', err);
      resolve(null);
    };

    const existing = document.querySelector('script[data-ak3d-supabase]');
    const script = existing || document.createElement('script');
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });

    if (!existing) {
      script.src = SUPABASE_CDN_URL;
      script.async = true;
      script.dataset.ak3dSupabase = 'true';
      document.head.appendChild(script);
    }

    setTimeout(finish, SUPABASE_TIMEOUT_MS);
  });

  return supabaseClientPromise;
}

function loadLocalState() {
  const raw = localStorage.getItem(LS_KEY);
  let hasLocalState = false;
  if (raw) {
    try {
      state = JSON.parse(raw);
      hasLocalState = true;
    } catch (err) {
      console.warn('Kunne ikke indlæse localStorage', err);
      state = defaultState();
    }
  }
  normalizeState();

  if (!sbClient) {
    setSaveStatus('Gemmer lokalt');
  }

  return hasLocalState;
}

async function syncStateFromSupabase(hasLocalState) {
  setSaveStatus('Forbinder til Supabase...');
  const client = await loadSupabaseClient();
  if (!client) {
    setSaveStatus('Gemmer lokalt');
    initialRemoteSyncDone = true;
    return;
  }

  try {
    setSaveStatus('Henter fra Supabase...');
    const request = client
      .from('orders')
      .select('payload, updated_at')
      .eq('id', SUPABASE_STATE_ID)
      .maybeSingle();
    const { data, error } = await Promise.race([
      request,
      timeoutAfter(SUPABASE_TIMEOUT_MS, 'Supabase svarer ikke')
    ]);

    if (error) throw error;
    if (data?.payload && typeof data.payload === 'object') {
      state = data.payload;
      normalizeState();
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      applyUI();
      updateInvoiceDates();
      setSaveStatus('Hentet fra Supabase');
      return;
    }

    if (hasLocalState || state.currentOrderId) {
      await saveRemoteState();
      setSaveStatus('Synkroniseret til Supabase');
    } else {
      setSaveStatus('Supabase klar');
    }
  } catch (err) {
    console.warn('Kunne ikke hente fra Supabase, bruger lokal kopi', err);
    setSaveStatus('Gemmer lokalt');
  } finally {
    initialRemoteSyncDone = true;
  }
}

function saveState(options = {}) {
  normalizeState();
  localStorage.setItem(LS_KEY, JSON.stringify(state));

  if (options.flushRemote) return saveRemoteState();
  queueRemoteSave();
  return Promise.resolve();
}

function queueRemoteSave() {
  if (!initialRemoteSyncDone) {
    setSaveStatus('Gemmer lokalt');
    return;
  }
  const client = createSupabaseClient();
  if (!client) {
    setSaveStatus('Gemt lokalt');
    return;
  }
  if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
  setSaveStatus('Gemmer...');
  remoteSaveTimer = setTimeout(() => {
    remoteSaveTimer = null;
    saveRemoteState().catch(err => {
      console.warn('Supabase gemning fejlede', err);
      setSaveStatus('Gemt lokalt');
    });
  }, 600);
}

async function saveRemoteState() {
  const client = await loadSupabaseClient();
  if (!client) {
    setSaveStatus('Gemt lokalt');
    return;
  }
  if (remoteSaveTimer) {
    clearTimeout(remoteSaveTimer);
    remoteSaveTimer = null;
  }

  normalizeState();
  const snapshot = JSON.parse(JSON.stringify(state));
  const pricing = computePricing();
  const row = {
    id: SUPABASE_STATE_ID,
    order_no: SUPABASE_STATE_ORDER_NO,
    project_name: state.projectName || 'AK3D Produktionssystem',
    global_units: Math.max(0, Math.floor(num(state.globalUnits))),
    status: state.order?.status || 'Tilbud',
    priority: state.order?.priority || 'Normal',
    start_date: state.order?.startDate || null,
    deadline: state.order?.deadline || null,
    tags: state.order?.tags || '',
    notes: state.order?.notes || '',
    customer_name: state.invoice?.customer || '',
    total_inc: pricing.saleInc || 0,
    payload: snapshot,
    updated_at: new Date().toISOString()
  };

  setSaveStatus('Gemmer i Supabase...');
  const request = client
    .from('orders')
    .upsert(row, { onConflict: 'id' });
  const { error } = await Promise.race([
    request,
    timeoutAfter(SUPABASE_TIMEOUT_MS, 'Supabase gemning tog for lang tid')
  ]);

  if (error) throw error;
  setSaveStatus('Gemt i Supabase');
}

function setupEvents() {
  setupMenu();

  byId('appNavigation')?.addEventListener('click', event => {
    const btn = event.target.closest('.navbtn[data-tab]');
    if (!btn) return;
    event.preventDefault();
    activateTab(btn.dataset.tab);
  });

  document.querySelectorAll('.modeBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      calendarMode = btn.dataset.mode;
      renderCalendar();
    });
  });
  bindClick('calendarAddChangeTimeBtn', addCalendarChangeTime);
  bindInput('calendarNewChangeTime', updateCalendarAddButton);
  bindChange('calendarNewChangeTime', updateCalendarAddButton);
  byId('calendarNewChangeTime')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addCalendarChangeTime();
  });
  bindClick('calendarRefreshBtn', saveCalendarSettings);
  bindChange('calendarStartDate', saveCalendarSettings);
  bindChange('calendarStartTime', saveCalendarSettings);
  bindChange('calendarAllowWeekends', saveCalendarSettings);

  bindChange('showUnitPriceOnInvoice', renderInvoice);

  bindClick('saveBtn', async () => {
    syncTopbarToState();
    saveCurrentOrderSnapshot();
    try {
      await saveState({ flushRemote: true });
      alert(sbClient ? 'Ordre gemt i Supabase' : 'Ordre gemt lokalt');
    } catch (err) {
      console.warn('Kunne ikke gemme i Supabase', err);
      setSaveStatus('Gemt lokalt');
      alert('Ordre gemt lokalt, men ikke i Supabase');
    }
  });

  bindClick('newOrderBtnTop', () => createNewOrder(true));
  bindClick('newOrderBtn', () => createNewOrder(true));
  bindClick('cloneOrderBtn', cloneOrder);

  bindInput('projectName', () => {
    syncTopbarToState();
    renderHeader();
    saveCurrentOrderSnapshot();
    saveState();
  });

  bindInput('globalUnits', () => {
    state.globalUnits = Math.max(0, Math.floor(num(byId('globalUnits')?.value)));
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
    state.app.inventoryPadMode = !!byId('inventoryPadMode')?.checked;
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
      saveCurrentOrderSnapshot();
      saveState();
      renderInvoice();
    });
  });

  bindClick('backupBtn', backupData);
  bindChange('restoreFile', restoreData);
  bindClick('exportCSVBtn', exportCSV);
  bindClick('printBtn', () => window.print());
}

function bindClick(id, fn) { byId(id)?.addEventListener('click', fn); }
function bindInput(id, fn) { byId(id)?.addEventListener('input', fn); }
function bindChange(id, fn) { byId(id)?.addEventListener('change', fn); }

function setMenuOpen(open) {
  document.body.classList.toggle('menu-open', open);
  byId('menuToggleBtn')?.setAttribute('aria-expanded', String(open));
}

function setupMenu() {
  bindClick('menuToggleBtn', () => setMenuOpen(!document.body.classList.contains('menu-open')));
  bindClick('menuBackdrop', () => setMenuOpen(false));
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') setMenuOpen(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) setMenuOpen(false);
  });
}

function activateTab(tab) {
  const view = byId('tab-' + tab);
  if (!view) return;

  document.querySelectorAll('.navbtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.view').forEach(section => section.classList.add('hidden'));
  view.classList.remove('hidden');

  renderActiveTab(tab);
  setMenuOpen(false);
}

window.activateTab = activateTab;

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
  renderShopping();
  renderInvoice();
  renderPrinterAssignments();

  if (byId('inventoryPadMode')) byId('inventoryPadMode').checked = !!state.app.inventoryPadMode;

  activateTab('dashboard');
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
  const el = byId(id);
  if (el) el.value = v;
}

function renderHeader() {
  if (byId('headerOrderNo')) byId('headerOrderNo').textContent = state.orderNo || '-';
  if (byId('headerProjectName')) byId('headerProjectName').textContent = state.projectName || '-';
}

function populateTopbar() {
  setVal('projectName', state.projectName || '');
  setVal('globalUnits', state.globalUnits || 0);
  setVal('orderNo', state.orderNo || '');
  if (byId('momsDisplay')) byId('momsDisplay').textContent = `Moms: ${state.settings.moms}%`;
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
  state.invoice = { customer: '', addr1: '', addr2: '', invoiceNo: '', terms: '8 dage netto', note: '' };
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
    .filter(o => !q || `${o.orderNo} ${o.projectName} ${o.customer}`.toLowerCase().includes(q));

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
    (state.order.assignedPrinterIds || []).includes(p.id) && p.status === 'Aktiv'
  );
}

function averageAssignedWatt() {
  const ps = getAssignedPrinters();
  if (ps.length === 0) return null;
  return ps.map(p => num(p.liveWatt || p.watt || state.settings.defaultPrinterWatt)).reduce((a, b) => a + b, 0) / ps.length;
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
    <button type="button" onclick="togglePrinterAssign('${p.id}')"
      class="px-2 py-1 rounded text-xs border ${ids.includes(p.id) ? 'bg-sky-700 border-sky-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-200'}">
      ${esc(p.name)}
    </button>
  `).join('');
}

window.togglePrinterAssign = function (id) {
  const ids = state.order.assignedPrinterIds || [];
  state.order.assignedPrinterIds = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
  rerender();
};

function itemDerived(it) {
  const units = num(it.customQty) > 0 ? Math.max(0, num(it.customQty)) : Math.max(0, num(state.globalUnits));
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

  return { units, totalPieces, piecesPerPlate, plates, printHours, switchHours, totalPrintHours, filamentKg, filamentCost, energyCost, wearCost, partsCostTotal };
}

function computeCostBreakdown() {
  const momsF = 1 + num(state.settings.moms) / 100;
  const items = state.items.map(it => {
    const d = itemDerived(it);
    const matEx = d.filamentCost + d.energyCost + d.wearCost + d.partsCostTotal;
    return { ...it, ...d, matEx, matInc: matEx * momsF };
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
  return { saleEx, saleInc, costEx: cb.totals.totalEx };
}

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
        status: saved === true ? "Færdig" : saved === false ? "Planlagt" : (saved || "Planlagt")
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
  getAllPlates().forEach(p => { state.plateProgress[p.key] = 'Færdig'; });
  saveCurrentOrderSnapshot();
  saveState();
  renderOrderStatus();
}

function resetAllPlates() {
  getAllPlates().forEach(p => { state.plateProgress[p.key] = 'Planlagt'; });
  saveCurrentOrderSnapshot();
  saveState();
  renderOrderStatus();
}

window.updatePlateStatus = function (key, status) { setPlateStatus(key, status); };

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
      <div class="w-28 font-bold text-slate-100">Emner</div>
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
  if (!byId('tab-calendar')?.classList.contains('hidden')) renderCalendar();
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
    filament: byId('itemFilamentType')?.value || state.filament[0]?.name || '',
    status: byId('itemStatus')?.value || 'Planlagt',
    piecesPerPlate: Math.max(1, Math.floor(num(byId('itemPiecesPerPlate')?.value) || 1)),
    multPerUnit: Math.max(1, Math.floor(num(byId('itemMultPerUnit')?.value) || 1)),
    plateHours: num(byId('itemPlateHours')?.value),
    plateMinutes: num(byId('itemPlateMinutes')?.value)
  });
  clearItemForm();
  rerender();
}

function clearItemForm() {
  ['itemName', 'itemCustomQty', 'itemWeightPlate', 'itemPiecesPerPlate', 'itemMultPerUnit', 'itemPlateHours', 'itemPlateMinutes'].forEach(id => setVal(id, ''));
}

window.updateItemField = function (id, field, value) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  if (['customQty', 'weightPlate', 'piecesPerPlate', 'multPerUnit', 'plateHours', 'plateMinutes'].includes(field)) it[field] = num(value);
  else it[field] = value;
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
        <td><select class="table-input" onchange="updateItemField('${it.id}','filament',this.value)">${state.filament.map(f => `<option ${it.filament === f.name ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></td>
        <td><input class="table-input w-20" type="number" value="${num(it.piecesPerPlate)}" oninput="updateItemField('${it.id}','piecesPerPlate',this.value)"></td>
        <td><input class="table-input w-20" type="number" value="${num(it.multPerUnit)}" oninput="updateItemField('${it.id}','multPerUnit',this.value)"></td>
        <td class="text-center">${d.totalPieces}</td>
        <td class="text-center">${d.plates}</td>
        <td><input class="table-input w-20" type="number" value="${num(it.plateHours)}" oninput="updateItemField('${it.id}','plateHours',this.value)"></td>
        <td class="text-center">${fmtKr(priceEx)}</td>
        <td><select class="table-input" onchange="updateItemField('${it.id}','status',this.value)">${['Planlagt', 'I gang', 'Pauset', 'Færdig'].map(s => `<option ${it.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td class="text-center"><button class="table-btn danger" onclick="removeItem('${it.id}')">✖</button></td>
      </tr>
    `;
  }).join('');
}

function addFilament() {
  const name = byId('filName')?.value.trim();
  const price = num(byId('filPrice')?.value);
  const stockKg = num(byId('filStock')?.value);
  if (!name || price <= 0) return alert('Udfyld navn og kg pris');
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
  const qtyPerUnit = Math.max(1, Math.floor(num(byId('partQtyPerUnit')?.value) || 1));
  const stock = num(byId('partStock')?.value);
  if (!name || price <= 0) return alert('Udfyld varenavn og pris');
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

function renderInventory() {
  byId('inventoryTable')?.classList.toggle('inventory-pad', !!state.app.inventoryPadMode);
  const tbody = byId('partsBody');
  if (!tbody) return;
  const units = Math.max(0, num(state.globalUnits));
  tbody.innerHTML = state.parts.map(p => {
    const need = units * num(p.qtyPerUnit);
    const missing = Math.max(0, need - num(p.stock));
    return `
      <tr>
        <td><input class="table-input" value="${esc(p.name)}" oninput="updatePartField('${p.id}','name',this.value)"></td>
        <td><input class="table-input w-24" type="number" value="${num(p.price)}" oninput="updatePartField('${p.id}','price',this.value)"></td>
        <td><input class="table-input w-20" type="number" value="${num(p.qtyPerUnit)}" oninput="updatePartField('${p.id}','qtyPerUnit',this.value)"></td>
        <td><input class="table-input w-20" type="number" value="${num(p.stock)}" oninput="updatePartField('${p.id}','stock',this.value)"></td>
        <td class="text-center">${need}</td>
        <td class="text-center">${missing}</td>
        <td class="text-center">
          <button class="table-btn" onclick="bumpPart('${p.id}',-1)">-1</button>
          <button class="table-btn" onclick="bumpPart('${p.id}',1)">+1</button>
          <button class="table-btn" onclick="bumpPart('${p.id}',10)">+10</button>
        </td>
        <td class="text-center"><button class="table-btn danger" onclick="removePart('${p.id}')">✖</button></td>
      </tr>
    `;
  }).join('');
}

function addPrinter() {
  const name = byId('printerName')?.value.trim();
  if (!name) return alert('Printer skal have navn');
  state.printers.push({
    id: uid(),
    name,
    watt: num(byId('printerWatt')?.value) || state.settings.defaultPrinterWatt,
    hoursPerDay: num(byId('printerHoursPerDay')?.value) || state.settings.defaultHoursPerDay,
    status: byId('printerStatus')?.value || 'Aktiv',
    endpoint: byId('printerEndpoint')?.value.trim() || '',
    plugType: byId('printerPlugType')?.value || '',
    serviceNote: byId('printerServiceNote')?.value.trim() || '',
    liveWatt: null
  });
  ['printerName', 'printerWatt', 'printerHoursPerDay', 'printerEndpoint', 'printerServiceNote'].forEach(id => setVal(id, ''));
  setVal('printerPlugType', '');
  setVal('printerStatus', 'Aktiv');
  rerender();
}

window.updatePrinterField = function (id, field, value) {
  const p = state.printers.find(x => x.id === id);
  if (!p) return;
  if (['watt', 'hoursPerDay', 'liveWatt'].includes(field)) p[field] = num(value);
  else p[field] = value;
  rerender();
};

window.removePrinter = function (id) {
  if (!confirm('Slet printer?')) return;
  state.printers = state.printers.filter(x => x.id !== id);
  state.order.assignedPrinterIds = (state.order.assignedPrinterIds || []).filter(x => x !== id);
  rerender();
};

function renderPrinters() {
  const tbody = byId('printersBody');
  if (!tbody) return;
  tbody.innerHTML = state.printers.map(p => `
    <tr>
      <td><input class="table-input" value="${esc(p.name)}" oninput="updatePrinterField('${p.id}','name',this.value)"></td>
      <td><select class="table-input" onchange="updatePrinterField('${p.id}','status',this.value)">${['Aktiv', 'Pauset', 'Service'].map(s => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><input class="table-input w-24" type="number" value="${num(p.watt)}" oninput="updatePrinterField('${p.id}','watt',this.value)"></td>
      <td><input class="table-input w-24" type="number" value="${num(p.hoursPerDay)}" oninput="updatePrinterField('${p.id}','hoursPerDay',this.value)"></td>
      <td class="text-center">${p.liveWatt ? fmtNum(p.liveWatt) + ' W' : '-'}</td>
      <td><input class="table-input" value="${esc(p.endpoint || '')}" oninput="updatePrinterField('${p.id}','endpoint',this.value)"></td>
      <td><input class="table-input" value="${esc(p.serviceNote || '')}" oninput="updatePrinterField('${p.id}','serviceNote',this.value)"></td>
      <td class="text-center"><button class="table-btn danger" onclick="removePrinter('${p.id}')">✖</button></td>
    </tr>
  `).join('');
}

function addCustomer() {
  const name = byId('custName')?.value.trim();
  if (!name) return alert('Kundenavn skal udfyldes');
  state.customers.push({
    id: uid(),
    name,
    addr1: byId('custAddr1')?.value.trim() || '',
    addr2: byId('custAddr2')?.value.trim() || '',
    cvr: byId('custCVR')?.value.trim() || '',
    email: byId('custEmail')?.value.trim() || '',
    phone: byId('custPhone')?.value.trim() || ''
  });
  ['custName', 'custAddr1', 'custAddr2', 'custCVR', 'custEmail', 'custPhone'].forEach(id => setVal(id, ''));
  saveState();
  renderCustomers();
}

function renderCustomers() {
  const tbody = byId('customersBody');
  if (!tbody) return;
  tbody.innerHTML = state.customers.map(c => `
    <tr>
      <td>${esc(c.name)}</td>
      <td>${esc(c.addr1)} ${esc(c.addr2)}</td>
      <td class="text-center">${esc(c.cvr || '-')}</td>
      <td class="text-center">${esc(c.email || '-')} ${c.phone ? '/ ' + esc(c.phone) : ''}</td>
      <td class="text-center"><button class="table-btn" onclick="useCustomer('${c.id}')">Brug</button><button class="table-btn danger" onclick="deleteCustomer('${c.id}')">Slet</button></td>
    </tr>
  `).join('');
}

window.useCustomer = function (id) {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;
  state.invoice.customer = c.name;
  state.invoice.addr1 = c.addr1;
  state.invoice.addr2 = c.addr2;
  saveState();
  renderInvoice();
  document.querySelector('.navbtn[data-tab="invoice"]')?.click();
};

window.deleteCustomer = function (id) {
  if (!confirm('Slet kunde?')) return;
  state.customers = state.customers.filter(x => x.id !== id);
  saveState();
  renderCustomers();
};

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDateTime(dateValue, timeValue = '00:00') {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue || '') ? dateValue : localDateKey(new Date());
  const safeTime = isValidTime(timeValue) ? timeValue : '00:00';
  const [year, month, day] = safeDate.split('-').map(Number);
  const [hour, minute] = safeTime.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function formatScheduleDate(date) {
  return date.toLocaleDateString('da-DK', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatScheduleTime(date) {
  return date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
}

function formatScheduleDateTime(date) {
  return `${formatScheduleDate(date)} ${formatScheduleTime(date)}`;
}

function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(num(minutes)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} t`;
  return `${hours} t ${mins} min`;
}

function nextPreferredChangeTime(afterDate) {
  const changeTimes = state.settings.calendarChangeTimes;
  const allowWeekends = !!state.settings.calendarAllowWeekends;
  const start = new Date(afterDate);

  for (let offset = 0; offset < 370; offset++) {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    const weekDay = day.getDay();
    if (!allowWeekends && (weekDay === 0 || weekDay === 6)) continue;

    for (const time of changeTimes) {
      const candidate = parseLocalDateTime(localDateKey(day), time);
      if (candidate.getTime() >= start.getTime()) return candidate;
    }
  }

  return new Date(start);
}

function getPlanningOrders() {
  const ordersById = new Map();
  state.ordersHistory.forEach(order => {
    if (order?.id) ordersById.set(order.id, JSON.parse(JSON.stringify(order)));
  });

  if (state.currentOrderId) {
    ordersById.set(state.currentOrderId, {
      id: state.currentOrderId,
      orderNo: state.orderNo,
      projectName: state.projectName,
      globalUnits: state.globalUnits,
      order: JSON.parse(JSON.stringify(state.order)),
      items: JSON.parse(JSON.stringify(state.items)),
      plateProgress: JSON.parse(JSON.stringify(state.plateProgress || {}))
    });
  }

  const finishedStatuses = new Set(['Færdig', 'Leveret', 'Faktureret']);
  return [...ordersById.values()].filter(order =>
    order.items?.length && !finishedStatuses.has(order.order?.status)
  );
}

function getOrderScheduleJobs(order) {
  const jobs = [];
  let runningPlateNo = 1;

  (order.items || []).forEach((item, itemIndex) => {
    if (item.status === 'Færdig') return;
    const units = num(item.customQty) > 0 ? Math.max(0, num(item.customQty)) : Math.max(0, num(order.globalUnits));
    const totalPieces = units * Math.max(1, num(item.multPerUnit));
    const piecesPerPlate = Math.max(1, num(item.piecesPerPlate));
    const plateCount = Math.ceil(totalPieces / piecesPerPlate);
    const durationMinutes = Math.max(0, Math.round((num(item.plateHours) * 60) + num(item.plateMinutes)));

    for (let plateIndex = 1; plateIndex <= plateCount; plateIndex++) {
      const key = `${order.id || 'order'}::${item.id}::${plateIndex}`;
      const savedStatus = order.plateProgress?.[key];
      const status = savedStatus === true ? 'Færdig' : savedStatus === false ? 'Planlagt' : (savedStatus || item.status || 'Planlagt');
      if (status !== 'Færdig') {
        jobs.push({
          key,
          orderId: order.id,
          orderNo: order.orderNo || '-',
          projectName: order.projectName || '-',
          orderStatus: order.order?.status || 'Planlagt',
          priority: order.order?.priority || 'Normal',
          deadline: order.order?.deadline || '',
          orderStartDate: order.order?.startDate || '',
          assignedPrinterIds: order.order?.assignedPrinterIds || [],
          itemId: item.id,
          itemName: item.name || 'Emne',
          itemIndex,
          plateIndex,
          plateCount,
          plateNo: runningPlateNo,
          durationMinutes,
          status
        });
      }
      runningPlateNo++;
    }
  });

  return jobs;
}

function schedulePriorityValue(priority) {
  return { Haste: 0, Høj: 1, Normal: 2, Lav: 3 }[priority] ?? 2;
}

function computeSchedule() {
  const startDate = state.settings.calendarStartDate || localDateKey(new Date());
  const startTime = state.settings.calendarStartTime || '08:00';
  const planStart = parseLocalDateTime(startDate, startTime);
  const activePrinters = state.printers.filter(printer => printer.status === 'Aktiv');
  const printerPlans = new Map(activePrinters.map(printer => [
    printer.id,
    { printer, availableAt: new Date(planStart), bookings: [] }
  ]));
  const warnings = [];
  const warningKeys = new Set();
  const addWarning = (key, text) => {
    if (warningKeys.has(key)) return;
    warningKeys.add(key);
    warnings.push(text);
  };

  const jobs = getPlanningOrders()
    .flatMap(getOrderScheduleJobs)
    .sort((a, b) => {
      const priorityDiff = schedulePriorityValue(a.priority) - schedulePriorityValue(b.priority);
      if (priorityDiff !== 0) return priorityDiff;
      const deadlineA = a.deadline || '9999-12-31';
      const deadlineB = b.deadline || '9999-12-31';
      if (deadlineA !== deadlineB) return deadlineA.localeCompare(deadlineB);
      const startA = a.orderStartDate || startDate;
      const startB = b.orderStartDate || startDate;
      if (startA !== startB) return startA.localeCompare(startB);
      if (a.orderNo !== b.orderNo) return String(a.orderNo).localeCompare(String(b.orderNo), 'da', { numeric: true });
      if (a.itemIndex !== b.itemIndex) return a.itemIndex - b.itemIndex;
      return a.plateIndex - b.plateIndex;
    });

  const bookings = [];
  const switchMinutes = Math.max(0, num(state.settings.switchMin));

  jobs.forEach(job => {
    if (job.durationMinutes <= 0) {
      addWarning(`duration-${job.orderId}-${job.itemId}`, `Ordre ${job.orderNo}: "${job.itemName}" mangler printtid.`);
      return;
    }

    const eligiblePlans = job.assignedPrinterIds
      .map(id => printerPlans.get(id))
      .filter(Boolean);
    if (eligiblePlans.length === 0) {
      addWarning(`printer-${job.orderId}`, `Ordre ${job.orderNo}: vælg mindst én aktiv printer under Ordrer.`);
      return;
    }

    const orderReady = parseLocalDateTime(job.orderStartDate || startDate, startTime);
    const selected = eligiblePlans
      .map(plan => ({
        plan,
        start: new Date(Math.max(plan.availableAt.getTime(), planStart.getTime(), orderReady.getTime()))
      }))
      .sort((a, b) => a.start - b.start || a.plan.printer.name.localeCompare(b.plan.printer.name, 'da'))[0];

    const start = selected.start;
    const end = new Date(start.getTime() + job.durationMinutes * 60000);
    const changeAt = nextPreferredChangeTime(end);
    const waitMinutes = Math.max(0, Math.round((changeAt - end) / 60000));
    const deadlineAt = job.deadline ? parseLocalDateTime(job.deadline, '23:59') : null;
    const booking = {
      ...job,
      printerId: selected.plan.printer.id,
      printerName: selected.plan.printer.name,
      start,
      end,
      changeAt,
      waitMinutes,
      deadlineLate: !!deadlineAt && changeAt > deadlineAt
    };

    selected.plan.bookings.push(booking);
    selected.plan.availableAt = new Date(changeAt.getTime() + switchMinutes * 60000);
    bookings.push(booking);
  });

  bookings.sort((a, b) => a.start - b.start || a.printerName.localeCompare(b.printerName, 'da'));
  const finish = bookings.length
    ? new Date(Math.max(...bookings.map(booking => booking.changeAt.getTime())))
    : null;
  const totalWaitMinutes = bookings.reduce((sum, booking) => sum + booking.waitMinutes, 0);

  return {
    startDate,
    startTime,
    planStart,
    finish,
    finishDate: finish ? localDateKey(finish) : '-',
    bookings,
    warnings,
    printerPlans: [...printerPlans.values()].filter(plan => plan.bookings.length),
    totalWaitMinutes
  };
}

function addCalendarChangeTime() {
  const input = byId('calendarNewChangeTime');
  const time = input?.value;
  if (!isValidTime(time)) {
    setCalendarTimeStatus('Vælg først et gyldigt tidspunkt.', true);
    input?.focus();
    return;
  }
  if (state.settings.calendarChangeTimes.includes(time)) {
    setCalendarTimeStatus(`${time} findes allerede. Vælg et andet tidspunkt.`, true);
    input?.focus();
    return;
  }
  state.settings.calendarChangeTimes = [...state.settings.calendarChangeTimes, time].sort();
  input.value = '';
  updateCalendarAddButton();
  saveState();
  renderCalendar();
  setCalendarTimeStatus(`${time} er tilføjet som skiftetid.`);
  input.focus();
}

window.removeCalendarChangeTime = function (time) {
  if (state.settings.calendarChangeTimes.length <= 1) {
    alert('Der skal være mindst ét tidspunkt til pladeskift.');
    return;
  }
  state.settings.calendarChangeTimes = state.settings.calendarChangeTimes.filter(value => value !== time);
  saveState();
  renderCalendar();
  setCalendarTimeStatus(`${time} er fjernet.`);
};

function updateCalendarAddButton() {
  const input = byId('calendarNewChangeTime');
  const button = byId('calendarAddChangeTimeBtn');
  if (button) button.disabled = !isValidTime(input?.value);
}

function setCalendarTimeStatus(text, isError = false) {
  const status = byId('calendarTimeStatus');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('calendar-time-error', isError);
}

function saveCalendarSettings() {
  const startDate = byId('calendarStartDate')?.value || localDateKey(new Date());
  const startTime = byId('calendarStartTime')?.value || '08:00';
  state.settings.calendarStartDate = startDate;
  state.settings.calendarStartTime = isValidTime(startTime) ? startTime : '08:00';
  state.settings.calendarAllowWeekends = !!byId('calendarAllowWeekends')?.checked;
  saveState();
  renderCalendar();
}

function renderCalendarChangeTimes() {
  const mount = byId('calendarChangeTimes');
  if (!mount) return;
  mount.innerHTML = state.settings.calendarChangeTimes.map(time => `
    <div class="calendar-time-chip">
      <span>${esc(time)}</span>
      <button type="button" onclick="removeCalendarChangeTime('${esc(time)}')" aria-label="Fjern skiftetid ${esc(time)}" title="Fjern skiftetid">×</button>
    </div>
  `).join('');
}

function renderScheduleTable(rows, showPrinter = true) {
  return `
    <div class="schedule-table-wrap">
      <table class="table-ui schedule-table">
        <thead>
          <tr>
            <th>Start</th>
            <th>Print færdig</th>
            <th>Pladeskift</th>
            ${showPrinter ? '<th>Printer</th>' : ''}
            <th>Ordre</th>
            <th>Emne</th>
            <th>Plade</th>
            <th>Printtid</th>
            <th>Venter</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(booking => `
            <tr class="${booking.deadlineLate ? 'schedule-late' : ''}">
              <td><strong>${formatScheduleTime(booking.start)}</strong><div class="schedule-date-small">${formatScheduleDate(booking.start)}</div></td>
              <td>${formatScheduleTime(booking.end)}</td>
              <td><strong>${formatScheduleTime(booking.changeAt)}</strong><div class="schedule-date-small">${formatScheduleDate(booking.changeAt)}</div></td>
              ${showPrinter ? `<td><span class="schedule-printer">${esc(booking.printerName)}</span></td>` : ''}
              <td><strong>${esc(booking.orderNo)}</strong><div class="schedule-date-small">${esc(booking.projectName)}</div></td>
              <td>${esc(booking.itemName)}</td>
              <td>${booking.plateIndex} / ${booking.plateCount}</td>
              <td>${formatMinutes(booking.durationMinutes)}</td>
              <td>${booking.waitMinutes ? formatMinutes(booking.waitMinutes) : 'Ingen'}${booking.deadlineLate ? '<div class="schedule-deadline">Efter deadline</div>' : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function calendarWeekKey(date) {
  const monday = new Date(date);
  const day = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  return localDateKey(monday);
}

function renderCalendar() {
  if (!byId('calendarMount')) return;

  setVal('calendarStartDate', state.settings.calendarStartDate || localDateKey(new Date()));
  setVal('calendarStartTime', state.settings.calendarStartTime);
  if (byId('calendarAllowWeekends')) byId('calendarAllowWeekends').checked = !!state.settings.calendarAllowWeekends;
  updateCalendarAddButton();
  renderCalendarChangeTimes();

  const sched = computeSchedule();
  if (byId('calendarStart')) byId('calendarStart').textContent = formatScheduleDateTime(sched.planStart);
  if (byId('calendarFinish')) byId('calendarFinish').textContent = sched.finish ? formatScheduleDateTime(sched.finish) : '-';
  if (byId('calendarPrinters')) {
    byId('calendarPrinters').textContent = sched.printerPlans.map(plan => plan.printer.name).join(', ') || 'Ingen';
  }
  if (byId('calendarWait')) byId('calendarWait').textContent = formatMinutes(sched.totalWaitMinutes);

  document.querySelectorAll('.modeBtn').forEach(btn => {
    btn.classList.toggle('calendar-mode-active', btn.dataset.mode === calendarMode);
  });

  const warnings = byId('calendarWarnings');
  if (warnings) {
    warnings.classList.toggle('hidden', sched.warnings.length === 0);
    warnings.innerHTML = sched.warnings.map(text => `<div>${esc(text)}</div>`).join('');
  }

  const mount = byId('calendarMount');
  if (sched.bookings.length === 0) {
    mount.innerHTML = `
      <div class="calendar-empty">
        <strong>Ingen plader kan planlægges endnu.</strong>
        <span>Opret emner med printtid, og vælg aktive printere på ordren.</span>
      </div>
    `;
    return;
  }

  if (calendarMode === 'printer') {
    mount.innerHTML = sched.printerPlans.map(plan => `
      <section class="schedule-group">
        <div class="schedule-group-heading">
          <div>
            <h3>${esc(plan.printer.name)}</h3>
            <span>${plan.bookings.length} plader · ${formatMinutes(plan.bookings.reduce((sum, booking) => sum + booking.durationMinutes, 0))} print</span>
          </div>
          <span class="schedule-finish">Ledig ${formatScheduleDateTime(plan.availableAt)}</span>
        </div>
        ${renderScheduleTable(plan.bookings, false)}
      </section>
    `).join('');
    return;
  }

  const groups = {};
  sched.bookings.forEach(booking => {
    let key = localDateKey(booking.start);
    if (calendarMode === 'week') key = calendarWeekKey(booking.start);
    if (calendarMode === 'month') key = key.slice(0, 7);
    groups[key] ||= [];
    groups[key].push(booking);
  });

  mount.innerHTML = Object.keys(groups).sort().map(key => {
    let title = formatScheduleDate(parseLocalDateTime(key, '00:00'));
    if (calendarMode === 'week') title = `Uge fra ${formatScheduleDate(parseLocalDateTime(key, '00:00'))}`;
    if (calendarMode === 'month') {
      title = parseLocalDateTime(`${key}-01`, '00:00').toLocaleDateString('da-DK', { month: 'long', year: 'numeric' });
    }
    return `
      <section class="schedule-group">
        <div class="schedule-group-heading">
          <div>
            <h3>${esc(title)}</h3>
            <span>${groups[key].length} plader</span>
          </div>
        </div>
        ${renderScheduleTable(groups[key], true)}
      </section>
    `;
  }).join('');
}

function renderShopping() {
  const sf = byId('shoppingFilament');
  const sp = byId('shoppingParts');
  const usage = {};
  state.items.forEach(it => {
    const d = itemDerived(it);
    usage[it.filament] = (usage[it.filament] || 0) + d.filamentKg;
  });

  if (sf) {
    const rows = state.filament.map(f => {
      const need = usage[f.name] || 0;
      const missing = Math.max(0, need - num(f.stockKg));
      if (missing <= 0) return '';
      return `<div class="flex justify-between gap-3 p-3 rounded-xl bg-slate-800"><div>${esc(f.name)}</div><div>Mangler <strong>${fmtNum(missing)} kg</strong></div></div>`;
    }).filter(Boolean);
    sf.innerHTML = rows.length ? rows.join('') : '<div class="text-slate-400">Ingen filament mangler</div>';
  }

  if (sp) {
    const units = Math.max(0, num(state.globalUnits));
    const rows = state.parts.map(p => {
      const need = units * num(p.qtyPerUnit);
      const missing = Math.max(0, need - num(p.stock));
      if (missing <= 0) return '';
      return `<div class="flex justify-between gap-3 p-3 rounded-xl bg-slate-800"><div>${esc(p.name)}</div><div>Mangler <strong>${missing}</strong></div></div>`;
    }).filter(Boolean);
    sp.innerHTML = rows.length ? rows.join('') : '<div class="text-slate-400">Ingen lagervarer mangler</div>';
  }
}

function renderDashboard() {
  const pricing = computePricing();
  const cb = computeCostBreakdown();
  const sched = computeSchedule();
  const currentOrderBookings = sched.bookings.filter(booking => booking.orderId === state.currentOrderId);
  const currentOrderFinish = currentOrderBookings.length
    ? new Date(Math.max(...currentOrderBookings.map(booking => booking.changeAt.getTime())))
    : null;
  if (byId('dashStatus')) byId('dashStatus').textContent = state.order.status || '-';
  if (byId('dashHours')) byId('dashHours').textContent = fmtNum(cb.totals.totalPrintPlus) + ' t';
  if (byId('dashFinish')) byId('dashFinish').textContent = currentOrderFinish ? formatScheduleDateTime(currentOrderFinish) : '-';
  if (byId('dashSale')) byId('dashSale').textContent = fmtKr(pricing.saleInc);
  if (byId('dashOverview')) {
    byId('dashOverview').innerHTML = `
      <div>Ordrenr.: <strong>${esc(state.orderNo || '-')}</strong></div>
      <div>Projekt: <strong>${esc(state.projectName || '-')}</strong></div>
      <div>Enheder: <strong>${state.globalUnits || 0}</strong></div>
      <div>Prioritet: <strong>${esc(state.order.priority || '-')}</strong></div>
      <div>Deadline: <strong>${esc(state.order.deadline || '-')}</strong></div>
      <div>Printere: <strong>${getAssignedPrinters().map(p => p.name).join(', ') || 'Ingen'}</strong></div>
    `;
  }

  const alerts = [];
  const usage = {};
  state.items.forEach(it => {
    const d = itemDerived(it);
    usage[it.filament] = (usage[it.filament] || 0) + d.filamentKg;
  });
  state.filament.forEach(f => {
    const miss = Math.max(0, (usage[f.name] || 0) - num(f.stockKg));
    if (miss > 0) alerts.push(`Mangler ${fmtNum(miss)} kg ${f.name}`);
  });
  const units = Math.max(0, num(state.globalUnits));
  state.parts.forEach(p => {
    const miss = Math.max(0, units * num(p.qtyPerUnit) - num(p.stock));
    if (miss > 0) alerts.push(`Mangler ${miss} stk ${p.name}`);
  });
  if (byId('dashAlerts')) byId('dashAlerts').innerHTML = alerts.length ? alerts.map(a => `<div>${esc(a)}</div>`).join('') : '<div>Ingen advarsler</div>';
}

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
    lines.push({ desc: 'Emne: ' + d.name, qty, unitEx: saleEx / qty, unitInc: saleInc / qty, totalInc: saleInc });
    totalSaleEx += saleEx;
    totalSaleInc += saleInc;
  });

  const showUnit = byId('showUnitPriceOnInvoice')?.checked ?? true;
  document.querySelectorAll('.unit-price-col').forEach(el => { el.style.display = showUnit ? '' : 'none'; });

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
      normalizeState();
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
    rows.push([state.orderNo, state.projectName, d.name, d.totalPieces, d.plates, d.totalPrintHours.toFixed(2), d.filamentKg.toFixed(3), d.matEx.toFixed(2), d.status]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ordre-${state.orderNo || 'export'}.csv`;
  a.click();
}

async function setupSupabaseRealtime() {
  const client = await loadSupabaseClient();
  if (!client) {
    console.log('Supabase ikke aktiv – app kører kun localStorage');
    return;
  }
  try {
    client
      .channel('ak3d-app-state')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `id=eq.${SUPABASE_STATE_ID}`
      }, payload => {
        console.log('Supabase app-state ændring:', payload);
      })
      .subscribe();
  } catch (err) {
    console.warn('Supabase realtime kunne ikke startes:', err);
  }
}

window.AK3D_DEBUG = {
  get state() { return state; },
  get sbClient() { return sbClient; },
  rerender,
  saveState,
  getAllPlates
};

(function () {
  const CONFIG = window.AK3D_CONFIG || {};
  const LS_KEY = '3d_print_prod_system_final_v1';
  const SUPABASE_STATE_ID = '00000000-0000-4000-8000-000000000001';
  const SUPABASE_STATE_ORDER_NO = '__AK3D_APP_STATE__';
  const SUPABASE_TIMEOUT_MS = 5000;
  const SUPABASE_CDN_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  let client = null;
  let clientPromise = null;
  let remoteSaveTimer = null;
  let initialRemoteSyncDone = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function num(value) {
    return Number(value) || 0;
  }

  function setSaveStatus(text) {
    const el = byId('saveStatus');
    if (el) el.textContent = text;
  }

  function timeoutAfter(ms, message) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  function stateRef() {
    return window.AK3D_DEBUG?.state || null;
  }

  function createClient() {
    if (client) return client;
    if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase?.createClient) {
      client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
    return client;
  }

  function loadClient() {
    const existingClient = createClient();
    if (existingClient || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return Promise.resolve(existingClient);
    if (clientPromise) return clientPromise;

    clientPromise = new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(createClient());
      };
      const fail = err => {
        if (done) return;
        done = true;
        console.warn('Supabase bibliotek kunne ikke indlæses', err);
        resolve(null);
      };

      const script = document.createElement('script');
      script.src = SUPABASE_CDN_URL;
      script.async = true;
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', fail, { once: true });
      document.head.appendChild(script);

      setTimeout(finish, SUPABASE_TIMEOUT_MS);
    });

    return clientPromise;
  }

  function syncLocalStorage() {
    const state = stateRef();
    if (state) localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function applyRemoteState(payload) {
    const current = stateRef();
    if (!current || !payload || typeof payload !== 'object') return;
    Object.keys(current).forEach(key => delete current[key]);
    Object.assign(current, payload);
    if (typeof window.normalizeState === 'function') window.normalizeState();
    syncLocalStorage();
    if (typeof window.applyUI === 'function') window.applyUI();
    if (typeof window.updateInvoiceDates === 'function') window.updateInvoiceDates();
  }

  async function saveRemoteState() {
    const supabaseClient = await loadClient();
    const state = stateRef();
    if (!supabaseClient || !state) {
      setSaveStatus('Gemt lokalt');
      return;
    }

    if (remoteSaveTimer) {
      clearTimeout(remoteSaveTimer);
      remoteSaveTimer = null;
    }

    syncLocalStorage();
    const pricing = typeof window.computePricing === 'function' ? window.computePricing() : {};
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
      payload: JSON.parse(JSON.stringify(state)),
      updated_at: new Date().toISOString()
    };

    setSaveStatus('Gemmer i Supabase...');
    const request = supabaseClient
      .from('orders')
      .upsert(row, { onConflict: 'id' });
    const { error } = await Promise.race([
      request,
      timeoutAfter(SUPABASE_TIMEOUT_MS, 'Supabase gemning tog for lang tid')
    ]);
    if (error) throw error;
    setSaveStatus('Gemt i Supabase');
  }

  function queueRemoteSave() {
    syncLocalStorage();
    if (!initialRemoteSyncDone) {
      setSaveStatus('Gemmer lokalt');
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
    }, 700);
  }

  async function syncFromSupabase() {
    setSaveStatus('Forbinder til Supabase...');
    const supabaseClient = await loadClient();
    if (!supabaseClient) {
      setSaveStatus('Gemmer lokalt');
      initialRemoteSyncDone = true;
      return;
    }

    try {
      setSaveStatus('Henter fra Supabase...');
      const request = supabaseClient
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
        applyRemoteState(data.payload);
        setSaveStatus('Hentet fra Supabase');
      } else {
        await saveRemoteState();
        setSaveStatus('Synkroniseret til Supabase');
      }
    } catch (err) {
      console.warn('Kunne ikke hente fra Supabase, bruger lokal kopi', err);
      setSaveStatus('Gemmer lokalt');
    } finally {
      initialRemoteSyncDone = true;
    }
  }

  function setMenuOpen(open) {
    document.body.classList.toggle('menu-open', open);
    byId('menuToggleBtn')?.setAttribute('aria-expanded', String(open));
  }

  window.activateTab = function activateTab(tab) {
    const view = byId('tab-' + tab);
    if (!view) return;

    document.querySelectorAll('.navbtn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.view').forEach(section => section.classList.add('hidden'));
    view.classList.remove('hidden');

    if (typeof window.renderActiveTab === 'function') window.renderActiveTab(tab);
    setMenuOpen(false);
  };

  document.addEventListener('DOMContentLoaded', () => {
    byId('appNavigation')?.addEventListener('click', event => {
      const btn = event.target.closest('.navbtn[data-tab]');
      if (!btn) return;
      event.preventDefault();
      window.activateTab(btn.dataset.tab);
    });
    byId('menuToggleBtn')?.addEventListener('click', () => setMenuOpen(!document.body.classList.contains('menu-open')));
    byId('menuBackdrop')?.addEventListener('click', () => setMenuOpen(false));
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') setMenuOpen(false);
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) setMenuOpen(false);
    });

    const originalSaveState = window.saveState;
    if (typeof originalSaveState === 'function') {
      window.saveState = function saveStateWithSupabase(...args) {
        const result = originalSaveState.apply(this, args);
        queueRemoteSave();
        return result;
      };
      if (window.AK3D_DEBUG) window.AK3D_DEBUG.saveState = window.saveState;
    }

    document.addEventListener('input', () => setTimeout(queueRemoteSave, 0), true);
    document.addEventListener('change', () => setTimeout(queueRemoteSave, 0), true);
    document.addEventListener('click', event => {
      if (event.target.closest('button, .table-btn, label[for="restoreFile"]')) {
        setTimeout(queueRemoteSave, 100);
      }
    }, true);

    syncFromSupabase();
  });
})();
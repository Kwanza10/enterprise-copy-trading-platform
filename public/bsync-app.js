  const REFRESH_INTERVAL_MS = 5000;
  let refreshTimer = null;

  // EYE_ICON (open eye) = text currently visible; EYE_OFF_ICON (closed/
  // slashed eye) = text currently masked - matches every password field's
  // default markup, which starts on EYE_OFF_ICON since fields start masked.
  const EYE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 4.22-5.19M9.9 4.24A9.12 9.12 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  // Delegated so it works for password fields added later (bulk-add rows) -
  // no per-field listener wiring needed.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.pw-toggle');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const revealing = input.type === 'password';
    input.type = revealing ? 'text' : 'password';
    btn.innerHTML = revealing ? EYE_ICON : EYE_OFF_ICON;
    btn.setAttribute('aria-label', revealing ? 'Hide' : 'Show');
  });

  const el = {
    jwtToken: document.getElementById('jwtToken'),
    authForm: document.getElementById('authForm'),
    authMessage: document.getElementById('authMessage'),
    loginForm: document.getElementById('loginForm'),
    loginEmail: document.getElementById('loginEmail'),
    loginPassword: document.getElementById('loginPassword'),
    loginMessage: document.getElementById('loginMessage'),
    registerBtn: document.getElementById('registerBtn'),
    refreshStatus: document.getElementById('refreshStatus'),
    loginView: document.getElementById('loginView'),
    dashboardView: document.getElementById('dashboardView'),
    logoutBtn: document.getElementById('logoutBtn'),
    accountsPanelMessage: document.getElementById('accountsPanelMessage'),
    accountsContainer: document.getElementById('accountsContainer'),
    removedAccountsDetails: document.getElementById('removedAccountsDetails'),
    removedAccountsSummary: document.getElementById('removedAccountsSummary'),
    removedAccountsContainer: document.getElementById('removedAccountsContainer'),
    relationshipForm: document.getElementById('relationshipForm'),
    relationshipMessage: document.getElementById('relationshipMessage'),
    followerAccountId: document.getElementById('followerAccountId'),
    asMasterContainer: document.getElementById('asMasterContainer'),
    asFollowerContainer: document.getElementById('asFollowerContainer'),
    feedContainer: document.getElementById('feedContainer'),
    resetPasswordForm: document.getElementById('resetPasswordForm'),
    resetEmail: document.getElementById('resetEmail'),
    resetNewPassword: document.getElementById('resetNewPassword'),
    resetMessage: document.getElementById('resetMessage')
  };

  const storedToken = localStorage.getItem('brokerssync_token');
  if (storedToken) el.jwtToken.value = storedToken;

  function authHeaders() {
    return { Authorization: 'Bearer ' + el.jwtToken.value.trim() };
  }

  function badge(value) {
    return '<span class="badge ' + value + '">' + value.replace(/_/g, ' ') + '</span>';
  }

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined
    });
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : null;
    if (!res.ok) {
      throw new Error((data && data.error) || res.statusText);
    }
    return data;
  }

  // Session is its own standalone first page - nothing else in the app
  // renders until a token exists (via Register/Log In/Google/manual paste).
  function showDashboard() {
    el.loginView.style.display = 'none';
    el.dashboardView.style.display = '';
    el.logoutBtn.style.display = '';
  }

  function showLogin() {
    el.loginView.style.display = '';
    el.dashboardView.style.display = 'none';
    el.logoutBtn.style.display = 'none';
  }

  function applyToken(token, message) {
    el.jwtToken.value = token;
    localStorage.setItem('brokerssync_token', token);
    el.authMessage.textContent = message || 'Session connected.';
    el.authMessage.className = 'message success';
    showDashboard();
    startAutoRefresh();
  }

  el.logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('brokerssync_token');
    el.jwtToken.value = '';
    if (refreshTimer) clearInterval(refreshTimer);
    showLogin();
  });

  el.authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const token = el.jwtToken.value.trim();
    if (!token) return;
    applyToken(token);
  });

  // Register/login don't need an existing session - api() sends whatever's
  // in the token field regardless, but these two routes ignore it entirely.
  async function loginOrRegister(path) {
    const email = el.loginEmail.value.trim();
    const password = el.loginPassword.value;
    if (!email || !password) {
      el.loginMessage.className = 'message error';
      el.loginMessage.textContent = 'Email and password are required.';
      return;
    }
    try {
      const data = await api('POST', path, { email, password });
      el.loginMessage.className = 'message success';
      el.loginMessage.textContent = (path === '/api/auth/register' ? 'Registered' : 'Logged in') + ' as ' + data.user.email + '.';
      applyToken(data.token, 'Session connected.');
    } catch (err) {
      el.loginMessage.className = 'message error';
      el.loginMessage.textContent = err.message;
    }
  }

  el.loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loginOrRegister('/api/auth/login');
  });

  el.registerBtn.addEventListener('click', () => {
    loginOrRegister('/api/auth/register');
  });

  el.resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = el.resetEmail.value.trim();
    const newPassword = el.resetNewPassword.value;
    if (!email || !newPassword) {
      el.resetMessage.className = 'message error';
      el.resetMessage.textContent = 'Email and new password are required.';
      return;
    }
    try {
      const data = await api('POST', '/api/auth/reset-password', { email, newPassword });
      el.resetMessage.className = 'message success';
      el.resetMessage.textContent = 'Password reset.';
      el.resetPasswordForm.reset();
      applyToken(data.token, 'Signed in as ' + data.user.email + '.');
    } catch (err) {
      el.resetMessage.className = 'message error';
      el.resetMessage.textContent = err.message;
    }
  });

  // Only shows the button if the server has GOOGLE_CLIENT_ID configured -
  // waits for window 'load' since the GIS script tag is deferred, so
  // `google` isn't defined yet during this inline script's own top-level
  // execution.
  async function initGoogleSignIn() {
    try {
      const res = await fetch('/api/auth/google-config');
      const config = await res.json();
      if (!config.enabled || typeof google === 'undefined') return;

      google.accounts.id.initialize({
        client_id: config.clientId,
        callback: async (response) => {
          try {
            const data = await api('POST', '/api/auth/google', { credential: response.credential });
            el.loginMessage.className = 'message success';
            el.loginMessage.textContent = 'Signed in with Google as ' + data.user.email + '.';
            applyToken(data.token, 'Session connected.');
          } catch (err) {
            el.loginMessage.className = 'message error';
            el.loginMessage.textContent = err.message;
          }
        }
      });

      const container = document.getElementById('googleSignInContainer');
      container.style.display = 'block';
      google.accounts.id.renderButton(container, { theme: 'outline', size: 'large' });
    } catch (err) {
      console.error('Google sign-in setup failed:', err);
    }
  }

  window.addEventListener('load', initGoogleSignIn);

  // Add Connection modal - a guided Platform -> Details -> Connect wizard
  // for adding a single broker connection (mirrors an "Add Connection"
  // pattern used elsewhere: platform picker cards, then a details step,
  // then a final connect step that shows the result inline).
  let connPlatform = null;
  let connStep = 1;

  function resetConnectionModal() {
    connPlatform = null;
    document.querySelectorAll('.platform-card').forEach((c) => c.classList.remove('selected'));
    document.getElementById('connLabel').value = '';
    document.getElementById('connBalance').value = '';
    document.getElementById('connTlEmail').value = '';
    document.getElementById('connTlPassword').value = '';
    document.getElementById('connTlServer').value = '';
    document.getElementById('connTlAccountId').value = '';
    document.getElementById('connTlAccNum').value = '';
    document.getElementById('connResultMessage').textContent = '';
    document.getElementById('connResultMessage').className = 'message';
    document.getElementById('connResultCallout').innerHTML = '';
    document.getElementById('connTlAccountPicker').style.display = 'none';
    document.getElementById('connTlAccountPicker').innerHTML = '';
    document.getElementById('connModalConnectBtn').disabled = false;
  }

  // Renders the accounts TradeLocker's own API returned for this login as
  // clickable cards (name + currency) instead of making a user hunt down
  // and type a raw accountId/accNum themselves - clicking one just fills
  // those two hidden fields and unlocks Connect.
  function renderTlAccountPicker(accounts) {
    const picker = document.getElementById('connTlAccountPicker');
    const connectBtn = document.getElementById('connModalConnectBtn');
    connectBtn.disabled = true;
    picker.style.display = '';
    picker.innerHTML =
      '<div style="font-size:13px;color:var(--muted);margin-bottom:8px;">This login has multiple TradeLocker accounts - pick the one to connect:</div>' +
      accounts
        .map(
          (a, i) =>
            '<div class="tl-account-option" data-idx="' + i + '" style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:6px;cursor:pointer;">' +
            '<strong>' + (a.name || 'Account ' + a.accountId) + '</strong> - ' + a.currency + ' (accountId ' + a.accountId + ')' +
            '</div>'
        )
        .join('');
    picker.querySelectorAll('.tl-account-option').forEach((el) => {
      el.addEventListener('click', () => {
        picker.querySelectorAll('.tl-account-option').forEach((o) => (o.style.borderColor = 'var(--border)'));
        el.style.borderColor = 'var(--accent)';
        const chosen = accounts[Number(el.dataset.idx)];
        document.getElementById('connTlAccountId').value = chosen.accountId;
        document.getElementById('connTlAccNum').value = chosen.accNum;
        connectBtn.disabled = false;
      });
    });
  }

  function openConnectionModal() {
    resetConnectionModal();
    goToConnStep(1);
    document.getElementById('connectionModalOverlay').classList.add('open');
  }

  function closeConnectionModal() {
    document.getElementById('connectionModalOverlay').classList.remove('open');
  }

  function selectConnPlatform(platform) {
    connPlatform = platform;
    document.querySelectorAll('.platform-card').forEach((c) => c.classList.toggle('selected', c.dataset.platform === platform));
  }

  function goToConnStep(n) {
    connStep = n;
    document.getElementById('connStep1').style.display = n === 1 ? '' : 'none';
    document.getElementById('connStep2').style.display = n === 2 ? '' : 'none';
    document.getElementById('connStep3').style.display = n === 3 ? '' : 'none';

    [1, 2, 3].forEach((i) => {
      const circle = document.getElementById('stepCircle' + i);
      circle.className = 'step-circle' + (i < n ? ' done' : i === n ? ' active' : '');
      circle.textContent = i < n ? '✓' : String(i);
    });
    document.getElementById('stepLine1').className = 'step-line' + (n > 1 ? ' done' : '');
    document.getElementById('stepLine2').className = 'step-line' + (n > 2 ? ' done' : '');

    document.getElementById('connModalBackBtn').style.display = n > 1 ? '' : 'none';
    document.getElementById('connModalNextBtn').style.display = n < 3 ? '' : 'none';
    document.getElementById('connModalConnectBtn').style.display = n === 3 ? '' : 'none';
    document.getElementById('connModalDoneBtn').style.display = 'none';

    if (n === 2) {
      document.getElementById('connTlFields').style.display = connPlatform === 'tradelocker' ? 'grid' : 'none';
    }
    if (n === 3) {
      document.getElementById('connTlAccountPicker').style.display = 'none';
      document.getElementById('connTlAccountPicker').innerHTML = '';
      document.getElementById('connModalConnectBtn').disabled = false;
      const label = document.getElementById('connLabel').value.trim() || connPlatform;
      const role = document.getElementById('connRole').value;
      const environment = document.getElementById('connEnvironment').value;
      document.getElementById('connSummary').textContent =
        'Connecting "' + label + '" (' + connPlatform.toUpperCase() + ', ' + role + ', ' + environment + '). Click Connect to finish.';
    }
  }

  document.getElementById('openConnectionModalBtn').addEventListener('click', openConnectionModal);
  document.getElementById('connectionModalClose').addEventListener('click', closeConnectionModal);
  document.getElementById('connModalCancelBtn').addEventListener('click', closeConnectionModal);
  document.getElementById('connModalBackBtn').addEventListener('click', () => goToConnStep(connStep - 1));
  document.getElementById('connModalDoneBtn').addEventListener('click', closeConnectionModal);

  document.getElementById('connectionModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'connectionModalOverlay') closeConnectionModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('connectionModalOverlay').classList.contains('open')) closeConnectionModal();
  });

  document.getElementById('connModalNextBtn').addEventListener('click', async () => {
    if (connStep === 1 && !connPlatform) {
      alert('Pick a platform first.');
      return;
    }
    if (connStep === 2) {
      const label = document.getElementById('connLabel').value.trim();
      if (!label) {
        alert('Give this connection a label.');
        return;
      }
      if (connPlatform === 'tradelocker') {
        const email = document.getElementById('connTlEmail').value.trim();
        const password = document.getElementById('connTlPassword').value;
        const server = document.getElementById('connTlServer').value.trim();
        if (!email || !password || !server) {
          alert('TradeLocker email, password, and server are required.');
          return;
        }

        const accountId = document.getElementById('connTlAccountId').value.trim();
        const accNum = document.getElementById('connTlAccNum').value.trim();
        if (!accountId || !accNum) {
          const nextBtn = document.getElementById('connModalNextBtn');
          nextBtn.disabled = true;
          nextBtn.textContent = 'Checking accounts...';
          try {
            const environment = document.getElementById('connEnvironment').value;
            const data = await api('POST', '/api/broker-accounts/tradelocker/discover-accounts', {
              credentials: { email, password, server },
              environment
            });
            if (data.accounts.length === 0) {
              alert('No TradeLocker accounts found for that login.');
              return;
            }
            if (data.accounts.length === 1) {
              document.getElementById('connTlAccountId').value = data.accounts[0].accountId;
              document.getElementById('connTlAccNum').value = data.accounts[0].accNum;
            } else {
              goToConnStep(3);
              renderTlAccountPicker(data.accounts);
              return;
            }
          } catch (err) {
            alert(err.message);
            return;
          } finally {
            nextBtn.disabled = false;
            nextBtn.textContent = 'Next';
          }
        }
      }
    }
    goToConnStep(connStep + 1);
  });

  document.getElementById('connModalConnectBtn').addEventListener('click', async () => {
    const role = document.getElementById('connRole').value;
    const environment = document.getElementById('connEnvironment').value;
    const label = document.getElementById('connLabel').value.trim();
    const balance = Number(document.getElementById('connBalance').value) || 0;

    let credentials;
    if (connPlatform === 'tradelocker') {
      credentials = {
        email: document.getElementById('connTlEmail').value.trim(),
        password: document.getElementById('connTlPassword').value,
        server: document.getElementById('connTlServer').value.trim(),
        accountId: document.getElementById('connTlAccountId').value.trim(),
        accNum: document.getElementById('connTlAccNum').value.trim()
      };
    } else {
      credentials = { note: 'Bridge EA uses the webhook token below; no REST login required yet.' };
    }

    const connectBtn = document.getElementById('connModalConnectBtn');
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';

    try {
      const data = await api('POST', '/api/broker-accounts', { platform: connPlatform, role, label, environment, credentials, balance });
      document.getElementById('connResultMessage').className = 'message success';
      document.getElementById('connResultMessage').textContent = 'Connected.';
      document.getElementById('connResultCallout').innerHTML =
        '<div class="token-callout">Webhook token (shown once - configure this in your bridge EA / TradeLocker poller now):<br>' +
        data.webhookToken + '</div>';
      document.getElementById('connModalConnectBtn').style.display = 'none';
      document.getElementById('connModalBackBtn').style.display = 'none';
      document.getElementById('connModalDoneBtn').style.display = '';
      loadAccounts();
    } catch (err) {
      document.getElementById('connResultMessage').className = 'message error';
      document.getElementById('connResultMessage').textContent = err.message;
    } finally {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
    }
  });

  // Quick Add Multiple Accounts - a repeatable-row table so several
  // master/follower accounts (MT4, MT5, or TradeLocker) can be registered in
  // one pass instead of resubmitting the single-account form above for each
  // one. Each row is a pair of <tr>s: the visible summary row, plus a
  // TradeLocker-only credentials row that's hidden unless that row's
  // platform is set to TradeLocker.
  let bulkRowCounter = 0;

  function toggleBulkPlatform(i) {
    const platform = document.getElementById('bulkPlatform_' + i).value;
    document.getElementById('bulkCredRow_' + i).style.display = platform === 'tradelocker' ? '' : 'none';
  }

  function removeBulkRow(i) {
    const credRow = document.getElementById('bulkCredRow_' + i);
    if (credRow) credRow.remove();
    const row = document.getElementById('bulkRow_' + i);
    if (row) row.remove();
  }

  function addBulkRow() {
    const i = bulkRowCounter++;
    const tbody = document.getElementById('bulkAccountsBody');

    const tr = document.createElement('tr');
    tr.id = 'bulkRow_' + i;
    tr.innerHTML =
      '<td><select id="bulkPlatform_' + i + '" onchange="toggleBulkPlatform(' + i + ')">' +
        '<option value="mt4">MT4</option><option value="mt5">MT5</option><option value="tradelocker">TradeLocker</option>' +
      '</select></td>' +
      '<td><select id="bulkRole_' + i + '"><option value="master">Master</option><option value="follower">Follower</option><option value="both">Both</option></select></td>' +
      '<td><input id="bulkLabel_' + i + '" type="text" placeholder="e.g. MT5 Follower #2 or account login number" /></td>' +
      '<td><select id="bulkEnvironment_' + i + '"><option value="demo">Demo</option><option value="live">Live</option></select></td>' +
      '<td><input id="bulkBalance_' + i + '" type="number" step="0.01" placeholder="10000" /></td>' +
      '<td><button type="button" class="small danger" onclick="removeBulkRow(' + i + ')">Remove</button></td>';
    tbody.appendChild(tr);

    const credRow = document.createElement('tr');
    credRow.id = 'bulkCredRow_' + i;
    credRow.style.display = 'none';
    credRow.innerHTML =
      '<td colspan="6">' +
      '<div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:10px;background:#0e1420;border:1px solid var(--border);border-radius:6px;padding:10px;">' +
      '<div class="field"><label>TradeLocker Email</label><input id="bulkTlEmail_' + i + '" type="text" /></div>' +
      '<div class="field"><label>TradeLocker Password</label><span class="pw-wrap">' +
        '<input id="bulkTlPassword_' + i + '" type="password" />' +
        '<button type="button" class="pw-toggle" data-target="bulkTlPassword_' + i + '" aria-label="Show password">' + EYE_OFF_ICON + '</button>' +
      '</span></div>' +
      '<div class="field"><label>Server</label><input id="bulkTlServer_' + i + '" type="text" /></div>' +
      '<div class="field"><label>accountId (optional)</label><input id="bulkTlAccountId_' + i + '" type="text" /></div>' +
      '<div class="field"><label>accNum (optional)</label><input id="bulkTlAccNum_' + i + '" type="text" /></div>' +
      '</div></td>';
    tbody.appendChild(credRow);
  }

  document.getElementById('bulkAddRowBtn').addEventListener('click', addBulkRow);
  addBulkRow();
  addBulkRow();

  document.getElementById('bulkSubmitBtn').addEventListener('click', async () => {
    const rows = [...document.querySelectorAll('#bulkAccountsBody tr[id^="bulkRow_"]')];
    const bulkMessage = document.getElementById('bulkMessage');
    const bulkResults = document.getElementById('bulkResults');

    if (rows.length === 0) {
      bulkMessage.className = 'message error';
      bulkMessage.textContent = 'Add at least one row first.';
      return;
    }

    bulkMessage.className = 'message';
    bulkMessage.textContent = 'Adding ' + rows.length + ' account(s)...';

    const results = [];
    // Sequential, not Promise.all - keeps errors attributable to a specific
    // row and avoids hammering the server with a burst of inserts.
    for (const tr of rows) {
      const idSuffix = tr.id.split('_')[1];
      const platform = document.getElementById('bulkPlatform_' + idSuffix).value;
      const role = document.getElementById('bulkRole_' + idSuffix).value;
      const label = document.getElementById('bulkLabel_' + idSuffix).value.trim();
      const environment = document.getElementById('bulkEnvironment_' + idSuffix).value;
      const balance = Number(document.getElementById('bulkBalance_' + idSuffix).value) || 0;

      let credentials;
      if (platform === 'tradelocker') {
        credentials = {
          email: document.getElementById('bulkTlEmail_' + idSuffix).value.trim(),
          password: document.getElementById('bulkTlPassword_' + idSuffix).value,
          server: document.getElementById('bulkTlServer_' + idSuffix).value.trim(),
          accountId: document.getElementById('bulkTlAccountId_' + idSuffix).value.trim(),
          accNum: document.getElementById('bulkTlAccNum_' + idSuffix).value.trim()
        };
      } else {
        credentials = { note: 'Bridge EA uses the webhook token below; no REST login required yet.' };
      }

      try {
        const data = await api('POST', '/api/broker-accounts', { platform, role, label, environment, credentials, balance });
        results.push({ ok: true, label: label || platform, webhookToken: data.webhookToken });
      } catch (err) {
        results.push({ ok: false, label: label || platform, error: err.message });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    bulkMessage.className = succeeded === results.length ? 'message success' : 'message error';
    bulkMessage.textContent = succeeded + ' of ' + results.length + ' account(s) added.';

    bulkResults.innerHTML += results.map((r) =>
      r.ok
        ? '<div class="token-callout"><strong>' + r.label + '</strong> - webhook token (shown once):<br>' + r.webhookToken + '</div>'
        : '<div class="message error"><strong>' + r.label + '</strong> failed: ' + r.error + '</div>'
    ).join('');

    document.getElementById('bulkAccountsBody').innerHTML = '';
    addBulkRow();
    addBulkRow();
    loadAccounts();
  });

  el.relationshipForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const masterAccountId = document.getElementById('masterAccountId').value.trim();
    const followerAccountId = el.followerAccountId.value;
    const riskMode = document.getElementById('riskMode').value;
    const riskValue = Number(document.getElementById('riskValue').value);

    try {
      await api('POST', '/api/copy-relationships', { masterAccountId, followerAccountId, riskMode, riskValue });
      el.relationshipMessage.className = 'message success';
      el.relationshipMessage.textContent = 'Relationship created.';
      el.relationshipForm.reset();
      loadRelationships();
    } catch (err) {
      el.relationshipMessage.className = 'message error';
      el.relationshipMessage.textContent = err.message;
    }
  });

  async function removeAccount(id) {
    if (!confirm('Remove this broker account?')) return;
    try {
      await api('DELETE', '/api/broker-accounts/' + id);
      loadAccounts();
    } catch (err) {
      alert(err.message);
    }
  }

  async function restoreAccount(id) {
    try {
      await api('POST', '/api/broker-accounts/' + id + '/restore');
      loadAccounts();
    } catch (err) {
      alert(err.message);
    }
  }

  async function regenerateWebhookToken(id) {
    if (!confirm('This invalidates the current webhook token immediately - any bridge/EA still using it will start failing until reconfigured. Continue?')) return;
    try {
      const data = await api('POST', '/api/broker-accounts/' + id + '/webhook-token/regenerate');
      el.accountsPanelMessage.className = 'message success';
      el.accountsPanelMessage.innerHTML =
        'New webhook token (shown once - update your bridge EA / TradeLocker config now):<br>' +
        '<div class="token-callout">' + data.webhookToken + '</div>';
    } catch (err) {
      alert(err.message);
    }
  }

  // Relative "last seen" age, color-coded so a stale/never-connected
  // MT4/5 account (whose EA gives no positive success signal of its own -
  // a successful poll logs nothing in the terminal) stands out from one
  // actively polling in every few seconds.
  function lastSeenLabel(lastSeenAt) {
    if (!lastSeenAt) return '<span style="color:var(--muted);">Never</span>';
    const ageSec = Math.max(0, Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000));
    const text = ageSec < 60 ? ageSec + 's ago'
      : ageSec < 3600 ? Math.floor(ageSec / 60) + 'm ago'
      : ageSec < 86400 ? Math.floor(ageSec / 3600) + 'h ago'
      : Math.floor(ageSec / 86400) + 'd ago';
    const color = ageSec < 120 ? 'var(--green)' : ageSec < 900 ? 'var(--amber)' : 'var(--red)';
    return '<span style="color:' + color + ';">' + text + '</span>';
  }

  async function loadAccounts() {
    try {
      const data = await api('GET', '/api/broker-accounts');
      // "Remove" soft-deletes (status -> disabled) rather than actually
      // deleting the row, so past TradeEvents/CopyExecutions that reference
      // it stay intact - but showing disabled accounts here made Remove
      // look broken, since the row never left the list. Hide them from the
      // main table; they're still reachable (and restorable) below.
      const allAccounts = data.accounts || [];
      const accounts = allAccounts.filter((a) => a.status !== 'disabled');
      const removed = allAccounts.filter((a) => a.status === 'disabled');

      if (removed.length > 0) {
        el.removedAccountsDetails.style.display = '';
        el.removedAccountsSummary.textContent = removed.length + ' removed account' + (removed.length === 1 ? '' : 's') + ' - click to restore';
        el.removedAccountsContainer.innerHTML = removed.map((a) =>
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">' +
          '<span>' + (a.label || a.platform + ' ' + a.role) + ' (' + a.platform + ', ' + a.role + ')</span>' +
          '<button class="small" onclick="restoreAccount(\'' + a.id + '\')">Restore</button></div>'
        ).join('');
      } else {
        el.removedAccountsDetails.style.display = 'none';
        el.removedAccountsContainer.innerHTML = '';
      }

      if (accounts.length === 0) {
        el.accountsContainer.className = 'empty-state';
        el.accountsContainer.textContent = 'No broker accounts yet.';
        return;
      }

      el.accountsContainer.className = '';
      el.accountsContainer.innerHTML =
        '<table><thead><tr><th>ID</th><th>Label</th><th>Platform</th><th>Role</th><th>Env</th><th>Balance</th><th>Status</th><th>Last Seen</th><th></th></tr></thead><tbody>' +
        accounts.map((a) =>
          '<tr><td>' +
          '<input readonly value="' + a.id + '" onclick="this.select()" ' +
          'style="width:100%;font-family:monospace;font-size:11px;background:#0e1420;border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 6px;" /></td>' +
          '<td>' + (a.label || '-') + '</td><td>' + a.platform + '</td><td>' + a.role + '</td><td>' + a.environment +
          '</td><td>$' + a.balance.toFixed(2) + '</td><td>' + badge(a.status) + '</td><td>' + lastSeenLabel(a.lastSeenAt) + '</td>' +
          '<td><button class="small" onclick="regenerateWebhookToken(\'' + a.id + '\')">Regenerate token</button> ' +
          '<button class="small danger" onclick="removeAccount(\'' + a.id + '\')">Remove</button></td></tr>'
        ).join('') + '</tbody></table>';
    } catch (err) {
      el.accountsContainer.className = 'empty-state';
      el.accountsContainer.textContent = 'Failed to load accounts: ' + err.message;
    }
  }

  async function approveRelationship(id, status) {
    try {
      await api('PATCH', '/api/copy-relationships/' + id, { status });
      loadRelationships();
    } catch (err) {
      alert(err.message);
    }
  }

  async function updateRisk(id) {
    const mode = document.getElementById('riskMode_' + id).value;
    const value = Number(document.getElementById('riskValue_' + id).value);
    const enabled = document.getElementById('enabled_' + id).checked;
    try {
      await api('PATCH', '/api/copy-relationships/' + id, { riskMode: mode, riskValue: value, enabled });
      loadRelationships();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderAsMaster(items) {
    if (items.length === 0) {
      el.asMasterContainer.className = 'empty-state';
      el.asMasterContainer.textContent = 'No one is copying you yet.';
      return;
    }
    el.asMasterContainer.className = '';
    el.asMasterContainer.innerHTML = '<table><thead><tr><th>Follower Acct</th><th>Risk</th><th>Status</th><th></th></tr></thead><tbody>' +
      items.map((r) => {
        const actions = r.status === 'pending_approval'
          ? '<button class="small" onclick="approveRelationship(\'' + r.id + '\',\'active\')">Approve</button> ' +
            '<button class="small danger" onclick="approveRelationship(\'' + r.id + '\',\'rejected\')">Reject</button>'
          : '';
        return '<tr><td>' + r.followerAccountId + '</td><td>' + r.riskMode + ': ' + r.riskValue + '</td><td>' + badge(r.status) + '</td><td>' + actions + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderAsFollower(items) {
    if (items.length === 0) {
      el.asFollowerContainer.className = 'empty-state';
      el.asFollowerContainer.textContent = 'You are not copying anyone yet.';
      return;
    }
    el.asFollowerContainer.className = '';
    el.asFollowerContainer.innerHTML = '<table><thead><tr><th>Master Acct</th><th>Risk Controls</th><th>Status</th></tr></thead><tbody>' +
      items.map((r) =>
        '<tr><td>' + r.masterAccountId + '</td><td><div class="risk-controls">' +
        '<select id="riskMode_' + r.id + '">' +
          ['fixed_lot', 'percent_of_master', 'percent_of_balance'].map((m) =>
            '<option value="' + m + '"' + (m === r.riskMode ? ' selected' : '') + '>' + m + '</option>').join('') +
        '</select>' +
        '<input id="riskValue_' + r.id + '" type="number" step="0.01" value="' + r.riskValue + '" />' +
        '<label style="font-size:12px;color:var(--muted);"><input id="enabled_' + r.id + '" type="checkbox" ' + (r.enabled ? 'checked' : '') + ' /> enabled</label>' +
        '<button class="small secondary" onclick="updateRisk(\'' + r.id + '\')">Save</button>' +
        '</div></td><td>' + badge(r.status) + '</td></tr>'
      ).join('') + '</tbody></table>';
  }

  async function loadRelationships() {
    try {
      const data = await api('GET', '/api/copy-relationships');
      renderAsMaster(data.asMaster || []);
      renderAsFollower(data.asFollower || []);
    } catch (err) {
      el.asMasterContainer.textContent = 'Failed to load: ' + err.message;
      el.asFollowerContainer.textContent = 'Failed to load: ' + err.message;
    }
  }

  async function loadFeed() {
    try {
      const data = await api('GET', '/api/trade-feed');
      const events = data.events || [];
      const executions = data.executions || [];

      if (events.length === 0 && executions.length === 0) {
        el.feedContainer.className = 'empty-state';
        el.feedContainer.textContent = 'No trade activity yet.';
        return;
      }

      el.feedContainer.className = '';
      el.feedContainer.innerHTML =
        '<h3 style="font-size:12px;color:var(--muted);margin:0 0 8px;">Trade Events</h3>' +
        '<table><thead><tr><th>Symbol</th><th>Type</th><th>Side</th><th>Size</th><th>Source</th><th>Status</th><th>Time</th></tr></thead><tbody>' +
        events.slice(0, 20).map((e) =>
          '<tr><td>' + e.symbol + '</td><td>' + e.eventType + '</td><td>' + (e.side || '-') + '</td><td>' + (e.size ?? '-') +
          '</td><td>' + e.source + '</td><td>' + badge(e.status) + '</td><td>' + new Date(e.receivedAt).toLocaleTimeString() + '</td></tr>'
        ).join('') + '</tbody></table>' +
        '<h3 style="font-size:12px;color:var(--muted);margin:16px 0 8px;">Copy Executions</h3>' +
        '<table><thead><tr><th>Symbol</th><th>Size</th><th>Status</th><th>Error</th></tr></thead><tbody>' +
        executions.slice(0, 20).map((x) =>
          '<tr><td>' + (x.mappedSymbol || '-') + '</td><td>' + (x.calculatedSize ?? '-') + '</td><td>' + badge(x.status) +
          '</td><td>' + (x.errorMessage || '-') + '</td></tr>'
        ).join('') + '</tbody></table>';
    } catch (err) {
      el.feedContainer.className = 'empty-state';
      el.feedContainer.textContent = 'Failed to load feed: ' + err.message;
    }
  }

  async function refresh() {
    await Promise.all([loadAccounts(), loadRelationships(), loadFeed()]);
    el.refreshStatus.textContent = 'Last updated ' + new Date().toLocaleTimeString();
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refresh();
    refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
  }

  if (storedToken) {
    showDashboard();
    startAutoRefresh();
  }

  const REFRESH_INTERVAL_MS = 5000;
  let refreshTimer = null;
  let cachedFollowerAccounts = [];

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
    accountForm: document.getElementById('accountForm'),
    accountMessage: document.getElementById('accountMessage'),
    accountsContainer: document.getElementById('accountsContainer'),
    relationshipForm: document.getElementById('relationshipForm'),
    relationshipMessage: document.getElementById('relationshipMessage'),
    followerAccountId: document.getElementById('followerAccountId'),
    asMasterContainer: document.getElementById('asMasterContainer'),
    asFollowerContainer: document.getElementById('asFollowerContainer'),
    feedContainer: document.getElementById('feedContainer')
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

  function applyToken(token, message) {
    el.jwtToken.value = token;
    localStorage.setItem('brokerssync_token', token);
    el.authMessage.textContent = message || 'Session connected.';
    el.authMessage.className = 'message success';
    startAutoRefresh();
  }

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

  document.getElementById('acctPlatform').addEventListener('change', (e) => {
    document.getElementById('tlFields').style.display = e.target.value === 'tradelocker' ? 'grid' : 'none';
  });

  el.accountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const platform = document.getElementById('acctPlatform').value;
    const role = document.getElementById('acctRole').value;
    const environment = document.getElementById('acctEnvironment').value;
    const label = document.getElementById('acctLabel').value.trim();
    const balance = Number(document.getElementById('acctBalance').value) || 0;

    let credentials = {};
    if (platform === 'tradelocker') {
      credentials = {
        email: document.getElementById('tlEmail').value.trim(),
        password: document.getElementById('tlPassword').value,
        server: document.getElementById('tlServer').value.trim(),
        accountId: document.getElementById('tlAccountId').value.trim(),
        accNum: document.getElementById('tlAccNum').value.trim()
      };
    } else {
      credentials = { note: 'Bridge EA uses the webhook token below; no REST login required yet.' };
    }

    try {
      const data = await api('POST', '/api/broker-accounts', { platform, role, label, environment, credentials, balance });
      el.accountMessage.className = 'message success';
      el.accountMessage.innerHTML =
        'Account added.<div class="token-callout">Webhook token (shown once - configure this in your bridge EA / TradeLocker poller now):<br>' +
        data.webhookToken + '</div>';
      el.accountForm.reset();
      loadAccounts();
    } catch (err) {
      el.accountMessage.className = 'message error';
      el.accountMessage.textContent = err.message;
    }
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

  async function regenerateWebhookToken(id) {
    if (!confirm('This invalidates the current webhook token immediately - any bridge/EA still using it will start failing until reconfigured. Continue?')) return;
    try {
      const data = await api('POST', '/api/broker-accounts/' + id + '/webhook-token/regenerate');
      el.accountMessage.className = 'message success';
      el.accountMessage.innerHTML =
        'New webhook token (shown once - update your bridge EA / TradeLocker config now):<br>' +
        '<div class="token-callout">' + data.webhookToken + '</div>';
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadAccounts() {
    try {
      const data = await api('GET', '/api/broker-accounts');
      const accounts = data.accounts || [];
      cachedFollowerAccounts = accounts;

      el.followerAccountId.innerHTML = accounts
        .map((a) => '<option value="' + a.id + '">' + (a.label || a.platform) + ' (' + a.platform + ')</option>')
        .join('');

      if (accounts.length === 0) {
        el.accountsContainer.className = 'empty-state';
        el.accountsContainer.textContent = 'No broker accounts yet.';
        return;
      }

      el.accountsContainer.className = '';
      el.accountsContainer.innerHTML =
        '<table><thead><tr><th>Label</th><th>Platform</th><th>Role</th><th>Env</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>' +
        accounts.map((a) =>
          '<tr><td>' + (a.label || '-') + '</td><td>' + a.platform + '</td><td>' + a.role + '</td><td>' + a.environment +
          '</td><td>$' + a.balance.toFixed(2) + '</td><td>' + badge(a.status) + '</td>' +
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

  if (storedToken) startAutoRefresh();

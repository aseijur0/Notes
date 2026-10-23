(async function () {
  'use strict';
  const C = OSCP, N = Notebook, $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const colors = {host: '#81b8f3', service: '#7bd4c2', credential: '#e9c17c', finding: '#e8a08e', note: '#b8a1e5'};
  const names = {host: 'Host', service: 'Service', credential: 'Credential', finding: 'Finding', note: 'Note'};
  const STORAGE = 'oscp-map.workspace.v1', PREF = 'oscp-map.autosave.v1', MAX_BACKUP = 50 * 1024 * 1024;
  let w = C.workspace(), view = 'map', selected = '', scope = '', search = '', kinds = new Set(C.KINDS);
  let undo = [], dirty = false, autosave = true, savedLocally = false, toastTimer, submitAction;
  let activeHost = '', activeNote = '', noteField = 'notes', notebookTab = 'notes', editCheckpoint = false, taskEditCheckpoint = false;
  let saveTimer, saveRevision = 0, saveQueue = Promise.resolve(), query = '', searchResults = [], suggestions = [], referenceSuggestions = [];
  let folderEnabled = false, folderName = '', folderQueue = Promise.resolve();
  let shown = [], positions = {}, box = {x: -70, y: -80, width: 1350, height: 800}, drag = null, importBusy = false;
  let restoreWarning = '';
  try {
    autosave = localStorage.getItem(PREF) !== 'false';
    const saved = autosave ? await NotebookStorage.load(STORAGE) : null;
    if (saved) {w = C.validate(saved); savedLocally = true;}
  } catch (e) {restoreWarning = 'Local restore unavailable: ' + e.message + ' Open a saved JSON backup to recover your work.';}
  let workspaceCollapsed = w.nodes.length > 0;
  activeHost = w.nodes.find(n => n.kind === 'host')?.id || '';
  const find = id => w.nodes.find(n => n.id === id);
  const hosts = () => w.nodes.filter(n => n.kind === 'host');
  const date = value => {const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});};
  const clipped = (value, length = 28) => String(value || '').length > length ? String(value).slice(0, length - 1) + '…' : String(value || '');
  const badge = (text, cls = '') => '<span class="badge ' + cls + '">' + esc(text) + '</span>';
  const hostName = n => find(n.hostId)?.title || 'Unassigned';
  const download = (filename, data, type = 'application/json') => {
    const url = URL.createObjectURL(new Blob([data], {type})), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const safeFilename = name => name.replace(/[^a-z0-9._-]/gi, '-').slice(0, 90) || 'workspace';
  function toast(message) {clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => {$('toast').hidden = true;}, 5500);}
  function remember() {undo.push(C.clone(w)); if (undo.length > 8) undo.shift();}
  function checkSize(next) {
    if (new Blob([JSON.stringify(next, null, 2)]).size > MAX_BACKUP) throw new Error('This change would exceed the 50 MB workspace limit. Save your current backup and start a separate workspace.');
  }
  function persist() {
    clearTimeout(saveTimer); saveTimer = null;
    const revision = ++saveRevision;
    savedLocally = false;
    $('undo-btn').disabled = !undo.length;
    const snapshot = C.clone(w);
    if (autosave) {
      $('save-status').textContent = 'Saving locally…';
      saveQueue = saveQueue.catch(() => {}).then(() => NotebookStorage.save(snapshot, STORAGE)).then(() => {
        if (revision !== saveRevision) return;
        savedLocally = true; $('save-status').textContent = 'Saved locally · unencrypted'; $('save-status').classList.remove('warning');
      }).catch(() => {
        if (revision !== saveRevision) return;
        $('save-status').textContent = 'Local save failed · download a backup'; $('save-status').classList.add('warning');
        toast('Local storage is unavailable or full. Your text is still in this tab; download a backup.');
      });
    } else {
      $('save-status').textContent = 'Session only · save a backup to keep your work'; $('save-status').classList.add('warning');
    }
    if (folderEnabled) {
      $('folder-status').textContent = 'Folder: saving…';
      folderQueue = folderQueue.catch(() => {}).then(() => FolderStorage.write(snapshot)).then(() => {
        if (revision !== saveRevision) return;
        $('folder-status').textContent = 'Folder: saved to "' + folderName + '"';
      }).catch(error => {
        if (revision !== saveRevision) return;
        folderEnabled = false; $('folder-status').textContent = '';
        toast('Folder autosave stopped: ' + error.message);
      });
    } else $('folder-status').textContent = '';
    return saveQueue;
  }
  function changed(message, refit = false) {
    if (message) C.record(w, message);
    dirty = true; persist(); render(refit);
  }
  function matches(n) {
    return !search || [n.title, n.address, n.hostname, n.os, n.username, n.domain, n.service, n.version, n.notes, n.source, n.status, n.port].join(' ').toLowerCase().includes(search);
  }
  function filtered() {return w.nodes.filter(n => (!scope || n.id === scope || n.hostId === scope) && matches(n));}
  function select(id, navigate = false) {
    const n = find(id);
    if (n?.kind === 'host') {openNotebook(n.id); return;}
    if (n?.kind === 'note' || n?.kind === 'finding') {openNotebook(n.hostId, n.id); return;}
    selected = id; $('inspector').classList.add('open');
    if (navigate) {scope = ''; search = ''; $('search').value = ''; kinds = new Set(C.KINDS); view = 'map';}
    render(navigate);
  }
  function render(refit = false) {
    if (selected && !find(selected)) selected = '';
    if (scope && !find(scope)) scope = '';
    if (activeHost && !find(activeHost)) activeHost = '';
    const layout = $('app-layout'), inspectorOpen = Boolean(selected);
    if (layout.classList.contains('inspector-open') !== inspectorOpen) refit = true;
    layout.classList.toggle('inspector-open', inspectorOpen);
    layout.classList.toggle('workspace-collapsed', workspaceCollapsed);
    layout.classList.toggle('map-populated', view === 'map' && w.nodes.length > 0);
    layout.classList.toggle('notebook-active', view === 'notebook');
    $('inspector').hidden = !inspectorOpen;
    $('inspector').classList.toggle('open', inspectorOpen);
    $('workspace-panel').classList.toggle('collapsed', workspaceCollapsed);
    $('workspace-content').hidden = workspaceCollapsed;
    $('settings-btn').hidden = workspaceCollapsed;
    const toggle = $('workspace-toggle'), toggleLabel = workspaceCollapsed ? 'Show workspace' : 'Hide workspace';
    toggle.textContent = workspaceCollapsed ? '›' : '‹';
    toggle.setAttribute('aria-expanded', String(!workspaceCollapsed));
    toggle.setAttribute('aria-label', toggleLabel); toggle.title = toggleLabel;
    $('workspace-name').textContent = w.name;
    const counts = Object.fromEntries(C.KINDS.map(k => [k, w.nodes.filter(n => n.kind === k).length]));
    $('count-all').textContent = w.nodes.length; $('count-host').textContent = counts.host; $('count-credential').textContent = counts.credential; $('count-finding').textContent = counts.finding + counts.note;
    const owned = hosts().filter(n => ['Privileged', 'Documented'].includes(n.status)).length;
    $('metrics').innerHTML = [[counts.host, 'Hosts', 'IN SCOPE', '▣'], [counts.service, 'Services', 'OBSERVED', '⌁'], [counts.credential, 'Credentials', 'COLLECTED', '⚿'], [owned + '/' + counts.host, 'Privileged', 'HOSTS', '⚑']].map(([value, label, sub, icon]) => '<div class="metric"><span class="metric-value">' + value + '</span><div class="metric-label">' + label + '<small>' + sub + '</small></div><span class="metric-icon">' + icon + '</span></div>').join('');
    $('scope').innerHTML = '<option value="">All hosts</option>' + hosts().map(h => '<option value="' + h.id + '">' + esc(h.title) + '</option>').join(''); $('scope').value = scope;
    const titles = {notebook: ['NOTEBOOK', find(activeHost)?.title || 'Inbox'], tasks: ['RESUME YOUR WORK', 'Check next'], map: ['OVERVIEW', 'Mind map'], hosts: ['KNOW YOUR TARGETS', 'Hosts & services'], credentials: ['QUICK ACCESS', 'Credentials'], findings: ['KEEP THE EVIDENCE', 'Saved discoveries'], checklist: ['ONE STEP AT A TIME', 'Progress'], activity: ['THE INVESTIGATION TRAIL', 'Activity & imports']};
    $('view-eyebrow').textContent = titles[view][0]; $('view-title').innerHTML = esc(titles[view][1]) + '<span class="title-dot">.</span>';
    document.querySelectorAll('[data-view]').forEach(b => {b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false');});
    $('clear-filters').hidden = !scope && !search;
    $('result-count').textContent = filtered().length + ' objects';
    $('map-view').hidden = view !== 'map'; $('list-view').hidden = view === 'map' || view === 'notebook';
    $('notebook-view').hidden = view !== 'notebook';
    $('map-btn').hidden = view === 'map'; $('add-btn').textContent = view === 'notebook' ? 'Write notes' : 'Open notebook';
    $('scope').hidden = view !== 'map';
    $('link-btn').disabled = w.nodes.length < 2;
    $('search').disabled = false; $('scope').disabled = false;
    if (view === 'map') {renderGraph(); if (refit) requestAnimationFrame(fit);}
    else if (view === 'notebook') renderNotebook();
    else if (view === 'credentials') $('list-view').innerHTML = credentialsHTML(null);
    else if (view === 'tasks') $('list-view').innerHTML = tasksHTML(null);
    else renderList();
    renderInspector();
    if (query) renderSearch();
  }
  function renderGraph() {
    $('map-filters').innerHTML = C.KINDS.map(k => '<button data-kind="' + k + '" aria-pressed="' + kinds.has(k) + '"><i class="kind-dot" style="background:' + colors[k] + '"></i>' + names[k] + 's <span>' + w.nodes.filter(n => n.kind === k).length + '</span></button>').join('');
    const visible = new Map(filtered().filter(n => !n.notebook && kinds.has(n.kind)).map(n => [n.id, n]));
    if (kinds.has('host')) for (const n of [...visible.values()]) if (n.hostId && find(n.hostId)) visible.set(n.hostId, find(n.hostId));
    shown = [...visible.values()].slice(0, 300);
    positions = C.layout(shown, w.positions);
    $('welcome').hidden = w.nodes.length > 0; $('no-results').hidden = !w.nodes.length || shown.length > 0;
    $('map-caption').textContent = visible.size > 300 ? 'Showing 300 of ' + visible.size + ' nodes · narrow by host or search' : shown.length + ' nodes · drag to arrange · scroll to zoom';
    const ids = new Set(shown.map(n => n.id));
    $('graph-edges').innerHTML = C.edges(w).filter(e => ids.has(e.from) && ids.has(e.to)).map(e => {
      const a = positions[e.from], b = positions[e.to];
      const forward = b.x >= a.x;
      const x1 = a.x + (forward ? 240 : 0), y1 = a.y + 39, x2 = b.x + (forward ? 0 : 240), y2 = b.y + 39;
      const curve = Math.max(70, Math.abs(x2 - x1) * .5), d = 'M' + x1 + ',' + y1 + ' C' + (x1 + (forward ? curve : -curve)) + ',' + y1 + ' ' + (x2 + (forward ? -curve : curve)) + ',' + y2 + ' ' + x2 + ',' + y2;
      return '<g class="edge ' + (e.status !== 'structural' ? 'manual ' : '') + (e.status === 'lead' ? 'lead' : '') + '" ' + (e.status !== 'structural' ? 'data-link="' + e.id + '" role="button" tabindex="0" aria-label="' + esc(e.label + ', ' + e.status + '. Edit relationship') + '"' : '') + '><path d="' + d + '" marker-end="url(#arrow)"/><text x="' + ((x1 + x2) / 2) + '" y="' + ((y1 + y2) / 2 - 8) + '" text-anchor="middle">' + esc(clipped(e.label, 26)) + '</text></g>';
    }).join('');
    $('graph-nodes').innerHTML = shown.map(n => {
      const p = positions[n.id], subtitle = n.kind === 'host' ? n.address + ' · ' + n.status : n.kind === 'service' ? (n.state || 'unknown') + ' · ' + (n.version || n.service || 'service') : n.kind === 'credential' ? (n.domain ? n.domain + ' · ' : '') + (n.secretType || 'Username') + ' · ' + n.status : n.kind === 'finding' ? (n.priority || 'Medium') + ' · ' + n.status : clipped(n.notes.replace(/\s+/g, ' '), 34) || 'Investigation note';
      return '<g class="graph-node ' + (selected === n.id ? 'selected' : '') + '" transform="translate(' + p.x + ',' + p.y + ')" data-node="' + n.id + '" role="button" tabindex="0" aria-label="' + esc(names[n.kind] + ': ' + n.title) + '"><title>' + esc(n.title + '\n' + subtitle) + '</title><rect class="node-bg" width="240" height="78" rx="8"/><rect x="0" y="18" width="3" height="42" rx="1.5" fill="' + colors[n.kind] + '"/><circle cx="17" cy="18" r="3" fill="' + colors[n.kind] + '"/><text class="node-kind" x="27" y="21" fill="' + colors[n.kind] + '">' + names[n.kind].toUpperCase() + '</text><text class="node-title" x="15" y="42">' + esc(clipped(n.title, 29)) + '</text><text class="node-subtitle" x="15" y="62">' + esc(clipped(subtitle, 35)) + '</text></g>';
    }).join('');
    applyBox();
  }
  function applyBox() {$('graph').setAttribute('viewBox', [box.x, box.y, box.width, box.height].join(' ')); $('zoom-level').textContent = Math.round(($('graph').clientWidth || 800) / box.width * 100) + '%';}
  function fit() {
    if (view !== 'map' || !shown.length) return;
    const points = shown.map(n => positions[n.id]), xs = points.map(p => p.x), ys = points.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs) + 350, height = Math.max(...ys) - Math.min(...ys) + 240;
    const ratio = ($('graph').clientWidth || 800) / ($('graph').clientHeight || 600);
    box.width = Math.max(width, height * ratio); box.height = box.width / ratio;
    box.x = (Math.max(...xs) + Math.min(...xs) + 240 - box.width) / 2;
    box.y = (Math.max(...ys) + Math.min(...ys) + 78 - box.height) / 2;
    applyBox();
  }
  function zoom(factor, point) {
    const newWidth = Math.max(250, Math.min(100000, box.width * factor)), ratio = newWidth / box.width;
    const x = point?.x ?? box.x + box.width / 2, y = point?.y ?? box.y + box.height / 2;
    box = {x: x - (x - box.x) * ratio, y: y - (y - box.y) * ratio, width: newWidth, height: box.height * ratio}; applyBox();
  }
  function svgPoint(e) {const p = new DOMPoint(e.clientX, e.clientY); return p.matrixTransform($('graph').getScreenCTM().inverse());}
  $('graph').addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('[data-link]')) return;
    const id = e.target.closest('[data-node]')?.dataset.node;
    drag = {id, start: svgPoint(e), screenX: e.clientX, screenY: e.clientY, original: id ? {...positions[id]} : {...box}, moved: false, remembered: false};
    $('graph').setPointerCapture(e.pointerId);
  });
  $('graph').addEventListener('pointermove', e => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.screenX) + Math.abs(e.clientY - drag.screenY) < 5 && !drag.moved) return;
    drag.moved = true;
    const point = svgPoint(e), dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    if (drag.id) {
      if (!drag.remembered) {remember(); drag.remembered = true;}
      w.positions[drag.id] = {x: drag.original.x + dx, y: drag.original.y + dy}; renderGraph();
    } else {box.x -= dx; box.y -= dy; applyBox();}
  });
  $('graph').addEventListener('pointerup', e => {
    if (!drag) return;
    const finished = drag; drag = null; $('graph').releasePointerCapture(e.pointerId);
    if (finished.id && !finished.moved) select(finished.id);
    else if (finished.id) {dirty = true; w.updated = C.now(); persist();}
  });
  $('graph').addEventListener('pointercancel', () => {if (drag?.remembered) {dirty = true; persist();} drag = null;});
  $('graph').addEventListener('wheel', e => {e.preventDefault(); zoom(e.deltaY > 0 ? 1.12 : .89, svgPoint(e));}, {passive: false});
  $('graph').addEventListener('keydown', e => {
    const n = e.target.closest('[data-node]'), link = e.target.closest('[data-link]');
    if (e.key === 'Enter' || e.key === ' ') {if (n) {e.preventDefault(); select(n.dataset.node);} else if (link) {e.preventDefault(); linkForm(link.dataset.link);}}
    if (e.key === '+' || e.key === '=') zoom(.8);
    if (e.key === '-') zoom(1.25);
    if (e.key.toLowerCase() === 'f') fit();
  });
  function emptyList(title, text, kind) {return '<div class="empty-list"><div class="large-symbol">◇</div><h3>' + title + '</h3><p>' + text + '</p>' + (kind ? '<button class="primary" data-add="' + kind + '">+ Add ' + names[kind].toLowerCase() + '</button>' : '') + '</div>';}
  function checkRows(h) {return C.CHECKS.map(c => '<label class="check-row ' + (h.checks?.includes(c) ? 'done' : '') + '"><input type="checkbox" data-check-host="' + h.id + '" data-check="' + c + '" ' + (h.checks?.includes(c) ? 'checked' : '') + '>' + c + '</label>').join('');}
  function renderList() {
    const nodes = filtered(), button = n => '<button class="table-link" data-select="' + n.id + '"><strong>' + esc(n.title) + '</strong></button>';
    if (view === 'hosts') {
      const rows = nodes.filter(n => n.kind === 'host' || n.kind === 'service');
      $('list-view').innerHTML = '<div class="list-section-head"><p>Observed services and your recorded progress.</p><button data-add="host">+ Add host</button></div>' + (rows.length ? '<div class="table-wrap"><table><thead><tr><th>HOST / SERVICE</th><th>ADDRESS / PARENT</th><th>STATUS</th><th>DETAILS</th></tr></thead><tbody>' + rows.map(n => '<tr class="clickable" data-select="' + n.id + '"><td>' + button(n) + '<small>' + names[n.kind] + '</small></td><td class="mono">' + esc(n.address || hostName(n)) + '</td><td>' + badge(n.kind === 'host' ? n.status : n.state || 'Unknown', ['Privileged', 'Documented'].includes(n.status) ? 'good' : '') + '</td><td>' + esc(n.os || n.version || '—') + '</td></tr>').join('') + '</tbody></table></div>' : emptyList('No hosts in this view', 'Import an Nmap scan, add a host, or clear your filters.', 'host'));
    } else if (view === 'credentials') {
      const rows = nodes.filter(n => n.kind === 'credential');
      $('list-view').innerHTML = '<div class="list-section-head"><p>Secrets stay masked. Select a record to reveal or copy.</p><button data-add="credential">+ Add credential</button></div>' + (rows.length ? '<div class="table-wrap"><table><thead><tr><th>IDENTITY</th><th>SECRET</th><th>RECORDED ON</th><th>VALIDATION</th></tr></thead><tbody>' + rows.map(n => '<tr class="clickable" data-select="' + n.id + '"><td>' + button(n) + '<small>' + esc(n.domain || 'No domain') + '</small></td><td class="mono">' + (n.secret ? '••••••••' : 'Username only') + '<small>' + esc(n.secretType || '') + '</small></td><td>' + esc(hostName(n)) + '</td><td>' + badge(n.status, n.status === 'Validated' ? 'good' : 'warn') + '</td></tr>').join('') + '</tbody></table></div>' : emptyList('Keep identities connected', 'Record usernames, passwords, hashes, and where you found them.', 'credential'));
    } else if (view === 'findings') {
      const rows = nodes.filter(n => n.kind === 'finding' || n.kind === 'note');
      $('list-view').innerHTML = '<div class="list-section-head"><p>Evidence, observations, and questions to follow up.</p><button data-add="note">+ Add note</button></div>' + (rows.length ? rows.map(n => '<article class="finding-card"><div class="card-head"><div><small>' + names[n.kind].toUpperCase() + ' · ' + esc(hostName(n)) + '</small><h3>' + button(n) + '</h3></div>' + badge(n.priority || 'Note', n.priority === 'High' || n.priority === 'Critical' ? 'high' : '') + '</div><p>' + esc(clipped(n.notes, 230) || 'No evidence recorded yet.') + '</p><div class="mini-actions">' + badge(n.status) + '<button data-select="' + n.id + '">Inspect →</button></div></article>').join('') : emptyList('Capture the useful details', 'Add a finding or note, then connect it to the rest of your investigation.', 'finding'));
    } else if (view === 'checklist') {
      const rows = nodes.filter(n => n.kind === 'host');
      $('list-view').innerHTML = '<div class="list-section-head"><p>A personal workflow checklist; stages and checks are recorded independently.</p></div>' + (rows.length ? rows.map(h => '<article class="host-card"><div class="card-head"><div><h3>' + button(h) + '</h3><small>' + esc(h.address) + '</small></div>' + badge(h.status, ['Privileged', 'Documented'].includes(h.status) ? 'good' : '') + '</div><div class="progress-track"><div class="progress-fill" style="width:' + (h.checks?.length || 0) / C.CHECKS.length * 100 + '%"></div></div><div class="card-grid">' + checkRows(h) + '</div></article>').join('') : emptyList('Your progress, host by host', 'Add your targets to start tracking enumeration, access, and evidence.', 'host'));
    } else {
      $('list-view').innerHTML = '<p class="form-hint">Activity and imports cover the entire workspace.</p><h3 class="list-subheading">IMPORTED SCANS · ' + w.scans.length + '</h3>' + (w.scans.length ? w.scans.map(s => '<div class="scan-row"><div><strong>' + esc(s.name) + '</strong><small>' + esc(date(s.imported)) + ' · ' + (new Blob([s.raw]).size / 1024).toFixed(1) + ' KB · original preserved</small></div><button data-scan="' + s.id + '">View source</button></div>').join('') : '<p class="form-hint">Imported scans will be preserved here, including original script output.</p>') + '<h3 class="list-subheading">ACTIVITY · ' + w.activity.length + '</h3>' + (w.activity.length ? w.activity.map(a => '<div class="timeline-item"><time>' + esc(date(a.time)) + '</time><div>' + esc(a.message) + '</div></div>').join('') : '<p class="form-hint">Your discoveries and changes will appear here.</p>');
    }
  }
  function renderInspector() {
    const n = find(selected);
    if (!n) {
      $('inspector').innerHTML = '';
      return;
    }
    const details = n.kind === 'host' ? [['Address', n.address], ['Hostname', n.hostname], ['OS / guess', n.os]] : n.kind === 'service' ? [['Host', hostName(n)], ['Port', n.port + '/' + n.protocol], ['State', n.state], ['Service', n.service], ['Version', n.version]] : n.kind === 'credential' ? [['Username', n.username], ['Domain', n.domain], ['Type', n.secretType], ['Recorded on', hostName(n)], ['Validation', n.status]] : [['Host', hostName(n)], ['Status', n.status], ...(n.kind === 'finding' ? [['Priority', n.priority]] : [])];
    const related = C.edges(w).filter(e => e.from === n.id || e.to === n.id);
    $('inspector').innerHTML = '<div class="inspector-head"><div class="inspector-topline"><span class="badge" style="color:' + colors[n.kind] + '">' + names[n.kind].toUpperCase() + '</span><button class="icon-btn" data-close-inspector aria-label="Close inspector">×</button></div><h2>' + esc(n.title) + '</h2><div class="inspector-sub">' + esc(n.kind === 'host' ? n.address : hostName(n)) + '</div><div class="inspector-actions"><button class="primary" data-edit="' + n.id + '">Edit details</button><button data-link-from="' + n.id + '">+ Link</button><button class="quiet" data-delete="' + n.id + '" aria-label="Delete discovery">Delete</button></div></div>' +
      (n.kind === 'host' ? '<div class="section"><div class="section-label">HOST STAGE</div><select class="stage-select" data-stage="' + n.id + '" aria-label="Host stage">' + options(C.STAGES, n.status) + '</select></div>' : '') +
      '<div class="section"><div class="section-label">DETAILS</div><dl class="detail-grid">' + details.map(([k, v]) => '<dt>' + k + '</dt><dd>' + esc(v || '—') + '</dd>').join('') + '</dl></div>' +
      (n.kind === 'credential' ? '<div class="section"><div class="section-label">SECRET · ' + esc(n.secretType || 'USERNAME ONLY') + '</div><span id="secret-value" class="secret-value">' + (n.secret ? '••••••••••••' : 'No secret recorded') + '</span><div class="mini-actions"><button data-reveal="' + n.id + '">Reveal</button><button data-copy-secret="' + n.id + '">Copy secret</button></div></div>' : '') +
      '<div class="section"><div class="section-label">EVIDENCE & NOTES <button class="icon-btn" data-edit="' + n.id + '" aria-label="Edit notes">+</button></div><div class="prose">' + esc(n.notes || 'No notes yet. Record what you observed and how to reproduce it.') + '</div>' + (n.source ? '<p>Source: <span class="mono">' + esc(n.source) + '</span></p>' : '') + '</div>' +
      (n.command ? '<div class="section"><div class="section-label">COMMANDS / REPRODUCTION</div><pre class="code-block">' + esc(n.command) + '</pre><button data-copy-command="' + n.id + '">Copy</button></div>' : '') +
      (n.kind === 'host' ? '<div class="section"><div class="section-label">CHECKLIST <span>' + (n.checks?.length || 0) + '/' + C.CHECKS.length + '</span></div>' + checkRows(n) + '</div>' : '') +
      '<div class="section"><div class="section-label">CONNECTIONS <span>' + related.length + '</span></div>' + (related.length ? related.map(e => {
        const outgoing = e.from === n.id, other = find(outgoing ? e.to : e.from);
        return '<button class="relation-btn" data-select="' + other.id + '">' + (outgoing ? '→ ' : '← ') + esc(other.title) + '<small>' + esc(e.label) + ' · ' + (e.status === 'structural' ? 'record context' : e.status) + '</small></button>' + (e.status !== 'structural' ? '<button class="quiet" data-link="' + e.id + '" style="font-size:10px;padding:2px 0 5px">Edit relationship</button>' : '');
      }).join('') : '<p>No links yet. Connect this discovery to another node.</p>') + '</div>' +
      (n.scanIds?.length ? '<div class="section"><div class="section-label">SCAN EVIDENCE</div>' + n.scanIds.map(id => '<button class="relation-btn" data-scan="' + id + '">' + esc(w.scans.find(s => s.id === id)?.name || 'Source scan') + '</button>').join('') + '</div>' : '') + '<div class="section"><p style="font-size:10px">Created ' + esc(date(n.created)) + '<br>Updated ' + esc(date(n.updated)) + '</p></div>';
  }
  function openNotebook(hostId = activeHost, nodeId = '', field = 'notes', range = null) {
    const onTasks = field === 'tasks';
    activeHost = hostId || ''; activeNote = onTasks ? '' : nodeId; noteField = onTasks ? 'notes' : field; notebookTab = onTasks ? 'tasks' : 'notes'; editCheckpoint = false;
    selected = ''; view = 'notebook'; scope = ''; workspaceCollapsed = false; closeSearch(); render();
    if (range) requestAnimationFrame(() => {
      const editor = $(onTasks ? 'tasks-editor' : 'notebook-editor'); editor.focus(); editor.setSelectionRange(range.start, range.end);
      const line = editor.value.slice(0, range.start).split('\n').length - 1;
      editor.scrollTop = Math.max(0, line * 21 - editor.clientHeight / 3);
    });
  }
  function currentNote(create = false) {
    return (activeNote && find(activeNote)) || N.notebook(w, activeHost, create);
  }
  function renderNotebook() {
    const n = currentNote();
    $('notebook-host').innerHTML = '<option value="">Inbox · no host</option>' + hosts().map(h => '<option value="' + h.id + '">' + esc(h.title + ' · ' + h.address) + '</option>').join(''); $('notebook-host').value = activeHost;
    $('host-details').hidden = !activeHost;
    $('note-context').textContent = n && !n.notebook ? n.title + (noteField === 'command' ? ' · commands' : '') : 'Notes';
    $('back-to-notes').hidden = !activeNote;
    $('notebook-editor').value = n?.[noteField] || '';
    $('notebook-editor').readOnly = Boolean(n && ['host', 'service'].includes(n.kind));
    $('notebook-editor').setAttribute('aria-label', $('notebook-editor').readOnly ? 'Source evidence' : 'Notebook text');
    $('tasks-editor').value = N.notebook(w, activeHost)?.tasks || '- [ ] ';
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === notebookTab)));
    $('notebook-notes').hidden = notebookTab !== 'notes'; $('notebook-credentials').hidden = notebookTab !== 'credentials'; $('notebook-tasks').hidden = notebookTab !== 'tasks';
    refreshNotebookExtras();
  }
  function taskKey(t) {return t.nodeId + ':' + t.field + ':' + t.line;}
  function taskByKey(key) {return N.tasks(w).find(t => taskKey(t) === key);}
  function refreshNotebookExtras() {
    const n = currentNote(), next = N.pinned(w, activeHost);
    $('pinned-next').hidden = !next;
    $('pinned-next').innerHTML = next ? '<span>Next</span><button class="pinned-text" data-task-source="' + taskKey(next) + '">' + esc(next.text) + '</button><button class="quiet" data-pin-task="' + taskKey(next) + '">Unpin</button>' : '';
    $('notebook-credential-count').textContent = w.nodes.filter(x => x.kind === 'credential' && x.hostId === activeHost).length || '';
    $('notebook-task-count').textContent = N.tasks(w, activeHost).filter(t => !t.done).length || '';
    $('notebook-credentials').innerHTML = notebookTab === 'credentials' ? credentialsHTML(activeHost) : '';
    $('notebook-images').innerHTML = (n?.images || []).map(img => '<figure data-image="' + img.id + '"><img src="' + img.data + '" alt="' + esc(img.name) + '" loading="lazy"><figcaption>' + esc(img.name) + '<button class="quiet" data-image-download="' + img.id + '">Download</button><button class="quiet" data-image-delete="' + img.id + '">Remove</button></figcaption></figure>').join('');
    suggestions = n ? N.credentials(n[noteField] || '').filter(s => !w.nodes.some(c => c.kind === 'credential' && c.hostId === activeHost && c.username === s.username && c.secret === s.secret && (c.domain || '') === (s.domain || '') && c.sourceRef?.nodeId === n.id && c.sourceRef?.excerpt === s.excerpt)) : [];
    $('credential-suggestions').innerHTML = suggestions.slice(0, 8).map((s, i) => '<div class="suggestion"><span>Possible credential: <strong>' + esc(s.username) + '</strong><small>Secret masked · not validated</small></span><button data-save-suggestion="' + i + '">Keep credential</button></div>').join('');
    referenceSuggestions = n ? N.references(w, n[noteField] || '', activeHost).filter(r => !w.links.some(e => e.from === n.id && e.to === r.hostId && e.label === 'mentions')) : [];
    $('reference-suggestions').innerHTML = referenceSuggestions.slice(0, 8).map(r => '<div class="suggestion"><span>Mentions <strong>' + esc(r.title) + '</strong><small>' + esc(r.address) + ' · adds a reference, keeps this note here</small></span><button data-add-reference="' + r.hostId + '">Add reference</button></div>').join('');
    const evidence = w.nodes.filter(x => N.hostOf(x) === activeHost && x.id !== n?.id && (x.notes || x.command || x.images?.length || x.kind === 'service' || x.kind === 'finding'));
    $('evidence-summary').textContent = 'Scan evidence & earlier notes · ' + evidence.length;
    $('notebook-evidence').innerHTML = evidence.map(x => '<button class="evidence-row" data-evidence="' + x.id + '"><strong>' + esc(x.title) + '</strong><span>' + esc(clipped(x.notes || x.command || x.version || 'Service details', 180)) + '</span></button>').join('') || '<p class="form-hint">Imported output and existing findings appear here.</p>';
  }
  function credentialsHTML(hostId) {
    const records = w.nodes.filter(n => n.kind === 'credential' && (hostId === null || n.hostId === hostId));
    return '<div class="list-section-head"><p>' + (hostId === null ? 'Every saved identity, with its evidence close by.' : 'Credentials recorded in this host’s notes.') + '</p><button data-quick-credential>+ Credential</button></div>' + (records.length ? records.map(n => '<article class="credential-card"><div class="card-head"><div><strong>' + esc(n.username || n.title) + '</strong><small>' + esc([n.domain, hostName(n)].filter(Boolean).join(' · ')) + '</small></div>' + badge(n.status || 'Unverified', n.status === 'Validated' ? 'good' : '') + '</div><div class="credential-secret" data-secret-card="' + n.id + '">••••••••••••</div><div class="mini-actions"><button data-copy-user="' + n.id + '">Copy user</button><button data-copy-secret="' + n.id + '">Copy secret</button><button data-reveal-card="' + n.id + '">Reveal</button><button data-credential-source="' + n.id + '">Source</button><button class="quiet" data-edit="' + n.id + '">Details</button></div></article>').join('') : '<div class="notebook-empty">Paste configuration into Notes to get credential suggestions, or select a passage and choose “Keep as credential”.</div>');
  }
  function tasksHTML(hostId) {
    const tasks = N.tasks(w, hostId).sort((a, b) => Number(a.done) - Number(b.done));
    return '<div class="list-section-head"><p>Checkboxes from your notes. Pin one next step per host.</p></div>' + (tasks.length ? tasks.map(t => {
      const pin = N.pinned(w, t.hostId), isPinned = pin && taskKey(pin) === taskKey(t);
      return '<div class="task-item ' + (t.done ? 'done' : '') + '"><input type="checkbox" data-task="' + taskKey(t) + '" aria-label="' + esc(t.text) + '" ' + (t.done ? 'checked' : '') + '><button class="task-text" data-task-source="' + taskKey(t) + '">' + esc(t.text) + '<small>' + esc(find(t.hostId)?.title || 'Inbox') + ' · ' + esc(find(t.nodeId)?.title || 'Notes') + '</small></button>' + (!t.done ? '<button data-pin-task="' + taskKey(t) + '" aria-pressed="' + Boolean(isPinned) + '">' + (isPinned ? 'Pinned' : 'Pin next') + '</button>' : '') + '</div>';
    }).join('') : '<div class="notebook-empty">Write <code>- [ ] Your next step</code> in a notebook. It will appear here automatically.</div>');
  }
  function markDirty() {
    dirty = true; savedLocally = false; ++saveRevision;
    $('save-status').textContent = autosave ? 'Saving locally…' : 'Session only · save a backup';
    clearTimeout(saveTimer); saveTimer = setTimeout(() => {persist(); if (view === 'notebook') refreshNotebookExtras();}, 500);
    $('undo-btn').disabled = !undo.length;
  }
  $('notebook-editor').addEventListener('input', () => {
    if ($('notebook-editor').readOnly) return;
    if (!editCheckpoint) {remember(); editCheckpoint = true;}
    const n = currentNote(true); n[noteField] = $('notebook-editor').value; n.updated = w.updated = C.now(); markDirty();
  });
  $('notebook-editor').addEventListener('blur', () => {editCheckpoint = false;});
  $('tasks-editor').addEventListener('input', () => {
    if (!taskEditCheckpoint) {remember(); taskEditCheckpoint = true;}
    const n = N.notebook(w, activeHost, true); n.tasks = $('tasks-editor').value; n.updated = w.updated = C.now(); markDirty();
  });
  $('tasks-editor').addEventListener('blur', () => {taskEditCheckpoint = false;});
  $('tasks-editor').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = $('tasks-editor'), pos = el.selectionStart;
    const lineStart = el.value.lastIndexOf('\n', pos - 1) + 1, lineEnd = el.value.indexOf('\n', lineStart);
    const line = el.value.slice(lineStart, lineEnd < 0 ? el.value.length : lineEnd);
    const m = line.match(/^(\s*[-*]\s+\[[ xX]\]\s+)(.*)$/);
    if (!m) return;
    e.preventDefault();
    if (!m[2].trim()) {
      el.value = el.value.slice(0, lineStart) + el.value.slice(pos);
      el.selectionStart = el.selectionEnd = lineStart;
    } else {
      const prefix = m[1].replace(/\[[xX]\]/, '[ ]'), before = el.value.slice(0, pos), after = el.value.slice(pos);
      el.value = before + '\n' + prefix + after;
      el.selectionStart = el.selectionEnd = before.length + 1 + prefix.length;
    }
    el.dispatchEvent(new Event('input'));
  });
  $('notebook-host').addEventListener('change', e => openNotebook(e.target.value));
  function highlighted(text, term) {
    if (!term) return esc(text);
    const at = text.toLowerCase().indexOf(term.toLowerCase());
    if (at < 0) return esc(text);
    return esc(text.slice(0, at)) + '<mark>' + esc(text.slice(at, at + term.length)) + '</mark>' + esc(text.slice(at + term.length));
  }
  function closeSearch() {query = ''; $('search').value = ''; $('search-panel').hidden = true; $('search').setAttribute('aria-expanded', 'false');}
  function renderSearch() {
    const isOpen = Boolean(query.trim()); $('search-panel').hidden = !isOpen; $('search').setAttribute('aria-expanded', String(isOpen));
    if (!isOpen) return;
    searchResults = N.search(w, query);
    $('search-summary').textContent = searchResults.length + (searchResults.length === 150 ? '+ matches · refine to see more' : ' matches across all hosts');
    const term = query.trim().split(/\s+/)[0];
    $('search-results').innerHTML = searchResults.length ? searchResults.map((r, i) => '<button class="search-hit" data-result="' + i + '"><span><strong>' + esc(r.title) + '</strong><small>' + esc(find(r.hostId)?.title || (r.scanId ? 'Original scan' : 'Inbox')) + ' · ' + esc(r.field) + ' · line ' + (r.line + 1) + '</small></span><pre>' + highlighted(r.excerpt, term) + '</pre></button>').join('') : '<div class="notebook-empty">No matches. Try a username, command, IP, or a phrase from the output.</div>';
  }
  function jumpResult(index) {
    const result = searchResults[index]; if (!result) return;
    const term = query.trim().split(/\s+/)[0]; closeSearch();
    if (result.scanId) {showScan(result.scanId, result.start, term); return;}
    const n = find(result.nodeId);
    if (result.field === 'image') {openNotebook(N.hostOf(n), n.id); requestAnimationFrame(() => $('notebook-images').querySelector('[data-image="' + result.imageId + '"]')?.scrollIntoView({block: 'center'})); return;}
    if (result.field === 'identity') {
      if (n.kind === 'credential') {view = 'credentials'; selected = ''; render(); requestAnimationFrame(() => $('list-view').querySelector('[data-secret-card="' + n.id + '"]')?.scrollIntoView({block: 'center'}));}
      else if (n.kind === 'host') openNotebook(n.id);
      else openNotebook(N.hostOf(n), n.id);
    } else {
      openNotebook(N.hostOf(n), n.id, result.field, {start: result.start, end: result.start + term.length});
    }
  }
  function jumpSource(ref) {
    const located = N.locate(w, ref);
    if (located.missing || located.archived) {openDialog('Original evidence snapshot', '<p class="form-hint">The original passage was edited or removed. This is the text preserved when you saved the discovery.</p><pre class="code-block">' + esc(ref.excerpt) + '</pre>', null); return;}
    openNotebook(N.hostOf(located.n), located.n.id, ref.field, {start: located.start, end: located.start + ref.excerpt.length});
  }
  function keepCredential(values, ref = null, hostId = activeHost) {
    const duplicate = w.nodes.find(n => n.kind === 'credential' && n.hostId === hostId && n.username === values.username && n.secret === values.secret && (n.domain || '') === (values.domain || '') && n.sourceRef?.nodeId === ref?.nodeId && n.sourceRef?.excerpt === ref?.excerpt);
    if (duplicate) {toast('This credential is already saved.'); return;}
    remember();
    const cred = C.node('credential', {title: values.username, username: values.username, secret: values.secret || '', domain: values.domain || '', secretType: 'Password', status: 'Unverified', hostId, source: ref ? 'Notebook evidence' : '', ...(ref ? {sourceRef: ref} : {})});
    w.nodes.push(cred); C.record(w, 'Kept credential: ' + cred.username); dirty = true; persist();
    if (view === 'notebook') refreshNotebookExtras(); else render(); toast('Credential saved with its source.');
  }
  function quickCredential(useSelection = false) {
    const n = currentNote(), editor = $('notebook-editor'), start = editor.selectionStart, end = editor.selectionEnd;
    const excerpt = useSelection && n ? editor.value.slice(start, end) : '';
    if (useSelection && !excerpt.trim()) {toast('Select a passage in your notes first.'); editor.focus(); return;}
    const ref = excerpt ? N.sourceRef(n, noteField, start, excerpt) : null, suggested = N.credentials(excerpt)[0];
    openDialog('Keep credential', '<p class="form-hint">Recorded on ' + esc(find(activeHost)?.title || 'Inbox') + (ref ? ' · original passage retained.' : '.') + '</p><div class="form-grid">' + field('Username', 'username', suggested?.username || '', 'text', 'required autocomplete="off"') + field('Secret (optional)', 'secret', suggested?.secret || '', 'password', 'autocomplete="new-password"') + '</div><details class="credential-extra"><summary>Domain / realm</summary>' + field('Domain', 'domain', suggested?.domain || '') + '</details>', data => {
      const username = String(data.get('username') || '').trim(); if (!username) throw new Error('Enter a username.');
      closeDialog(); keepCredential({username, secret: String(data.get('secret') || ''), domain: String(data.get('domain') || '').trim()}, ref);
    }, 'Keep credential');
  }
  function quickHost() {
    openDialog('Add host', '<div class="form-grid">' + field('IP address or hostname', 'address', '', 'text', 'required maxlength="255" placeholder="192.168.56.10"', true) + '</div>', data => {
      const address = String(data.get('address') || '').trim(); if (!address) throw new Error('Enter an address.');
      const existing = hosts().find(h => h.address.toLowerCase() === address.toLowerCase());
      if (existing) {closeDialog(); openNotebook(existing.id); return;}
      remember(); const h = C.node('host', {address, title: address, checks: []}); w.nodes.push(h); closeDialog(); changed('Added host: ' + address); openNotebook(h.id); $('notebook-editor').focus();
    }, 'Open notebook');
  }
  function bookmarkSelection() {
    const editor = $('notebook-editor'), n = currentNote(), start = editor.selectionStart, text = editor.value.slice(start, editor.selectionEnd);
    if (!n || !text.trim()) {toast('Select the passage you want to pin to the map.'); editor.focus(); return;}
    remember(); w.nodes.push(C.node('finding', {hostId: activeHost, title: clipped(text.trim().split('\n')[0], 80), notes: text, status: 'Unverified', priority: 'Info', sourceRef: N.sourceRef(n, noteField, start, text)}));
    changed('Pinned a notebook passage to the map.'); toast('Passage pinned to the map.');
  }
  function addReference(hostId) {
    const n = currentNote(), host = find(hostId);
    if (!n || !host) return;
    if (w.links.some(e => e.from === n.id && e.to === host.id && e.label === 'mentions')) {toast('Already referenced.'); return;}
    remember(); w.links.push({id: C.uid(), from: n.id, to: host.id, label: 'mentions', status: 'lead'});
    C.record(w, 'Referenced ' + host.title + ' from notes.'); dirty = true; persist();
    if (view === 'notebook') refreshNotebookExtras(); else render();
    toast('Reference added — this note stays on its current host.');
  }
  async function attachImages(files) {
    if (!files.length) return;
    if (files.length > 10) {toast('Attach up to ten screenshots at a time.'); return;}
    if (view !== 'notebook') openNotebook();
    if ($('notebook-editor').readOnly) openNotebook(activeHost);
    remember(); const target = currentNote(true), targetId = target.id;
    for (const file of files) {
      try {
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Use PNG, JPEG, WebP, or GIF screenshots.');
        if (file.size > 8 * 1024 * 1024) throw new Error('Screenshot exceeds 8 MB.');
        const data = await new Promise((resolve, reject) => {const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read screenshot.')); reader.readAsDataURL(file);});
        const live = find(targetId); if (!live) throw new Error('The target notebook was removed; paste the screenshot again.');
        const image = {id: C.uid(), name: file.name || 'Screenshot', data};
        const next = C.clone(w); const destination = next.nodes.find(n => n.id === targetId); destination.images ||= []; destination.images.push(image); checkSize(next);
        live.images ||= []; live.images.push(image); live.updated = w.updated = C.now(); dirty = true; persist();
      } catch (error) {toast(error.message);}
    }
    if (view === 'notebook') refreshNotebookExtras(); $('image-input').value = '';
  }
  $('notebook-editor').addEventListener('paste', e => {
    const files = Array.from(e.clipboardData?.items || []).filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (files.length) {e.preventDefault(); attachImages(files);}
  });
  $('image-input').addEventListener('change', e => attachImages([...e.target.files]));
  function options(values, value) {return values.map(v => '<option value="' + esc(v) + '" ' + (v === value ? 'selected' : '') + '>' + esc(v) + '</option>').join('');}
  function field(label, name, value = '', type = 'text', extra = '', wide = false) {return '<label class="field ' + (wide ? 'wide' : '') + '"><span>' + label + '</span><input name="' + name + '" type="' + type + '" value="' + esc(value) + '" ' + extra + '></label>';}
  function area(label, name, value = '', placeholder = '') {return '<label class="field wide"><span>' + label + '</span><textarea name="' + name + '" placeholder="' + esc(placeholder) + '">' + esc(value) + '</textarea></label>';}
  function dropdown(label, name, values, value, extra = '') {return '<label class="field"><span>' + label + '</span><select name="' + name + '" ' + extra + '>' + options(values, value) + '</select></label>';}
  function openDialog(title, html, onSubmit, submitLabel = 'Save', eyebrow = 'WORKSPACE') {
    $('dialog-title').textContent = title; $('dialog-eyebrow').textContent = eyebrow; $('dialog-body').innerHTML = html; $('form-error').textContent = '';
    $('submit-btn').textContent = submitLabel; $('submit-btn').hidden = !onSubmit; $('cancel-dialog').textContent = onSubmit ? 'Cancel' : 'Close'; submitAction = onSubmit;
    if (!$('dialog').open) $('dialog').showModal();
  }
  $('editor').addEventListener('submit', async e => {e.preventDefault(); if (!submitAction) return; try {await submitAction(new FormData($('editor')));} catch (error) {$('form-error').textContent = error.message;}});
  function closeDialog() {$('dialog').close(); submitAction = null;}
  function nodeForm(kind = 'finding', id = '') {
    const existing = find(id), parent = find(selected), n = existing || C.node(kind, {hostId: scope || (parent?.kind === 'host' ? parent.id : parent?.hostId) || ''});
    kind = n.kind;
    const kindButtons = existing ? '' : '<div class="type-picker">' + C.KINDS.map(k => '<button type="button" data-form-kind="' + k + '" class="' + (k === kind ? 'active' : '') + '">' + names[k] + '</button>').join('') + '</div>';
    let html = kindButtons + '<div class="form-grid">';
    if (kind === 'host') html += field('IP address / hostname *', 'address', n.address, 'text', 'required maxlength="255" placeholder="192.168.1.10"') + field('Display name', 'title', n.title, 'text', 'maxlength="200" placeholder="WEB01"') + field('Hostname', 'hostname', n.hostname) + field('Operating system / guess', 'os', n.os) + dropdown('Stage', 'status', C.STAGES, n.status);
    else {
      if (kind !== 'service' && kind !== 'credential') html += field('Title *', 'title', n.title, 'text', 'required maxlength="200"', true);
      html += '<label class="field"><span>' + (kind === 'service' ? 'Host *' : 'Recorded on host') + '</span><select name="hostId" ' + (kind === 'service' ? 'required' : '') + '><option value="">' + (kind === 'service' ? 'Select a host' : 'Unassigned / global') + '</option>' + hosts().map(h => '<option value="' + h.id + '" ' + (h.id === n.hostId ? 'selected' : '') + '>' + esc(h.title + ' · ' + h.address) + '</option>').join('') + '</select></label>';
      if (kind === 'service') html += field('Port *', 'port', n.port ?? '', 'number', 'required min="0" max="65535" step="1"') + dropdown('Protocol', 'protocol', ['tcp', 'udp', 'sctp'], n.protocol || 'tcp') + field('Service name', 'service', n.service, 'text', 'placeholder="http, ssh, smb…"') + field('Version / banner', 'version', n.version) + dropdown('Observed state', 'state', ['open', 'open|filtered', 'closed', 'filtered', 'unfiltered', 'closed|filtered', 'unknown'], n.state || 'open');
      if (kind === 'credential') html += field('Username *', 'username', n.username, 'text', 'required maxlength="200" autocomplete="off"') + field('Domain / realm', 'domain', n.domain, 'text', 'placeholder="LAB or local" autocomplete="off"') + dropdown('Secret type', 'secretType', ['Password', 'NTLM hash', 'Hash', 'Key / token', 'Username only'], n.secretType || 'Password') + field('Password / hash / key', 'secret', n.secret, 'password', 'autocomplete="new-password"', true) + dropdown('Validation', 'status', ['Unverified', 'Validated', 'Invalid'], n.status || 'Unverified');
      if (kind === 'finding') html += dropdown('Priority', 'priority', ['Info', 'Low', 'Medium', 'High', 'Critical'], n.priority || 'Medium') + dropdown('Status', 'status', ['Unverified', 'Confirmed', 'Resolved', 'Dead end'], n.status || 'Unverified');
      if (kind === 'note') html += dropdown('Status', 'status', ['Unverified', 'In progress', 'Done', 'Dead end'], n.status || 'Unverified');
    }
    html += field('Source / evidence reference', 'source', n.source, 'text', 'placeholder="File path, URL, screenshot filename, or scan"', true) + area('Evidence & notes', 'notes', n.notes, 'What did you find? What still needs checking?') + area('Commands / reproduction', 'command', n.command, 'Commands are stored as text; nothing is executed.') + '</div>';
    if (kind === 'credential') html += '<div class="notice">Secrets are stored unencrypted in backups and optional browser storage. Masking only hides them on screen.</div>';
    if (kind === 'service' && !hosts().length) html += '<div class="notice">Add a host first, then attach its services.</div>';
    openDialog((existing ? 'Edit ' : 'Add ') + names[kind].toLowerCase(), html, data => {
      const fields = Object.fromEntries(data.entries());
      for (const key of Object.keys(fields)) if (!['secret', 'notes', 'command'].includes(key)) fields[key] = fields[key].trim();
      if (kind === 'host') {
        if (!fields.address) throw new Error('Enter an IP address or hostname.');
        if (hosts().some(h => h.id !== id && h.address.toLowerCase() === fields.address.toLowerCase())) throw new Error('This host already exists. Edit the existing host instead.');
        fields.title ||= fields.address; fields.checks = existing?.checks || [];
      }
      if (kind === 'service') {
        if (!fields.hostId) throw new Error('Select a host for this service.');
        fields.port = Number(fields.port);
        if (!Number.isInteger(fields.port) || fields.port < 0 || fields.port > 65535) throw new Error('Enter a port between 0 and 65535.');
        if (w.nodes.some(s => s.id !== id && s.kind === 'service' && s.hostId === fields.hostId && s.port === fields.port && s.protocol === fields.protocol)) throw new Error('This host already has that port and protocol. Edit the existing service.');
        fields.title = fields.port + '/' + fields.protocol + (fields.service ? ' · ' + fields.service : '');
      }
      if (kind === 'credential') {if (!fields.username) throw new Error('Enter a username.'); fields.title = fields.domain ? fields.domain + '\\' + fields.username : fields.username;}
      if (!fields.title) throw new Error('Enter a title.');
      const next = C.clone(w), result = {...n, ...fields, updated: C.now()};
      if (existing) next.nodes = next.nodes.map(item => item.id === id ? result : item); else next.nodes.push(result);
      C.record(next, (existing ? 'Updated ' : 'Added ') + kind + ': ' + result.title); checkSize(next);
      remember(); w = next; selected = result.id;
      if (!existing) {
        search = ''; $('search').value = ''; kinds.add(kind);
        if (scope && result.id !== scope && result.hostId !== scope) scope = result.kind === 'host' ? result.id : result.hostId;
        if (view !== 'map') view = kind === 'host' || kind === 'service' ? 'hosts' : kind === 'credential' ? 'credentials' : 'findings';
      }
      closeDialog(); changed('', !existing); $('inspector').classList.add('open');
    }, existing ? 'Save changes' : 'Add discovery', 'CAPTURE A DISCOVERY');
  }
  function linkForm(id = '', from = selected) {
    if (w.nodes.length < 2) {toast('Add at least two discoveries to connect them.'); return;}
    const link = w.links.find(e => e.id === id);
    from = link?.from || from || w.nodes[0].id;
    const list = val => w.nodes.map(n => '<option value="' + n.id + '" ' + (n.id === val ? 'selected' : '') + '>' + esc(names[n.kind] + ': ' + n.title + (n.hostId ? ' [' + hostName(n) + ']' : '')) + '</option>').join('');
    openDialog(link ? 'Edit relationship' : 'Connect discoveries', '<p class="form-hint">Draw a directed connection. Use a lead for something to investigate, and confirmed only for a relationship you have verified.</p><div class="form-grid"><label class="field wide"><span>From</span><select name="from">' + list(link?.from || from) + '</select></label><label class="field wide"><span>To</span><select name="to">' + list(link?.to || w.nodes.find(n => n.id !== from)?.id) + '</select></label>' + field('Relationship *', 'label', link?.label || '', 'text', 'required maxlength="100" placeholder="revealed, authenticates to, possible reuse…"', true) + dropdown('Evidence', 'status', ['lead', 'confirmed'], link?.status || 'lead') + '</div>' + (link ? '<div class="mini-actions"><button type="button" class="danger" data-delete-link="' + link.id + '">Delete relationship</button></div>' : ''), data => {
      const fields = Object.fromEntries(data.entries()); fields.label = fields.label.trim();
      if (fields.from === fields.to) throw new Error('Choose two different discoveries.');
      if (!fields.label) throw new Error('Describe the relationship.');
      if (w.links.some(e => e.id !== id && e.from === fields.from && e.to === fields.to && e.label === fields.label)) throw new Error('This relationship already exists.');
      remember(); if (link) Object.assign(link, fields); else w.links.push({id: C.uid(), ...fields});
      closeDialog(); changed((link ? 'Updated' : 'Added') + ' relationship: ' + fields.label); toast('Relationship saved.');
    }, 'Save relationship', 'CONNECT THE DOTS');
  }
  function confirmAction(title, message, action, label = 'Continue') {openDialog(title, '<p class="form-hint">' + esc(message) + '</p>', () => {closeDialog(); action();}, label);}
  function deleteNode(id) {
    const n = find(id); if (!n) return;
    const message = n.kind === 'host' ? 'Delete ' + n.title + ' and its services? Its credentials, findings, and notes will become unassigned. Connections to deleted nodes will be removed. Original scans remain available. You can undo this change.' : 'Delete ' + n.title + ' and its connections? You can undo this change.';
    confirmAction('Delete discovery?', message, () => {remember(); C.remove(w, id); selected = ''; changed('', true);}, 'Delete discovery');
  }
  function settings() {
    const folderSection = !FolderStorage.supported ? '' : '<label class="settings-row"><input type="checkbox" disabled ' + (folderEnabled ? 'checked' : '') + '><span><strong>Also save continuously to a chosen folder</strong><small>Experimental — writes an unencrypted workspace.json snapshot to a folder you pick, alongside browser storage. The folder choice is not remembered after reload; verify this works in your own browser before relying on it.</small></span></label><div class="mini-actions">' + (folderEnabled ? '<button type="button" id="stop-folder" class="quiet">Stop folder autosave (' + esc(folderName) + ')</button>' : '<button type="button" id="choose-folder">Choose folder…</button>') + '</div>';
    openDialog('Workspace settings', '<div class="form-grid">' + field('Workspace name', 'name', w.name, 'text', 'required maxlength="200"', true) + '</div><label class="settings-row"><input name="autosave" type="checkbox" ' + (autosave ? 'checked' : '') + '><span><strong>Autosave in this browser</strong><small>Stores scans, notes, and credentials unencrypted on this device. Browser storage may be limited or cleared; save JSON backups regularly. Direct-file storage behavior varies by browser.</small></span></label>' + folderSection + '<div class="notice">The HTML file contains the app, not your data. Save backup downloads a separate JSON file containing the entire workspace, including screenshots, credentials, and source scans.</div><div class="mini-actions"><button type="button" id="new-workspace" class="danger">New empty workspace</button><button type="button" id="settings-open">Open backup</button><button type="button" id="settings-demo">Load example lab</button></div>', async data => {
      const name = String(data.get('name')).trim(); if (!name) throw new Error('Enter a workspace name.');
      const enabled = data.has('autosave');
      clearTimeout(saveTimer); await saveQueue;
      try {localStorage.setItem(PREF, String(enabled)); if (!enabled) await NotebookStorage.clear(STORAGE);} catch {throw new Error('Could not change the browser storage preference.');}
      remember(); autosave = enabled; w.name = name; closeDialog(); changed('Updated workspace settings.');
    }, 'Save settings');
  }
  function replaceWorkspace(next, message) {
    const act = () => {remember(); w = next; selected = ''; scope = ''; search = ''; closeSearch(); activeHost = hosts()[0]?.id || ''; activeNote = ''; noteField = 'notes'; editCheckpoint = false; kinds = new Set(C.KINDS); view = 'map'; workspaceCollapsed = w.nodes.length > 0; changed(message, true); toast(message);};
    if (w.nodes.length || w.scans.length) confirmAction('Replace current workspace?', 'This replaces the workspace in this tab and any enabled browser autosave. Save a backup first if you need to keep it. Undo remains available until you close or reload the page.', act, 'Replace workspace'); else {if ($('dialog').open) closeDialog(); act();}
  }
  function help() {
    openDialog('Quick guide', '<p class="form-hint">Click a host to open its notebook. Paste text, terminal output, or screenshots; edits save automatically when browser autosave is on.</p><p class="form-hint">The notebook\'s Next steps tab already starts each line with <code>- [ ]</code> — just type the step and press Enter for the next one. Pin a step from there or from Check next to keep it visible above your notes. Recognized configuration fields offer a Keep credential button; you can also select any passage and choose Keep as credential or Pin to map.</p><p class="form-hint">Search covers all notebooks, commands, next steps, and original scans. Click a result to jump to its evidence. Ctrl/Cmd K focuses search. Escape closes search. Map returns to the overview; ordinary notebook text does not create map nodes.</p><p class="form-hint">Save backup downloads everything as JSON. Export notes creates Markdown notebooks and images in a ZIP, ready to extract into Obsidian. Browser storage and exports are unencrypted; source notes may contain credentials.</p>', null);
  }
  function exportReport() {
    openDialog('Export notebooks', '<p class="form-hint">Download a ZIP with one Markdown file per host and its screenshot attachments. Extract it into an Obsidian vault or any local folder.</p><label class="settings-row"><input name="secrets" type="checkbox"><span><strong>Include dedicated credential secret fields</strong><small>Notes, commands, and screenshots are preserved as written and may contain secrets.</small></span></label>', data => {download(safeFilename(w.name) + '-notebooks.zip', N.zip(N.markdownFiles(w, data.has('secrets'))), 'application/zip'); closeDialog(); toast('Notebooks and screenshots exported. JSON backups restore the complete workspace.');}, 'Export Markdown + images');
  }
  function showScan(id, offset = 0, term = '') {
    const scan = w.scans.find(s => s.id === id); if (!scan) return;
    const start = Math.max(0, offset - 500), preview = scan.raw.slice(start, start + 200000);
    openDialog(scan.name, '<p class="form-hint">Original scan imported ' + esc(date(scan.imported)) + '. Showing from line ' + scan.raw.slice(0, start).split('\\n').length + (scan.raw.length > preview.length ? ' · download for the complete file.' : '.') + '</p><pre class="code-block" style="max-height:45vh">' + highlighted(preview, term) + '</pre>', () => {download(safeFilename(scan.name), scan.raw, 'text/plain');}, 'Download original', 'SCAN EVIDENCE');
  }
  async function importScans(files) {
    if (importBusy) return;
    if (!files.length) return;
    if (files.length > 30) {toast('Import up to 30 scan files at a time.'); return;}
    if ($('dialog').open) closeDialog();
    importBusy = true; $('import-btn').disabled = true; $('save-status').textContent = 'Reading scan files locally…';
    const results = []; let changedAny = false;
    try {
      for (const file of files) {
        try {
          if (file.size > 20 * 1024 * 1024) throw new Error('File exceeds the 20 MB per-scan limit. Split the scan into smaller files.');
          const raw = await file.text();
          if (w.scans.some(s => s.name === file.name && s.raw === raw)) {results.push({name: file.name, message: 'Already imported; unchanged file skipped.'}); continue;}
          const parsed = C.parseScan(raw), next = C.clone(w), stats = C.mergeScan(next, parsed, file.name, raw);
          if (next.nodes.length > 20000) throw new Error('Import would exceed 20,000 nodes. Use a separate workspace.');
          checkSize(next);
          if (!changedAny) remember(); w = next; changedAny = true;
          results.push({name: file.name, message: stats.hosts + ' new hosts · ' + stats.services + ' new services · ' + stats.updated + ' service updates' + (stats.omitted ? ' · ' + stats.omitted + ' non-open ports kept only in source' : '')});
        } catch (e) {results.push({name: file.name, message: e.message, failed: true});}
      }
      if (changedAny) {closeSearch(); activeHost ||= hosts()[0]?.id || ''; view = 'map'; selected = ''; workspaceCollapsed = true; scope = ''; search = ''; $('search').value = ''; kinds = new Set(C.KINDS); changed('', true);} else persist();
      openDialog('Import results', results.map(r => '<div class="import-result ' + (r.failed ? 'failed' : '') + '"><strong>' + (r.failed ? '× ' : '✓ ') + esc(r.name) + '</strong><p>' + esc(r.message) + '</p></div>').join('') + '<p class="form-hint" style="margin-top:18px">Original scans are preserved in Activity & imports and included in JSON backups. Open|filtered is an uncertain port state, not confirmed service availability.</p>', null);
    } finally {importBusy = false; $('import-btn').disabled = false; $('scan-input').value = '';}
  }
  async function copy(value) {
    if (!value) {toast('Nothing to copy.'); return;}
    try {await navigator.clipboard.writeText(value); toast('Copied to clipboard.');}
    catch {
      const input = document.createElement('textarea'); input.value = value; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select();
      const ok = document.execCommand('copy'); input.remove(); toast(ok ? 'Copied to clipboard.' : 'Clipboard unavailable. Select and copy the revealed text manually.');
    }
  }
  $('scan-input').addEventListener('change', e => importScans([...e.target.files]));
  $('backup-input').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {const next = C.validate(JSON.parse(await file.text())); replaceWorkspace(next, 'Restored workspace: ' + next.name);}
    catch (error) {openDialog('Could not open backup', '<p class="form-hint">' + esc(error.message) + '</p><p class="form-hint">Your current workspace has not been changed.</p>', null);}
    finally {e.target.value = '';}
  });
  $('search').addEventListener('input', e => {query = e.target.value; renderSearch();});
  $('scope').addEventListener('change', e => {scope = e.target.value; render(true);});
  document.addEventListener('change', e => {
    if (e.target.dataset.task) {
      const task = taskByKey(e.target.dataset.task); if (!task) return;
      remember(); N.toggleTask(w, task, e.target.checked); changed(e.target.checked ? 'Completed a notebook task.' : 'Reopened a notebook task.'); return;
    }
    const host = e.target.dataset.checkHost;
    if (host) {const n = find(host); remember(); n.checks ||= []; if (e.target.checked) n.checks = [...new Set([...n.checks, e.target.dataset.check])]; else n.checks = n.checks.filter(c => c !== e.target.dataset.check); n.updated = C.now(); changed(n.title + ': ' + e.target.dataset.check + (e.target.checked ? ' completed.' : ' reopened.'));}
    if (e.target.dataset.stage) {const n = find(e.target.dataset.stage); remember(); n.status = e.target.value; n.updated = C.now(); changed(n.title + ' stage → ' + n.status);}
  });
  document.addEventListener('click', async e => {
    const b = e.target.closest('button, [data-select], [data-link]'); if (!b) return;
    const d = b.dataset;
    if (d.tab) {notebookTab = d.tab; renderNotebook();}
    else if ('result' in d) jumpResult(Number(d.result));
    else if (d.evidence) {const n = find(d.evidence); openNotebook(N.hostOf(n), n.id, n.notes ? 'notes' : 'command');}
    else if (d.taskSource) {const t = taskByKey(d.taskSource); if (t) {const n = find(t.nodeId); openNotebook(t.hostId, t.nodeId, t.field, {start: t.marker - 1, end: t.marker + t.text.length + 3});}}
    else if (d.pinTask) {const t = taskByKey(d.pinTask); if (t) {remember(); const key = t.hostId || 'inbox', pinned = N.pinned(w, t.hostId); if (pinned && taskKey(pinned) === taskKey(t)) delete w.pinnedTasks[key]; else w.pinnedTasks[key] = {nodeId: t.nodeId, field: t.field, text: t.text, line: t.line}; changed('Updated pinned next step.');}}
    else if ('saveSuggestion' in d) {const s = suggestions[Number(d.saveSuggestion)], n = currentNote(); if (s && n) keepCredential(s, N.sourceRef(n, noteField, s.start, s.excerpt));}
    else if ('quickCredential' in d) quickCredential();
    else if (d.addReference) addReference(d.addReference);
    else if (d.copyUser) copy(find(d.copyUser).username);
    else if (d.revealCard) {const el = b.closest('.credential-card').querySelector('.credential-secret'), revealed = b.textContent === 'Hide'; el.textContent = revealed ? '••••••••••••' : find(d.revealCard).secret || 'Username only'; b.textContent = revealed ? 'Reveal' : 'Hide';}
    else if (d.credentialSource) {const n = find(d.credentialSource); if (n.sourceRef) jumpSource(n.sourceRef); else {selected = n.id; render();}}
    else if (d.imageDownload) {const img = currentNote()?.images?.find(i => i.id === d.imageDownload); if (img) {const [meta, data] = img.data.split(','); download(safeFilename(img.name), Uint8Array.from(atob(data), c => c.charCodeAt(0)), meta.slice(5).split(';')[0]);}}
    else if (d.imageDelete) {const n = currentNote(); confirmAction('Remove screenshot?', 'Remove this screenshot from the notebook? Undo can recover it during this session.', () => {remember(); n.images = n.images.filter(i => i.id !== d.imageDelete); changed('Removed notebook screenshot.');}, 'Remove screenshot');}
    else if (d.view) {closeSearch(); selected = ''; if (d.view === 'notebook') openNotebook(); else {view = d.view; scope = ''; render(true);}}

    else if (d.select) select(d.select);
    else if (d.add) {if (d.add === 'host') quickHost(); else nodeForm(d.add);}
    else if (d.edit) nodeForm('', d.edit);
    else if (d.delete) deleteNode(d.delete);
    else if (d.kind) {kinds.has(d.kind) ? kinds.delete(d.kind) : kinds.add(d.kind); render(true);}
    else if (d.formKind) nodeForm(d.formKind);
    else if (d.linkFrom) linkForm('', d.linkFrom);
    else if (d.link) linkForm(d.link);
    else if (d.deleteLink) {const link = w.links.find(x => x.id === d.deleteLink); remember(); w.links = w.links.filter(x => x.id !== d.deleteLink); closeDialog(); changed('Deleted relationship: ' + link.label);}
    else if (d.scan) showScan(d.scan);
    else if (d.reveal) {const el = $('secret-value'), revealed = b.textContent === 'Hide'; el.textContent = revealed ? '••••••••••••' : find(d.reveal).secret || 'No secret recorded'; b.textContent = revealed ? 'Reveal' : 'Hide';}
    else if (d.copySecret) copy(find(d.copySecret).secret);
    else if (d.copyCommand) copy(find(d.copyCommand).command);
    else if ('closeInspector' in d) {selected = ''; $('inspector').classList.remove('open'); render();}
    else switch (b.id) {
      case 'workspace-toggle': workspaceCollapsed = !workspaceCollapsed; render(true); break;
      case 'add-btn': openNotebook(); $('notebook-editor').focus(); break;
      case 'advanced-add': nodeForm(); break;
      case 'map-btn': closeSearch(); selected = ''; scope = ''; view = 'map'; render(true); break;
      case 'close-search': closeSearch(); break;
      case 'host-details': selected = activeHost; render(); break;
      case 'back-to-notes': openNotebook(); break;
      case 'mark-credential': quickCredential(true); break;
      case 'bookmark-note': bookmarkSelection(); break;
      case 'add-screenshot': $('image-input').click(); break;
      case 'link-btn': linkForm(); break;
      case 'import-btn': case 'welcome-import': $('scan-input').click(); break;
      case 'open-btn': case 'settings-open': $('backup-input').click(); break;
      case 'backup-btn': download(safeFilename(w.name) + '-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(w, null, 2)); dirty = false; $('last-backup').textContent = 'Backup downloaded ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}); toast('Full backup downloaded, including credentials and scans.'); break;
      case 'settings-btn': case 'workspace-name': settings(); break;
      case 'choose-folder':
        try {folderName = await FolderStorage.pick(); folderEnabled = true; persist(); toast('Folder autosave started · writing workspace.json to "' + folderName + '".'); settings();}
        catch (error) {toast(error.message);}
        break;
      case 'stop-folder': folderEnabled = false; FolderStorage.forget(); folderName = ''; $('folder-status').textContent = ''; toast('Folder autosave stopped.'); settings(); break;
      case 'new-workspace': replaceWorkspace(C.workspace(), 'Started a new workspace.'); break;
      case 'demo-btn': case 'settings-demo': replaceWorkspace(C.sample(), 'Loaded fictional example lab.'); break;
      case 'help-btn': help(); break;
      case 'report-btn': exportReport(); break;
      case 'close-dialog': case 'cancel-dialog': closeDialog(); break;
      case 'fit-btn': fit(); break;
      case 'zoom-in': zoom(.8); break;
      case 'zoom-out': zoom(1.25); break;
      case 'layout-btn': remember(); w.positions = {}; changed('Reset graph arrangement.', true); break;
      case 'clear-filters': scope = ''; search = ''; $('search').value = ''; render(true); break;
      case 'reset-map-filters': scope = ''; search = ''; $('search').value = ''; kinds = new Set(C.KINDS); render(true); break;
      case 'undo-btn': if (undo.length) {w = undo.pop(); selected = ''; activeNote = ''; editCheckpoint = false; dirty = true; persist(); render(true); toast('Last change undone.');} break;
    }
  });
  $('brand').addEventListener('click', e => {e.preventDefault(); closeSearch(); selected = ''; view = 'map'; scope = ''; search = ''; kinds = new Set(C.KINDS); render(true);});
  document.addEventListener('keydown', e => {
    if (!$('dialog').open && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {e.preventDefault(); $('search').focus(); $('search').select(); return;}
    if (!$('dialog').open && e.key === 'Escape' && query) {e.preventDefault(); closeSearch(); return;}
    if ($('dialog').open || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {e.preventDefault(); $('search').focus();}
    if (e.key === '?') help();
    if (e.key === 'Escape') {$('inspector').classList.remove('open'); selected = ''; render();}
  });
  let dragDepth = 0;
  document.addEventListener('dragenter', e => {if (Array.from(e.dataTransfer?.types || []).includes('Files')) {e.preventDefault(); dragDepth++; $('drop-overlay').hidden = false;}});
  document.addEventListener('dragleave', () => {dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-overlay').hidden = true;});
  document.addEventListener('dragover', e => {if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();});
  document.addEventListener('drop', e => {e.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true; const files = [...e.dataTransfer.files]; if (!files.length) return; if (files.every(f => f.type.startsWith('image/'))) attachImages(files); else importScans(files);});
  document.addEventListener('visibilitychange', () => {if (document.hidden && saveTimer) persist();});
  window.addEventListener('beforeunload', e => {if (saveTimer) persist(); if (dirty && !savedLocally) {e.preventDefault(); e.returnValue = '';}});
  window.addEventListener('resize', () => {if (view === 'map') fit();});
  render(true);
  document.body.dataset.ready = 'true';
  $('save-status').textContent = savedLocally ? 'Restored from this browser · unencrypted' : autosave ? 'Autosave on · this browser only · unencrypted' : 'Session only · save a backup to keep your work';
  if (restoreWarning) openDialog('Browser storage notice', '<p class="form-hint">' + esc(restoreWarning) + '</p>', null);
})();

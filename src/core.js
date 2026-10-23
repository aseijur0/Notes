(function (root) {
  'use strict';
  const KINDS = ['host', 'service', 'credential', 'finding', 'note'];
  const STAGES = ['Discovered', 'Enumerating', 'Foothold', 'Privileged', 'Documented'];
  const CHECKS = ['Initial enumeration', 'Service enumeration', 'Foothold obtained', 'Privilege escalation', 'Proof captured', 'Reproduction notes'];
  const uid = () => 'n-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  const now = () => new Date().toISOString();
  const clone = value => JSON.parse(JSON.stringify(value));
  function workspace(name = 'OSCP workspace') {
    return {format: 'oscp-map', version: 2, name, created: now(), updated: now(), nodes: [], links: [], scans: [], activity: [], positions: {}, pinnedTasks: {}};
  }
  function node(kind, fields = {}) {
    return {id: uid(), kind, title: '', hostId: '', notes: '', command: '', tasks: '', source: '', status: kind === 'host' ? 'Discovered' : 'Unverified', created: now(), updated: now(), ...fields};
  }
  function record(w, message) {
    w.updated = now();
    w.activity.unshift({id: uid(), time: w.updated, message});
    w.activity = w.activity.slice(0, 1000);
  }
  function parseText(text) {
    const hosts = [];
    let current = null, service = null;
    const getHost = (address, hostname = '') => {
      let h = hosts.find(x => x.address === address);
      if (!h) { h = {address, hostname, os: '', services: [], notes: ''}; hosts.push(h); }
      if (hostname) h.hostname = hostname;
      return h;
    };
    for (const line of text.split(/\r?\n/)) {
      let m;
      if ((m = line.match(/^Nmap scan report for (.+?)\s*$/))) {
        const part = m[1].match(/^(.*?)\s+\(([^)]+)\)$/);
        current = getHost(part ? part[2] : m[1], part ? part[1] : ''); service = null;
      } else if ((m = line.match(/^Host:\s+(\S+)\s+\(([^)]*)\)(.*)$/))) {
        current = getHost(m[1], m[2]); service = null;
        const ports = m[3].match(/Ports:\s*(.*?)(?:\t|$)/);
        if (ports) for (const part of ports[1].split(', ')) {
          const fields = part.trim().split('/');
          if (!/^\d+$/.test(fields[0]) || !['tcp', 'udp', 'sctp'].includes(fields[2])) continue;
          current.services.push({port: Number(fields[0]), protocol: fields[2], state: fields[1], name: fields[4] || '', version: fields.slice(6).join('/').replace(/\/$/, ''), scripts: ''});
        }
      } else if (current && (m = line.match(/^\s*(\d+)\/(tcp|udp|sctp)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/))) {
        service = {port: Number(m[1]), protocol: m[2], state: m[3], name: m[4], version: m[5] || '', scripts: ''};
        current.services.push(service);
      } else if (current && /^Host script results:/.test(line)) {
        service = null;
      } else if (current && /^\|/.test(line)) {
        if (service) service.scripts += line + '\n'; else current.notes += line + '\n';
      } else if (current && (m = line.match(/^(?:OS details|Aggressive OS guesses|Running):\s*(.*)/))) {
        current.os = m[1];
      }
    }
    if (!hosts.length) throw new Error('No Nmap hosts found. Import Nmap XML (-oX), normal output (-oN), or grepable output (-oG).');
    return hosts;
  }
  function parseXML(text) {
    if (/<!ENTITY\b/i.test(text)) throw new Error('XML entity declarations are not supported.');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'nmaprun') throw new Error('Invalid Nmap XML. Expected an nmaprun document.');
    const a = (el, attr) => el?.getAttribute(attr) || '';
    const scripts = el => Array.from(el.querySelectorAll('script')).map(s => a(s, 'id') + ': ' + a(s, 'output')).join('\n\n');
    const hosts = Array.from(doc.querySelectorAll('nmaprun > host')).map(h => {
      const addr = h.querySelector('address[addrtype="ipv4"]') || h.querySelector('address[addrtype="ipv6"]');
      const hostname = a(h.querySelector('hostname'), 'name');
      return {
        address: a(addr, 'addr') || hostname, hostname,
        os: a(h.querySelector('osmatch'), 'name'),
        notes: Array.from(h.querySelectorAll('hostscript')).map(scripts).join('\n'),
        services: Array.from(h.querySelectorAll('ports > port')).map(p => {
          const s = p.querySelector('service');
          return {port: Number(a(p, 'portid')), protocol: a(p, 'protocol'), state: a(p.querySelector('state'), 'state'), name: [a(s, 'tunnel'), a(s, 'name')].filter(Boolean).join('/'), version: ['product', 'version', 'extrainfo'].map(k => a(s, k)).filter(Boolean).join(' '), scripts: scripts(p)};
        })
      };
    }).filter(h => h.address);
    if (!hosts.length) throw new Error('This XML contains no addressable hosts.');
    return hosts;
  }
  function parseScan(text) { return text.trimStart().startsWith('<') ? parseXML(text) : parseText(text); }
  function mergeScan(w, hosts, filename, raw) {
    const scanId = uid(), stats = {hosts: 0, services: 0, updated: 0, omitted: 0};
    for (const h of hosts) {
      let host = w.nodes.find(n => n.kind === 'host' && n.address?.toLowerCase() === h.address.toLowerCase());
      if (!host) {
        host = node('host', {title: h.hostname || h.address, address: h.address, hostname: h.hostname, os: h.os, checks: [], notes: h.notes, source: filename});
        w.nodes.push(host); stats.hosts++;
      } else {
        if (!host.os) host.os = h.os;
        if (!host.hostname) host.hostname = h.hostname;
        if (h.notes && !host.notes.includes(h.notes)) host.notes += (host.notes ? '\n\n' : '') + h.notes;
      }
      host.scanIds = [...new Set([...(host.scanIds || []), scanId])];
      host.updated = now();
      for (const s of h.services) {
        if (!Number.isInteger(s.port) || s.port < 0 || s.port > 65535 || !['tcp', 'udp', 'sctp'].includes(s.protocol)) continue;
        const existing = w.nodes.find(n => n.kind === 'service' && n.hostId === host.id && n.port === s.port && n.protocol === s.protocol);
        if (s.state !== 'open' && s.state !== 'open|filtered' && !existing) {stats.omitted++; continue;}
        if (existing) {
          Object.assign(existing, {state: s.state, service: s.name || existing.service, version: s.version || existing.version, updated: now()});
          existing.title = existing.port + '/' + existing.protocol + (existing.service ? ' · ' + existing.service : '');
          if (s.scripts && !existing.notes.includes(s.scripts)) existing.notes += (existing.notes ? '\n\n' : '') + s.scripts;
          existing.scanIds = [...new Set([...(existing.scanIds || []), scanId])]; stats.updated++;
        } else {
          w.nodes.push(node('service', {title: s.port + '/' + s.protocol + (s.name ? ' · ' + s.name : ''), hostId: host.id, port: s.port, protocol: s.protocol, service: s.name, version: s.version, state: s.state, notes: s.scripts, scanIds: [scanId], source: filename})); stats.services++;
        }
      }
    }
    w.scans.push({id: scanId, name: filename, imported: now(), raw, stats});
    record(w, 'Imported ' + filename + ': ' + stats.hosts + ' new hosts, ' + stats.services + ' new services, ' + stats.updated + ' updated.');
    return stats;
  }
  function validate(input) {
    const bad = message => {throw new Error('Invalid workspace: ' + message);};
    if (!input || input.format !== 'oscp-map' || ![1, 2].includes(input.version)) bad('unsupported format or version.');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) bad('name is missing or too long.');
    for (const key of ['nodes', 'links', 'scans', 'activity']) if (!Array.isArray(input[key])) bad(key + ' must be a list.');
    if (input.nodes.length > 20000 || input.links.length > 40000) bad('workspace exceeds the supported size.');
    const ids = new Set();
    const stringFields = ['title', 'hostId', 'notes', 'command', 'tasks', 'source', 'status', 'address', 'hostname', 'os', 'username', 'secret', 'domain', 'secretType', 'service', 'protocol', 'version', 'state', 'priority', 'created', 'updated'];
    for (const n of input.nodes) {
      if (!n || typeof n.id !== 'string' || !/^n-[a-zA-Z0-9-]+$/.test(n.id) || ids.has(n.id)) bad('duplicate or invalid node ID.');
      if (!KINDS.includes(n.kind) || typeof n.title !== 'string') bad('unknown node type or missing title.');
      ids.add(n.id);
      for (const key of stringFields) if (n[key] !== undefined && typeof n[key] !== 'string') bad('invalid ' + key + ' field.');
      if (n.kind === 'host' && (typeof n.address !== 'string' || !n.address.trim())) bad('host address missing.');
      if (n.kind === 'host' && !STAGES.includes(n.status)) bad('unknown host stage.');
      if (n.kind === 'service' && (!Number.isInteger(n.port) || n.port < 0 || n.port > 65535 || !['tcp', 'udp', 'sctp'].includes(n.protocol))) bad('invalid service port or protocol.');
      if (n.checks !== undefined && (!Array.isArray(n.checks) || n.checks.some(x => !CHECKS.includes(x)))) bad('invalid checklist.');
      if (n.scanIds !== undefined && (!Array.isArray(n.scanIds) || n.scanIds.some(x => typeof x !== 'string'))) bad('invalid scan references.');
      if (n.notebook !== undefined && (typeof n.notebook !== 'boolean' || n.kind !== 'note')) bad('invalid notebook.');
      if (n.images !== undefined) {
        if (!Array.isArray(n.images)) bad('invalid attachments.');
        const imageIds = new Set();
        for (const image of n.images) {
          if (!image || typeof image.id !== 'string' || !/^n-[a-zA-Z0-9-]+$/.test(image.id) || imageIds.has(image.id) || typeof image.name !== 'string' || typeof image.data !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.data)) bad('invalid image attachment.');
          imageIds.add(image.id);
        }
      }
      if (n.sourceRef !== undefined) {
        const r = n.sourceRef;
        if (!r || typeof r.nodeId !== 'string' || !/^n-[a-zA-Z0-9-]+$/.test(r.nodeId) || !['notes', 'command'].includes(r.field) || typeof r.excerpt !== 'string' || !Number.isInteger(r.start) || r.start < 0) bad('invalid evidence reference.');
      }
    }
    const hostIds = new Set(input.nodes.filter(n => n.kind === 'host').map(n => n.id));
    for (const n of input.nodes) {
      if (n.hostId && !hostIds.has(n.hostId)) bad('a record references a missing host.');
      if (n.kind === 'service' && !n.hostId) bad('a service must belong to a host.');
    }
    const linkIds = new Set();
    for (const e of input.links) {
      if (!e || typeof e.id !== 'string' || !/^n-[a-zA-Z0-9-]+$/.test(e.id) || linkIds.has(e.id) || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to || typeof e.label !== 'string' || !['lead', 'confirmed'].includes(e.status)) bad('invalid relationship.');
      linkIds.add(e.id);
    }
    const scanIds = new Set();
    for (const s of input.scans) {
      if (!s || typeof s.id !== 'string' || !/^n-[a-zA-Z0-9-]+$/.test(s.id) || scanIds.has(s.id) || typeof s.raw !== 'string' || typeof s.name !== 'string' || typeof s.imported !== 'string') bad('invalid scan.');
      scanIds.add(s.id);
    }
    for (const n of input.nodes) if (n.scanIds?.some(id => !scanIds.has(id))) bad('missing source scan.');
    for (const a of input.activity) if (!a || typeof a.message !== 'string' || typeof a.time !== 'string') bad('invalid activity.');
    const w = clone(input);
    w.version = 2;
    w.pinnedTasks = {};
    for (const [host, ref] of Object.entries(input.pinnedTasks || {})) {
      if ((host !== 'inbox' && !hostIds.has(host)) || !ref || !ids.has(ref.nodeId) || !['notes', 'command'].includes(ref.field) || typeof ref.text !== 'string' || !Number.isInteger(ref.line) || ref.line < 0) bad('invalid pinned task.');
      w.pinnedTasks[host] = {nodeId: ref.nodeId, field: ref.field, text: ref.text, line: ref.line};
    }
    w.positions = {};
    for (const [id, p] of Object.entries(input.positions || {})) if (ids.has(id) && p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e7 && Math.abs(p.y) < 1e7) w.positions[id] = {x: p.x, y: p.y};
    w.nodes.forEach(n => {n.notes ||= ''; n.command ||= ''; n.tasks ||= ''; n.source ||= ''; n.hostId ||= '';});
    return w;
  }
  function remove(w, id) {
    const n = w.nodes.find(x => x.id === id);
    if (!n) return;
    const removed = new Set([id]);
    if (n.kind === 'host') w.nodes.filter(x => x.hostId === id && x.kind === 'service').forEach(x => removed.add(x.id));
    w.nodes = w.nodes.filter(x => !removed.has(x.id));
    w.nodes.forEach(x => {if (x.hostId === id) x.hostId = '';});
    for (const [key, ref] of Object.entries(w.pinnedTasks || {})) if (key === id || removed.has(ref.nodeId)) delete w.pinnedTasks[key];
    w.links = w.links.filter(e => !removed.has(e.from) && !removed.has(e.to));
    for (const key of removed) delete w.positions[key];
    record(w, 'Deleted ' + n.kind + ': ' + n.title);
  }
  function edges(w) {
    return [...w.nodes.filter(n => n.hostId).map(n => ({id: 'auto-' + n.id, from: n.hostId, to: n.id, label: n.kind === 'service' ? 'exposes' : 'recorded on', status: 'structural'})), ...w.links];
  }
  function layout(nodes, stored = {}) {
    const positions = {}, hosts = nodes.filter(n => n.kind === 'host');
    const hostIds = new Set(hosts.map(n => n.id));
    let y = 0;
    for (const host of [...hosts, null]) {
      const children = nodes.filter(n => n.kind !== 'host' && (host ? n.hostId === host.id : !hostIds.has(n.hostId)));
      if (!host && !children.length) continue;
      let height = 1;
      for (const [column, kinds] of [['1', ['service']], ['2', ['finding', 'note']], ['3', ['credential']]]) {
        const group = children.filter(n => kinds.includes(n.kind));
        height = Math.max(height, group.length);
        group.forEach((n, i) => {positions[n.id] = {x: Number(column) * 330, y: y + i * 112};});
      }
      if (host) positions[host.id] = {x: 0, y: y + (height - 1) * 56};
      y += height * 112 + 100;
    }
    for (const n of nodes) if (stored[n.id]) positions[n.id] = {...stored[n.id]};
    return positions;
  }
  function report(w, includeSecrets = false) {
    const safe = text => String(text || '').replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;').replace(/([\\`*_{}\[\]#!|])/g, '\\$1');
    const block = text => String(text || '').split('\n').map(l => '    ' + l).join('\n');
    const lines = ['# ' + safe(w.name), '', 'Exported: ' + now(), '', 'Credential secret fields: ' + (includeSecrets ? 'included' : 'omitted') + '. Notes and evidence are included verbatim; review before sharing.', ''];
    for (const h of [...w.nodes.filter(n => n.kind === 'host'), null]) {
      const nodes = w.nodes.filter(n => n.kind !== 'host' && (h ? n.hostId === h.id : !n.hostId));
      if (!h && !nodes.length) continue;
      lines.push('## ' + (h ? safe(h.title) + ' — ' + safe(h.address) : 'Unassigned discoveries'), '');
      if (h) {
        lines.push('Stage: ' + safe(h.status), '', 'OS: ' + safe(h.os || 'Unknown'), '', block(h.notes), '');
        if (h.command) lines.push('Commands / reproduction:', '', block(h.command), '');
        if (h.tasks) lines.push('Next steps:', '', block(h.tasks), '');
        for (const c of CHECKS) lines.push('- [' + (h.checks?.includes(c) ? 'x' : ' ') + '] ' + c);
        lines.push('');
      }
      for (const n of nodes) {
        lines.push('### ' + safe(n.kind) + ': ' + safe(n.title), '');
        if (n.kind === 'service') lines.push('Port: ' + n.port + '/' + n.protocol + ' · ' + safe(n.state), '', safe(n.version), '');
        if (n.kind === 'credential') {
          lines.push('Username: ' + safe(n.username), '', 'Domain: ' + safe(n.domain), '', 'Validation: ' + safe(n.status), '');
          if (includeSecrets) lines.push('Secret (' + safe(n.secretType) + '):', '', block(n.secret), '');
        }
        if (n.kind === 'finding') lines.push('Priority: ' + safe(n.priority) + ' · Status: ' + safe(n.status), '');
        if (n.source) lines.push('Source: ' + safe(n.source), '');
        if (n.notes) lines.push('Evidence / notes:', '', block(n.notes), '');
        if (n.command) lines.push('Commands / reproduction:', '', block(n.command), '');
        if (n.tasks) lines.push('Next steps:', '', block(n.tasks), '');
      }
    }
    if (w.links.length) lines.push('## Recorded relationships', '');
    for (const e of w.links) lines.push('- ' + safe(w.nodes.find(n => n.id === e.from)?.title) + ' → ' + safe(e.label) + ' → ' + safe(w.nodes.find(n => n.id === e.to)?.title) + ' (' + e.status + ')');
    return lines.join('\n');
  }
  function sample() {
    const w = workspace('Practice lab · example');
    const web = node('host', {title: 'WEB01', address: '192.0.2.10', hostname: 'web01.lab.test', os: 'Linux', status: 'Foothold', checks: CHECKS.slice(0, 3), notes: 'Fictional training data. A web server with an exposed application backup.'});
    const dc = node('host', {title: 'DC01', address: '192.0.2.20', hostname: 'dc01.lab.test', os: 'Windows Server', status: 'Enumerating', checks: CHECKS.slice(0, 1)});
    const ssh = node('service', {title: '22/tcp · ssh', hostId: web.id, port: 22, protocol: 'tcp', service: 'ssh', version: 'OpenSSH', state: 'open'});
    const http = node('service', {title: '80/tcp · http', hostId: web.id, port: 80, protocol: 'tcp', service: 'http', version: 'Apache httpd', state: 'open', notes: 'Application login and a public /backup/ directory.'});
    const smb = node('service', {title: '445/tcp · microsoft-ds', hostId: dc.id, port: 445, protocol: 'tcp', service: 'microsoft-ds', version: '', state: 'open'});
    const ldap = node('service', {title: '389/tcp · ldap', hostId: dc.id, port: 389, protocol: 'tcp', service: 'ldap', version: 'LAB.TEST', state: 'open'});
    const finding = node('finding', {title: 'Credentials in backup', hostId: web.id, priority: 'High', status: 'Confirmed', source: '/backup/app.conf', notes: 'The application configuration contained a service account credential. Capture the file and record how it was retrieved.'});
    const cred = node('credential', {title: 'svc_web', username: 'svc_web', secret: 'Example-only-password!', secretType: 'Password', domain: 'LAB', hostId: web.id, source: '/backup/app.conf', status: 'Unverified', notes: 'Example credential. The link to DC01 is a lead, not confirmed access.'});
    const note = node('note', {title: 'Check account scope', hostId: dc.id, notes: 'Determine whether svc_web is a local or domain account. Record the outcome before marking the relationship confirmed.'});
    w.nodes.push(web, dc, ssh, http, smb, ldap, finding, cred, note);
    w.links.push({id: uid(), from: http.id, to: finding.id, label: 'revealed', status: 'confirmed'}, {id: uid(), from: finding.id, to: cred.id, label: 'contains', status: 'confirmed'}, {id: uid(), from: cred.id, to: dc.id, label: 'possible account reuse', status: 'lead'});
    record(w, 'Loaded fictional practice lab.');
    return w;
  }
  const api = {KINDS, STAGES, CHECKS, uid, now, clone, workspace, node, record, parseText, parseXML, parseScan, mergeScan, validate, remove, edges, layout, report, sample};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OSCP = api;
})(globalThis);

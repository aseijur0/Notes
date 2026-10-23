(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./core') : root.OSCP;
  function notebook(w, hostId = '', create = false) {
    let n = w.nodes.find(n => n.notebook && n.hostId === hostId);
    if (!n && create) {n = C.node('note', {title: 'Notebook', hostId, notebook: true, images: []}); w.nodes.push(n);}
    return n;
  }
  function hostOf(n) {return n.kind === 'host' ? n.id : n.hostId || '';}
  function tasks(w, hostId = null) {
    const result = [];
    for (const n of w.nodes) {
      if (hostId !== null && hostOf(n) !== hostId) continue;
      for (const field of ['notes', 'command', 'tasks']) {
        let offset = 0, fence = '';
        String(n[field] || '').split('\n').forEach((line, lineNumber) => {
          const boundary = line.match(/^\s*(`{3,}|~{3,})/);
          if (boundary) {if (!fence) fence = boundary[1]; else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length) fence = '';}
          const m = !fence && !boundary && line.match(/^(\s*[-*]\s+\[)([ xX])(\]\s+)(.+?)\s*$/);
          if (m) result.push({nodeId: n.id, hostId: hostOf(n), field, line: lineNumber, text: m[4], done: m[2].toLowerCase() === 'x', marker: offset + m[1].length});
          offset += line.length + 1;
        });
      }
    }
    return result;
  }
  function resolveTask(w, ref) {
    return tasks(w).filter(t => t.nodeId === ref.nodeId && t.field === ref.field && t.text === ref.text).sort((a, b) => Math.abs(a.line - ref.line) - Math.abs(b.line - ref.line))[0];
  }
  function toggleTask(w, ref, done) {
    const t = resolveTask(w, ref); if (!t) return false;
    const n = w.nodes.find(n => n.id === t.nodeId), text = n[t.field];
    n[t.field] = text.slice(0, t.marker) + (done ? 'x' : ' ') + text.slice(t.marker + 1); n.updated = C.now();
    return true;
  }
  function pinned(w, hostId = '') {
    const ref = w.pinnedTasks?.[hostId || 'inbox'];
    const t = ref && resolveTask(w, ref); return t && !t.done ? t : null;
  }
  // Parse explicit named config fields only. Never interpret arbitrary prose as a password.
  function credentials(text) {
    const results = []; let groups = new Map(), offset = 0;
    function flush() {
      for (const g of groups.values()) if (g.username && g.secret !== undefined && g.secret !== '') results.push({domain: '', ...g, excerpt: text.slice(g.start, g.end)});
      groups = new Map();
    }
    for (const line of text.split('\n')) {
      if (!line.trim() || /^\s*(?:\[|[{}]|```)/.test(line)) flush();
      const m = line.match(/^\s*(?:export\s+)?["']?([A-Za-z][A-Za-z0-9_.-]*)["']?\s*[:=]\s*(.*?)\s*$/);
      if (m) {
        const key = m[1].toLowerCase().replace(/[.-]/g, '_'), keyMatch = key.match(/^(.*?)(?:_)?(username|user|password|passwd|pass|pwd|domain|realm)$/);
        if (keyMatch) {
          let value = m[2], prefix = keyMatch[1].replace(/_$/, ''), type = keyMatch[2];
          // JSON/config delimiters outside quotes may be removed; secret punctuation is retained.
          const quoted = value.match(/^(["'])([\s\S]*)\1\s*[,;]?\s*$/);
          if (quoted) value = quoted[2];
          else if (value.endsWith(',') && /^\s*"/.test(line)) value = value.slice(0, -1);
          const field = /^(user|username)$/.test(type) ? 'username' : /^(domain|realm)$/.test(type) ? 'domain' : 'secret';
          let g = groups.get(prefix);
          if (g && g[field] !== undefined) {flush(); g = null;}
          if (!g) {g = {start: offset, end: offset + line.length, prefix}; groups.set(prefix, g);}
          g[field] = value; g.end = offset + line.length;
        }
      }
      offset += line.length + 1;
    }
    flush(); return results;
  }
  function sourceRef(n, field = 'notes', start = 0, excerpt = n[field] || '') {return {nodeId: n.id, field, start, excerpt};}
  function locate(w, ref) {
    const n = w.nodes.find(n => n.id === ref.nodeId); if (!n) return {missing: true, text: ref.excerpt, start: 0};
    const text = n[ref.field] || '';
    if (text.slice(ref.start, ref.start + ref.excerpt.length) === ref.excerpt) return {n, text, start: ref.start};
    const start = text.indexOf(ref.excerpt);
    return {n, text: start < 0 ? ref.excerpt : text, start: start < 0 ? 0 : start, archived: start < 0};
  }
  // Detects addresses only; it never reassigns hostId, so a mention never silently moves a note.
  function references(w, text, excludeHostId = '') {
    const found = new Map();
    for (const m of String(text || '').matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      const host = w.nodes.find(n => n.kind === 'host' && n.address.toLowerCase() === m[0].toLowerCase());
      if (host && host.id !== excludeHostId && !found.has(host.id)) found.set(host.id, {hostId: host.id, address: host.address, title: host.title});
    }
    return [...found.values()];
  }
  function search(w, query, limit = 150) {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean); if (!terms.length) return [];
    const results = [];
    function add(text, meta) {
      if (!text || results.length >= limit) return;
      const lower = text.toLocaleLowerCase();
      if (!terms.every(t => lower.includes(t))) return;
      let start = lower.indexOf(terms[0]), covered = -1, count = 0;
      while (start >= 0 && results.length < limit && count < 20) {
        if (start > covered) {
          const line = text.slice(0, start).split('\n').length - 1;
          const from = Math.max(0, text.lastIndexOf('\n', start) + 1, start - 100), to = Math.min(text.length, start + 240);
          results.push({...meta, start, line, excerpt: text.slice(from, to), score: lower.trim() === query.toLowerCase().trim() ? 0 : 1});
          covered = to - 1; count++;
        }
        start = lower.indexOf(terms[0], start + terms[0].length);
      }
    }
    for (const n of w.nodes) {
      const meta = {nodeId: n.id, hostId: hostOf(n), title: n.title, kind: n.kind};
      add([n.title, n.address, n.hostname, n.service, n.version, n.username, n.domain, n.source, n.status].filter(Boolean).join(' · '), {...meta, field: 'identity'});
      for (const field of ['notes', 'command', 'tasks']) add(n[field], {...meta, field});
      for (const image of n.images || []) add(image.name, {...meta, field: 'image', imageId: image.id});
    }
    for (const s of w.scans) add(s.raw, {scanId: s.id, title: s.name, kind: 'scan', field: 'raw', hostId: ''});
    return results.sort((a, b) => a.score - b.score);
  }
  function markdownFiles(w, includeSecrets = false) {
    const enc = new TextEncoder(), files = [];
    const clean = s => String(s || '').replace(/[\r\n]/g, ' ').replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;');
    const block = text => {const ticks = '`'.repeat(Math.max(3, ...Array.from(String(text).matchAll(/`+/g), m => m[0].length + 1))); return ticks + '\n' + text + '\n' + ticks;};
    const index = ['# ' + clean(w.name), '', 'Notebook export. Original note text and screenshots may contain secrets.', ''];
    for (const h of [...w.nodes.filter(n => n.kind === 'host'), null]) {
      const hostId = h?.id || '', nodes = w.nodes.filter(n => n.kind !== 'host' && n.hostId === hostId);
      if (!h && !nodes.length) continue;
      const name = h ? (h.title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'host') + '-' + h.id : 'inbox';
      index.push('- [' + clean(h?.title || 'Inbox').replace(/[\[\]]/g, '') + '](hosts/' + name + '.md)');
      const lines = ['# ' + clean(h?.title || 'Inbox'), '', h ? 'Address: ' + clean(h.address) + '\n\nStage: ' + clean(h.status) : '', ''];
      const next = pinned(w, hostId); if (next) lines.push('Next: ' + clean(next.text), '');
      for (const n of [...(h ? [h] : []), ...nodes]) {
        lines.push('## ' + clean(n.notebook ? 'Notes' : n.title), '');
        if (n.kind === 'service') lines.push(clean(n.port + '/' + n.protocol + ' · ' + n.state + ' · ' + (n.version || '')), '');
        if (n.kind === 'credential') {
          lines.push('Username: ' + clean(n.username), '', 'Domain: ' + clean(n.domain), '', 'Validation: ' + clean(n.status), '');
          if (includeSecrets) lines.push('Secret:', '', block(n.secret || ''), '');
        }
        if (n.source) lines.push('Source: ' + clean(n.source), '');
        if (n.notes) lines.push(n.notes, '');
        if (n.command) lines.push(block(n.command), '');
        if (n.tasks) lines.push('**Next steps**', '', n.tasks, '');
        for (const img of n.images || []) {
          const [, mime, b64] = img.data.match(/^data:image\/(png|jpeg|webp|gif);base64,(.*)$/);
          const filename = 'attachments/' + n.id + '-' + img.id + '.' + (mime === 'jpeg' ? 'jpg' : mime);
          files.push({name: filename, data: Uint8Array.from(atob(b64), c => c.charCodeAt(0))});
          lines.push('![' + clean(img.name).replace(/[\[\]]/g, '') + '](../' + filename + ')', '');
        }
      }
      files.push({name: 'hosts/' + name + '.md', data: enc.encode(lines.join('\n'))});
    }
    files.push({name: 'README.md', data: enc.encode(index.join('\n'))});
    files.push({name: 'investigation.md', data: enc.encode(C.report(w, includeSecrets))});
    return files;
  }
  // Small, uncompressed ZIP writer: portable Markdown + images, no runtime dependencies.
  function zip(files) {
    const parts = [], central = [], enc = new TextEncoder(); let offset = 0, centralSize = 0;
    function crc32(bytes) {let crc = -1; for (const byte of bytes) {crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));} return (crc ^ -1) >>> 0;}
    function header(size) {const data = new Uint8Array(size); return {data, v: new DataView(data.buffer)};}
    for (const file of files) {
      const name = enc.encode(file.name), data = file.data, crc = crc32(data), h = header(30 + name.length);
      h.v.setUint32(0, 0x04034b50, true); h.v.setUint16(4, 20, true); h.v.setUint16(6, 0x800, true); h.v.setUint32(14, crc, true); h.v.setUint32(18, data.length, true); h.v.setUint32(22, data.length, true); h.v.setUint16(26, name.length, true); h.data.set(name, 30);
      parts.push(h.data, data);
      const c = header(46 + name.length); c.v.setUint32(0, 0x02014b50, true); c.v.setUint16(4, 20, true); c.v.setUint16(6, 20, true); c.v.setUint16(8, 0x800, true); c.v.setUint32(16, crc, true); c.v.setUint32(20, data.length, true); c.v.setUint32(24, data.length, true); c.v.setUint16(28, name.length, true); c.v.setUint32(42, offset, true); c.data.set(name, 46);
      central.push(c.data); centralSize += c.data.length; offset += h.data.length + data.length;
    }
    const end = header(22); end.v.setUint32(0, 0x06054b50, true); end.v.setUint16(8, files.length, true); end.v.setUint16(10, files.length, true); end.v.setUint32(12, centralSize, true); end.v.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.data], {type: 'application/zip'});
  }
  const api = {notebook, hostOf, tasks, resolveTask, toggleTask, pinned, credentials, sourceRef, locate, references, search, markdownFiles, zip};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Notebook = api;
})(globalThis);

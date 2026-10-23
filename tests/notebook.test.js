'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const C = require('../src/core'), N = require('../src/notebook');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1cAAAAASUVORK5CYII=';
test('legacy workspaces migrate without losing notes, scans or credentials', () => {
  const original = C.sample(); original.version = 1; delete original.pinnedTasks;
  const restored = C.validate(C.clone(original));
  assert.equal(restored.version, 2); assert.deepEqual(restored.nodes, original.nodes); assert.deepEqual(restored.links, original.links); assert.deepEqual(restored.pinnedTasks, {});
});
test('each host and inbox gets a stable notebook without rewriting existing findings', () => {
  const w = C.sample(), before = C.clone(w.nodes), host = w.nodes[0].id;
  assert.equal(N.notebook(w, host), undefined);
  const n = N.notebook(w, host, true); assert.equal(N.notebook(w, host, true), n);
  assert.notEqual(N.notebook(w, '', true).id, n.id);
  assert.deepEqual(w.nodes.slice(0, before.length), before);
});
test('tasks come from actual checkbox lines, not fenced output', () => {
  const w = C.workspace(), n = N.notebook(w, '', true);
  n.notes = 'A heading\n- [ ] Inspect backup\n- [x] Read config\n```text\n- [ ] example only\n```\n* [ ] Check scope';
  const tasks = N.tasks(w); assert.deepEqual(tasks.map(t => t.text), ['Inspect backup', 'Read config', 'Check scope']);
  assert.equal(tasks[1].done, true); assert.equal(tasks[0].line, 1);
  N.toggleTask(w, tasks[0], true); assert.match(n.notes, /- \[x\] Inspect backup/);
  assert.match(n.notes, /- \[ \] example only/);
});
test('the notebook tasks field is scanned too, and a bare template line is never a phantom task', () => {
  const w = C.workspace(), n = N.notebook(w, '', true);
  n.tasks = '- [ ] ';
  assert.equal(N.tasks(w).length, 0);
  n.tasks = '- [ ] Check backup share';
  assert.deepEqual(N.tasks(w).map(t => t.text), ['Check backup share']);
  assert.equal(N.tasks(w)[0].field, 'tasks');
});
test('pinned next step follows inserted lines and disappears on completion', () => {
  const w = C.workspace(), n = N.notebook(w, '', true); n.notes = '- [ ] Inspect backup';
  const task = N.tasks(w)[0]; w.pinnedTasks.inbox = {nodeId: n.id, field: 'notes', line: task.line, text: task.text};
  n.notes = 'New observation\n\n' + n.notes;
  assert.equal(N.pinned(w).line, 2); assert.ok(N.toggleTask(w, task, true)); assert.equal(N.pinned(w), null);
  C.validate(w);
});
test('credential extraction handles field order, realm, prefixes and quoted punctuation', () => {
  const text = 'DB_PASSWORD=" pa:ss!; "\nDB_USER=svc_web\nDB_DOMAIN=LAB\nAPI_USER=api\nAPI_PASSWORD=other';
  const rows = N.credentials(text);
  assert.equal(rows.length, 2); assert.equal(rows[0].username, 'svc_web'); assert.equal(rows[0].secret, ' pa:ss!; '); assert.equal(rows[0].domain, 'LAB');
  assert.equal(rows[1].username, 'api'); assert.equal(text.slice(rows[0].start, rows[0].end), rows[0].excerpt);
});
test('credential extraction never pairs different prefixes or paragraphs', () => {
  assert.equal(N.credentials('DB_USER=alice\nAPI_PASSWORD=secret').length, 0);
  assert.equal(N.credentials('USER=alice\n\nPASSWORD=secret').length, 0);
  assert.equal(N.credentials('alice:secret\nTry the password from the previous host.').length, 0);
  assert.equal(N.credentials('[one]\nusername=alice\n[two]\npassword=secret').length, 0);
  assert.equal(N.credentials('"username": "alice",\n"password": "abc",')[0].secret, 'abc');
});
test('an IP address in notes becomes a reference suggestion, never a host move', () => {
  const w = C.sample(), web = w.nodes.find(n => n.kind === 'host' && n.title === 'WEB01'), dc = w.nodes.find(n => n.kind === 'host' && n.title === 'DC01');
  const refs = N.references(w, 'pivoted from ' + web.address + ' to ' + dc.address + ' and back to ' + dc.address, web.id);
  assert.deepEqual(refs, [{hostId: dc.id, address: dc.address, title: dc.title}]);
  assert.equal(N.references(w, '10.10.10.10 is unknown', web.id).length, 0);
});
test('source references relocate after edits and retain an archived snapshot', () => {
  const w = C.workspace(), n = N.notebook(w, '', true); n.notes = 'prefix\nUSER=alice\nPASSWORD=secret';
  const ref = N.sourceRef(n, 'notes', 7, 'USER=alice\nPASSWORD=secret');
  n.notes = 'new line\n' + n.notes; assert.equal(N.locate(w, ref).start, 16);
  n.notes = 'removed'; assert.equal(N.locate(w, ref).archived, true); assert.equal(N.locate(w, ref).text, ref.excerpt);
  w.nodes = []; assert.equal(N.locate(w, ref).missing, true);
});
test('search returns evidence offsets across notes, commands, scans and image names', () => {
  const w = C.sample(), host = w.nodes[0].id, n = N.notebook(w, host, true);
  n.notes = 'found svc_web\n' + 'padding\n'.repeat(80) + 'svc_web tested later'; n.command = 'id svc_web';
  n.images.push({id: C.uid(), name: 'svc_web-proof.png', data: png});
  w.scans.push({id: C.uid(), name: 'scan.txt', imported: C.now(), raw: 'script output svc_web'});
  const results = N.search(w, 'svc_web');
  assert.equal(results.filter(r => r.nodeId === n.id && r.field === 'notes').length, 2);
  assert.ok(results.some(r => r.field === 'command')); assert.ok(results.some(r => r.scanId)); assert.ok(results.some(r => r.field === 'image'));
  for (const r of results.filter(r => r.nodeId === n.id && r.field === 'notes')) assert.equal(n.notes.slice(r.start, r.start + 7), 'svc_web');
  assert.equal(N.search(w, w.nodes.find(n => n.kind === 'credential').secret).length, 0);
});
test('backup round trip includes attachments, evidence snapshots and pinned tasks', () => {
  const w = C.sample(), n = N.notebook(w, w.nodes[0].id, true); n.notes = '- [ ] Check scope'; n.images.push({id: C.uid(), name: 'proof.png', data: png});
  const t = N.tasks(w)[0]; w.pinnedTasks[t.hostId] = {nodeId: t.nodeId, field: t.field, text: t.text, line: t.line};
  w.nodes.find(n => n.kind === 'credential').sourceRef = N.sourceRef(n);
  assert.deepEqual(C.validate(JSON.parse(JSON.stringify(w))), w);
});
test('invalid attachment URLs, notebook flags and task references are rejected', () => {
  for (const mutate of [n => n.images.push({id: C.uid(), name: 'bad', data: 'https://example.com/track.png'}), n => {n.notebook = 'true';}, n => {n.sourceRef = {nodeId: 'bad', field: 'notes', start: 0, excerpt: 'x'};}]) {
    const w = C.workspace(), n = N.notebook(w, '', true); mutate(n); assert.throws(() => C.validate(w), /Invalid workspace/);
  }
});
test('deleting a host retains its notebook, image and source snapshot in Inbox', () => {
  const w = C.sample(), h = w.nodes[0], n = N.notebook(w, h.id, true); n.images.push({id: C.uid(), name: 'proof.png', data: png});
  C.remove(w, h.id); assert.equal(w.nodes.find(x => x.id === n.id).hostId, ''); assert.equal(n.images.length, 1); C.validate(w);
});
test('Markdown export includes real attachment paths and omits dedicated secrets by default', () => {
  const w = C.sample(), n = N.notebook(w, w.nodes[0].id, true); n.notes = '- [ ] Check scope\n\n**Observation**'; n.images.push({id: C.uid(), name: 'proof.png', data: png});
  const files = N.markdownFiles(w), text = files.filter(f => f.name.endsWith('.md')).map(f => new TextDecoder().decode(f.data)).join('\n');
  const image = files.find(f => f.name.startsWith('attachments/'));
  assert.ok(image); assert.ok(text.includes('../' + image.name)); assert.ok(text.includes('**Observation**')); assert.ok(text.includes('- [ ] Check scope'));
  assert.ok(!text.includes('Example-only-password!')); assert.ok(text.includes('possible account reuse'));
});
test('export produces a ZIP archive with notebook and attachment entries', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const bytes = Buffer.from(await N.zip([{name: 'hosts/lab.md', data: new TextEncoder().encode('# Lab\n- [ ] Check')}, {name: 'attachments/proof.png', data: Uint8Array.from(atob(png.split(',')[1]), c => c.charCodeAt(0))}]).arrayBuffer());
  assert.equal(bytes.readUInt32LE(0), 0x04034b50); assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  const archive = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oscp-zip-check-')), 'notebook.zip');
  fs.writeFileSync(archive, bytes); console.log('ZIP fixture for independent validation: ' + archive);
});

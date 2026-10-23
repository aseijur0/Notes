'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const C = require('../src/core');
const normal = `Starting Nmap 7.95
Nmap scan report for web.lab.test (192.0.2.10)
Host is up (0.01s latency).
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 9.2
80/tcp   open  http    Apache httpd 2.4
| http-title: Lab site
|_http-server-header: Apache
53/udp   open|filtered domain
443/tcp  closed https
OS details: Linux 5.x
Host script results:
|_clock-skew: 0s
Nmap scan report for 2001:db8::2
PORT STATE SERVICE
445/tcp open microsoft-ds
Nmap done: 2 IP addresses (2 hosts up) scanned in 3.0 seconds`;
test('normal output preserves versions, IPv6, uncertain states and script evidence', () => {
  const h = C.parseText(normal);
  assert.equal(h.length, 2); assert.equal(h[0].hostname, 'web.lab.test');
  assert.equal(h[0].services[0].version, 'OpenSSH 9.2');
  assert.match(h[0].services[1].scripts, /http-title/); assert.match(h[0].notes, /clock-skew/);
  assert.equal(h[0].services[2].state, 'open|filtered'); assert.equal(h[1].address, '2001:db8::2');
});
test('grepable output merges status and port lines', () => {
  const h = C.parseText('Host: 192.0.2.5 (mail.test)\tStatus: Up\nHost: 192.0.2.5 (mail.test)\tPorts: 25/open/tcp//smtp//Postfix smtpd/, 80/closed/tcp//http///\tIgnored State: filtered (998)');
  assert.equal(h.length, 1); assert.equal(h[0].services.length, 2); assert.equal(h[0].services[0].version, 'Postfix smtpd');
});
test('invalid plain text is rejected', () => assert.throws(() => C.parseText('hello world'), /No Nmap hosts/));
test('repeat scans deduplicate, preserve notes and update explicit state changes', () => {
  const w = C.workspace(); C.mergeScan(w, C.parseText(normal), 'scan.nmap', normal);
  const count = w.nodes.length, ssh = w.nodes.find(n => n.port === 22); ssh.notes = 'Manual note';
  assert.equal(w.nodes.filter(n => n.kind === 'service').length, 4);
  C.mergeScan(w, C.parseText(normal), 'second.nmap', normal);
  assert.equal(w.nodes.length, count); assert.equal(ssh.notes, 'Manual note'); assert.equal(ssh.scanIds.length, 2);
  C.mergeScan(w, C.parseText('Nmap scan report for 192.0.2.10\n22/tcp closed ssh'), 'closed.nmap', 'raw');
  assert.equal(ssh.state, 'closed'); assert.equal(ssh.version, 'OpenSSH 9.2');
  assert.equal(w.nodes.find(n => n.port === 80).state, 'open');
  assert.deepEqual(C.validate(JSON.parse(JSON.stringify(w))), w);
});
test('full backup round trip preserves secrets, links, raw scans and positions', () => {
  const w = C.sample(); C.mergeScan(w, C.parseText(normal), 'scan.nmap', normal);
  w.positions[w.nodes[0].id] = {x: -120, y: 210};
  assert.deepEqual(C.validate(JSON.parse(JSON.stringify(w))), w);
});
test('reject malformed or dangling workspace references before replacement', () => {
  assert.throws(() => C.validate({format: 'other', version: 1}), /unsupported/);
  for (const mutate of [w => w.nodes.push({...w.nodes[0]}), w => {w.nodes[0].checks = ['invented'];}, w => {w.links[0].to = 'missing';}, w => {w.nodes[2].hostId = 'missing';}, w => {w.nodes[2].port = 99999;}, w => {w.nodes[0].notes = {};}, w => {w.nodes[2].scanIds = ['missing'];}]) {
    const w = C.sample(); mutate(w); assert.throws(() => C.validate(w), /Invalid workspace/);
  }
});
test('deleting a host removes services, detaches discoveries, keeps original evidence', () => {
  const w = C.sample(), host = w.nodes.find(n => n.kind === 'host'), children = w.nodes.filter(n => n.hostId === host.id), credential = children.find(n => n.kind === 'credential');
  C.mergeScan(w, C.parseText(normal), 'source.nmap', normal); C.remove(w, host.id);
  assert.ok(!w.nodes.some(n => n.id === host.id || n.hostId === host.id));
  assert.equal(w.nodes.find(n => n.id === credential.id).hostId, '');
  assert.ok(!w.links.some(e => !w.nodes.some(n => n.id === e.from) || !w.nodes.some(n => n.id === e.to)));
  assert.equal(w.scans[0].raw, normal); C.validate(w);
});
test('report omits secret fields by default and includes independent evidence', () => {
  const w = C.sample(), credential = w.nodes.find(n => n.kind === 'credential');
  w.nodes[0].command = 'id\nwhoami';
  assert.ok(!C.report(w).includes(credential.secret)); assert.ok(C.report(w, true).includes(credential.secret));
  assert.match(C.report(w), /whoami/); assert.match(C.report(w), /possible account reuse/);
});
test('report keeps imported HTML and fence text inert', () => {
  const w = C.workspace('<script>bad</script>'); w.nodes.push(C.node('note', {title: '<img src=x>', notes: '```\n<script>alert(1)</script>\n```'}));
  const report = C.report(w); assert.ok(report.includes('&lt;script&gt;')); assert.ok(report.includes('    <script>'));
});
test('graph layout covers records without mutating saved positions', () => {
  const w = C.sample(); w.nodes.push(C.node('note', {title: 'Global'}));
  const saved = {[w.nodes[0].id]: {x: 4, y: 9}};
  const positions = C.layout(w.nodes, saved); assert.equal(Object.keys(positions).length, w.nodes.length);
  assert.deepEqual(positions[w.nodes[0].id], {x: 4, y: 9}); positions[w.nodes[0].id].x = 15; assert.equal(saved[w.nodes[0].id].x, 4);
});
test('hiding all host nodes still lays out their services and discoveries', () => {
  const nodes = C.sample().nodes.filter(n => n.kind !== 'host');
  const positions = C.layout(nodes);
  for (const n of nodes) assert.ok(Number.isFinite(positions[n.id]?.x) && Number.isFinite(positions[n.id]?.y));
});
test('every kind filter and single-host scope has complete graph coordinates', () => {
  const w = C.sample();
  for (let bits = 1; bits < 32; bits++) for (const scope of ['', ...w.nodes.filter(n => n.kind === 'host').map(n => n.id)]) {
    const nodes = w.nodes.filter(n => (bits & (1 << C.KINDS.indexOf(n.kind))) && (!scope || n.id === scope || n.hostId === scope));
    const positions = C.layout(nodes);
    assert.equal(Object.keys(positions).length, nodes.length);
    for (const p of Object.values(positions)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});
test('the bundled application is standalone and all fixed UI element IDs exist', () => {
  const fs = require('node:fs'), path = require('node:path');
  const shell = fs.readFileSync(path.join(__dirname, '../src/shell.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const all = shell + app;
  for (const match of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(all.includes('id="' + match[1] + '"'), 'Missing element: ' + match[1]);
  assert.ok(shell.includes("connect-src 'none'"));
  assert.ok(!/<script[^>]+src=|<link[^>]+href=|<iframe|<object/i.test(shell));
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/.test(app));
  const ids = [...shell.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]); assert.equal(new Set(ids).size, ids.length);
});

'use strict';
// Bundle the editable source into one portable HTML file. No dependencies.
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'src/shell.html'), 'utf8');
for (const [marker, name] of [['/* APP_CSS */', 'styles.css'], ['/* CORE_JS */', 'core.js'], ['/* NOTEBOOK_JS */', 'notebook.js'], ['/* STORAGE_JS */', 'storage.js'], ['/* APP_JS */', 'app.js']]) {
  let content = fs.readFileSync(path.join(root, 'src', name), 'utf8');
  if (name.endsWith('.js')) content = content.replace(/<\/script/gi, '<\\/script');
  html = html.replace(marker, () => content);
}
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('Built index.html (' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB).');

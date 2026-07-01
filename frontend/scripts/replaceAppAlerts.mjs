/**
 * One-off: replace window alert( with appAlert( and add import.
 * Run: node frontend/scripts/replaceAppAlerts.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(jsx|js)$/.test(name) && name !== 'appAlert.js') out.push(p);
  }
  return out;
}

function relImport(fromFile) {
  const dir = path.dirname(fromFile);
  let rel = path.relative(dir, path.join(srcDir, 'utils', 'appAlert.js'));
  rel = rel.replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel.replace(/\.js$/, '');
}

function processFile(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (!/\balert\s*\(/.test(text)) return false;
  if (/from\s+['"][^'"]*appAlert['"]/.test(text)) {
    text = text.replace(/\balert\s*\(/g, 'appAlert(');
    fs.writeFileSync(file, text);
    return true;
  }
  const imp = relImport(file);
  const importLine = `import { appAlert } from '${imp}';\n`;
  const lines = text.split('\n');
  let insertAt = 0;
  let i = 0;
  while (i < lines.length && /^\s*$/.test(lines[i])) i++;
  while (i < lines.length && /^import\s/.test(lines[i])) {
    insertAt = i + 1;
    i++;
  }
  lines.splice(insertAt, 0, importLine.replace(/\n$/, ''));
  text = lines.join('\n');
  text = text.replace(/\balert\s*\(/g, 'appAlert(');
  fs.writeFileSync(file, text);
  return true;
}

let n = 0;
for (const f of walk(srcDir)) {
  if (processFile(f)) {
    console.log('updated:', path.relative(srcDir, f));
    n++;
  }
}
console.log('Done, files updated:', n);

/**
 * Add TablePaginationSummary above paginated table containers.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith('.jsx')) acc.push(p);
  }
  return acc;
}

function extractProp(block, name) {
  const lines = block.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    const stringMatch = trimmed.match(new RegExp(`^${name}="([^"]+)"`));
    if (stringMatch) return { expr: `"${stringMatch[1]}"`, isString: true };
    const braceMatch = trimmed.match(new RegExp(`^${name}=\\{(.+)\\},?$`));
    if (braceMatch) return { expr: braceMatch[1].trim(), isString: false };
  }
  return null;
}

const TABLE_WRAPPER_RE =
  /<div\s*\n?\s*className="(?:overflow-x-auto rounded-lg|rounded-lg border border-gray-200 min-w-0 overflow-x-auto)"/g;

function findInsertPoint(content, paginationIndex) {
  const before = content.slice(0, paginationIndex);
  let lastMatch = null;
  let match;

  TABLE_WRAPPER_RE.lastIndex = 0;
  while ((match = TABLE_WRAPPER_RE.exec(before)) !== null) {
    const segment = before.slice(match.index, paginationIndex);
    if (segment.includes('<table')) {
      lastMatch = match;
    }
  }

  if (!lastMatch) return { insertAt: -1, indent: '        ' };

  const insertAt = content.lastIndexOf('\n', lastMatch.index - 1) + 1;
  const lineEnd = content.indexOf('\n', lastMatch.index);
  const line = content.slice(insertAt, lineEnd === -1 ? undefined : lineEnd);
  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '        ';

  return { insertAt, indent };
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('FixedTablePagination')) return { filePath, status: 'skip-no-pagination' };
  if (content.includes('TablePaginationSummary')) return { filePath, status: 'skip-already-has-summary' };

  content = content.replace(
    /import FixedTablePagination from (['"].+?FixedTablePagination['"]);/,
    'import FixedTablePagination, { TablePaginationSummary } from $1;'
  );

  const paginationMatch = content.match(/<FixedTablePagination\s+([\s\S]*?)\/>/);
  if (!paginationMatch) return { filePath, status: 'skip-no-match' };

  const paginationIndex = paginationMatch.index;
  const block = paginationMatch[1];

  const page = extractProp(block, 'page');
  const totalItems = extractProp(block, 'totalItems');
  const itemsPerPage = extractProp(block, 'itemsPerPage');
  const itemLabel = extractProp(block, 'itemLabel');

  if (!page || !totalItems || !itemsPerPage || !itemLabel) {
    return { filePath, status: 'skip-missing-props' };
  }

  const { insertAt, indent } = findInsertPoint(content, paginationIndex);
  if (insertAt < 0) return { filePath, status: 'skip-no-table-anchor' };

  const inner = `${indent}  `;

  const itemLabelAttr = itemLabel.isString
    ? `itemLabel=${itemLabel.expr}`
    : `itemLabel={${itemLabel.expr}}`;

  const summaryBlock = `${indent}{${totalItems.expr} > 0 && (
${inner}<TablePaginationSummary
${inner}  page={${page.expr}}
${inner}  totalItems={${totalItems.expr}}
${inner}  itemsPerPage={${itemsPerPage.expr}}
${inner}  ${itemLabelAttr}
${inner}  className="px-4 pt-4 pb-2"
${inner}/>
${indent})}
`;

  content = content.slice(0, insertAt) + summaryBlock + content.slice(insertAt);
  fs.writeFileSync(filePath, content, 'utf8');
  return { filePath, status: 'updated' };
}

const files = walk(path.join(root, 'pages'));
const results = files.map(processFile);
const updated = results.filter((r) => r.status === 'updated');
const failed = results.filter((r) => r.status.startsWith('skip-') && !['skip-no-pagination', 'skip-already-has-summary'].includes(r.status));

console.log(`Updated ${updated.length} files`);
updated.forEach((r) => console.log('  OK', path.relative(root, r.filePath)));
if (failed.length) {
  console.log('\nNeeds manual review:');
  failed.forEach((r) => console.log(' ', r.status, path.relative(root, r.filePath)));
}

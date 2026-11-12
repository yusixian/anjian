import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export function syncVersions(directory = root, check = false) {
  const read = (file) => fs.readFileSync(path.join(directory, file), 'utf8');
  const product = JSON.parse(read('package.json'));
  if (product.private !== true || JSON.parse(read('artifacts/package.json')).private !== true) {
    throw new Error('Product and application packages must remain private');
  }
  if (!/^\d+\.\d+\.\d+$/.test(product.version))
    throw new Error('Expected a stable product version');
  const updates = JSON.parse(read('.version-bump.json')).files.map(({ path: file, field }) => {
    const content = read(file);
    let current;
    let next;
    if (file.endsWith('.yaml') && field === 'version') {
      const match = content.match(/^version: ([^\n]+)$/m);
      if (!match) throw new Error(`Missing version: ${file}`);
      current = match[1].replaceAll(/['"]/g, '');
      next = content.replace(/^version: .+$/m, `version: ${product.version}`);
    } else {
      const value = JSON.parse(content);
      const keys = field.split('.');
      const owner = keys.slice(0, -1).reduce((node, key) => node[key], value);
      current = owner[keys.at(-1)];
      if (typeof current !== 'string') throw new Error(`Missing version: ${file}`);
      owner[keys.at(-1)] = product.version;
      next = `${JSON.stringify(value, null, 2)}\n`;
    }
    if (check && current !== product.version)
      throw new Error(`Version drift: ${file} (${current})`);
    return { file, current, next };
  });
  if (!check)
    for (const update of updates) {
      if (update.current !== product.version)
        fs.writeFileSync(path.join(directory, update.file), update.next);
    }
  return product.version;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!['--check', '--sync'].includes(process.argv[2]))
    throw new Error('Use --check or --sync; version comes from Changesets');
  console.info(syncVersions(root, process.argv[2] === '--check'));
}

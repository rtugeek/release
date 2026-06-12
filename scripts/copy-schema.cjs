const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'release.schema.json');
const dist = path.join(root, 'dist');
const dest = path.join(dist, 'release.schema.json');

if (!fs.existsSync(src)) {
  throw new Error(`Schema file not found: ${src}`);
}

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(src, dest);

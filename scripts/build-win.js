/**
 * Build Windows NSIS installer.
 * Loads .env so GH_PUBLISH_OWNER / GH_PUBLISH_REPO are baked into app-update.yml
 * (required for auto-updates even when you are not publishing yet).
 *
 * Usage:
 *   node scripts/build-win.js           → local dist only
 *   node scripts/build-win.js --publish → build + GitHub Release
 */
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const publish = process.argv.includes('--publish');
const owner = process.env.GH_PUBLISH_OWNER;
const repo = process.env.GH_PUBLISH_REPO;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

const missing = [];
if (!owner) missing.push('GH_PUBLISH_OWNER');
if (!repo) missing.push('GH_PUBLISH_REPO');
if (publish && !token) missing.push('GH_TOKEN (or GITHUB_TOKEN)');

if (missing.length) {
  console.error('Faltan variables de entorno:\n  - ' + missing.join('\n  - '));
  console.error('\nConfigúralas en .env (ver .env.example).');
  console.error('Sin owner/repo el instalador no sabrá dónde buscar actualizaciones.');
  process.exit(1);
}

process.env.GH_PUBLISH_OWNER = owner;
process.env.GH_PUBLISH_REPO = repo;
if (token) process.env.GH_TOKEN = token;

const args = ['electron-builder', '--win', '--config.win.signAndEditExecutable=false'];
if (publish) {
  args.push('--publish', 'always');
  console.log(`Build + publish → github.com/${owner}/${repo}`);
} else {
  args.push('--publish', 'never');
  console.log(`Build local (updates apuntarán a github.com/${owner}/${repo})`);
}

const result = spawnSync('npx', args, {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

process.exit(result.status == null ? 1 : result.status);

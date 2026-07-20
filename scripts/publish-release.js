/**
 * Build Windows installer and publish to GitHub Releases.
 * Usage: npm run release
 */
process.argv.push('--publish');
require('./build-win');

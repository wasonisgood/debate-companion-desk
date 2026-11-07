import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const scriptDir = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname));
const rootDir = path.resolve(scriptDir, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
const releaseConfig = JSON.parse(fs.readFileSync(path.join(scriptDir, 'release.json'), 'utf-8'));

const publishDir = path.join(scriptDir, 'publish');
if (!fs.existsSync(publishDir)) {
  fs.mkdirSync(publishDir, { recursive: true });
}

const releaseDir = path.join(rootDir, 'release');
let foundExe = null;

if (fs.existsSync(releaseDir)) {
  const files = fs.readdirSync(releaseDir);
  const setupFile = files.find(f => f.toLowerCase().includes('setup') && f.endsWith('.exe'));
  const anyExe = files.find(f => f.endsWith('.exe'));
  if (setupFile) {
    foundExe = path.join(releaseDir, setupFile);
  } else if (anyExe) {
    foundExe = path.join(releaseDir, anyExe);
  }
}

if (!foundExe && fs.existsSync(path.join(rootDir, releaseConfig.installerFileName))) {
  foundExe = path.join(rootDir, releaseConfig.installerFileName);
}

let fileSize = 0;
let sha256 = '';

if (foundExe) {
  const targetPath = path.join(rootDir, releaseConfig.installerFileName);
  fs.copyFileSync(foundExe, targetPath);
  fs.copyFileSync(foundExe, path.join(publishDir, releaseConfig.installerFileName));
  const buf = fs.readFileSync(targetPath);
  fileSize = buf.length;
  sha256 = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
  console.log(`Copied ${foundExe} -> ${targetPath} (${fileSize} bytes, SHA256: ${sha256})`);
} else {
  console.warn('No executable found in release/ or root');
}

const manifest = {
  version: pkg.version,
  minimumVersion: releaseConfig.minimumVersion,
  mandatory: Boolean(releaseConfig.mandatory),
  releaseDate: new Date().toISOString().split('T')[0],
  installerUrl: `https://github.com/${releaseConfig.githubRepo}/releases/download/v${pkg.version}/${releaseConfig.installerFileName}`,
  size: fileSize,
  sha256: sha256,
  notes: releaseConfig.notes
};

fs.writeFileSync(path.join(publishDir, 'latest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
console.log(`Successfully generated latest.json for version ${pkg.version}`);

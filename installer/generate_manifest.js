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

// Find installer or portable exe in root or release folder
const possibleExes = [
  path.join(rootDir, releaseConfig.installerFileName),
  path.join(rootDir, 'release', `${releaseConfig.productName} 1.0.0.exe`),
  path.join(rootDir, 'release', `${releaseConfig.productName}.exe`),
  path.join(rootDir, 'release', `DebateCompanion.exe`)
];

let targetExe = possibleExes.find(p => fs.existsSync(p));
let fileSize = 0;
let sha256 = '';

if (targetExe) {
  const fileBuf = fs.readFileSync(targetExe);
  fileSize = fileBuf.length;
  sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex').toLowerCase();
  fs.copyFileSync(targetExe, path.join(publishDir, releaseConfig.installerFileName));
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

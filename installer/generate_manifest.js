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

// 優先定位由 build_installer.ps1 編譯出之 C# WPF 原生客製化安裝精靈
const rootInstaller = path.join(rootDir, releaseConfig.installerFileName);
const scriptInstaller = path.join(scriptDir, releaseConfig.installerFileName);
const publishInstaller = path.join(publishDir, releaseConfig.installerFileName);

let foundExe = null;
if (fs.existsSync(rootInstaller)) {
  foundExe = rootInstaller;
} else if (fs.existsSync(scriptInstaller)) {
  foundExe = scriptInstaller;
} else if (fs.existsSync(publishInstaller)) {
  foundExe = publishInstaller;
}

let fileSize = 0;
let sha256 = '';

if (foundExe) {
  const buf = fs.readFileSync(foundExe);
  if (buf.includes(Buffer.from('Nullsoft'))) {
    throw new Error(`CRITICAL: Found installer ${foundExe} contains Nullsoft NSIS signature! Expected genuine WPF installer.`);
  }
  fileSize = buf.length;
  sha256 = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();

  // 確保根目錄、installer 目錄與 publish 目錄之安裝精靈一致
  if (foundExe !== rootInstaller) {
    fs.copyFileSync(foundExe, rootInstaller);
  }
  if (foundExe !== scriptInstaller) {
    fs.copyFileSync(foundExe, scriptInstaller);
  }
  if (foundExe !== publishInstaller) {
    fs.copyFileSync(foundExe, publishInstaller);
  }
  console.log(`Verified custom installer: ${foundExe} (${fileSize} bytes, SHA256: ${sha256})`);
} else {
  console.warn(`Installer ${releaseConfig.installerFileName} not found in root or installer directory.`);
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

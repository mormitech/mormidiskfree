// Writes the three winget manifest files for a release.
//   node scripts/make-winget-manifest.mjs [version] [outDir]
// The files go in microsoft/winget-pkgs under manifests/m/mormitech/mormidiskfree/<version>/ (submitted as a pull request).
// winget recognises the Inno Setup installer and runs it silently (/VERYSILENT /SUPPRESSMSGBOXES /NORESTART).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const version = process.argv[2] ?? JSON.parse(readFileSync(join(root, 'wails.json'), 'utf8')).info.productVersion;
const outDir = resolve(process.argv[3] ?? join(root, 'dist', 'winget', version));
const repo = 'mormitech/mormidiskfree';
const id = 'mormitech.mormidiskfree';
const schema = '1.12.0';

const url = `https://github.com/${repo}/releases/download/v${version}/mormidiskfree-setup-${version}-windows-x64.exe`;
const res = await fetch(url);
if (!res.ok) throw new Error(`${url}: HTTP ${res.status} (is the release published?)`);
const sha = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex').toUpperCase();

// winget-pkgs files start with a schema header; without it `winget validate` warns (and exits non-zero).
const header = (kind) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${kind}.${schema}.schema.json`;

const files = {
  [`${id}.yaml`]: `${header('version')}
PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${schema}
`,
  [`${id}.installer.yaml`]: `${header('installer')}
PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerLocale: en-US
InstallerType: inno
Scope: user
InstallModes:
- interactive
- silent
- silentWithProgress
UpgradeBehavior: install
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
- Architecture: x64
  InstallerUrl: ${url}
  InstallerSha256: ${sha}
ManifestType: installer
ManifestVersion: ${schema}
`,
  [`${id}.locale.en-US.yaml`]: `${header('defaultLocale')}
PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: mormitech
PublisherUrl: https://github.com/mormitech
PublisherSupportUrl: https://github.com/${repo}/issues
PackageName: mormiDiskFree
PackageUrl: https://github.com/${repo}
License: MIT
LicenseUrl: https://github.com/${repo}/blob/main/LICENSE
ShortDescription: Free disk space analyzer with an interactive sunburst chart.
Description: mormiDiskFree scans a folder or a whole disk and shows what takes up the space as an interactive sunburst chart. It shows the free space of the disk, keeps a basket of items to move to the Recycle Bin, and remembers its last scans so it reopens instantly. It makes no network connections.
Moniker: mormidiskfree
Tags:
- disk
- disk-space
- disk-usage
- storage
- analyzer
ReleaseNotesUrl: https://github.com/${repo}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: ${schema}
`,
};

mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(join(outDir, name), content);
console.log(`Wrote ${Object.keys(files).length} manifest files to ${outDir}`);

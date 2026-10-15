// SPDX-License-Identifier: GPL-2.0-only
// Copyright (c) Bambu Headless Bridge contributors
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const UPSTREAM_VERSION = '1.1.27';
export const PATCH_ID = 'x2d-dual-nozzle-exact-slicer-N0-and-banner-v2';
export const OFFICIAL_SOURCES = Object.freeze({
  temperature: 'https://github.com/bambulab/BambuStudio/blob/926a7192574bcb9b3a732e1ec59a46d79cb45466/src/libslic3r/GCode/WipeTower.cpp#L1254-L1278',
  banner: 'https://github.com/bambulab/BambuStudio/blob/926a7192574bcb9b3a732e1ec59a46d79cb45466/resources/profiles/BBL/machine/Bambu%20Lab%20X2D%200.4%20nozzle%20template%20change_filament_gcode.json#L4',
});
export const INSPECTOR_FILES = Object.freeze([
  Object.freeze({
    relative: 'src/safety/print-file.ts',
    original: 'e5980c9204293616f58d3454f83d5cc9883dfe21ef5f798b684d46da198c0065',
    anchor: "        const vendorWait=code==='M109' && ['a1','a1mini'].includes(model);",
    bannerAnchor: "      if(line==='========== record data ==========' && h2cStartup(index)) continue;",
    indent: '        ', bannerIndent: '      ', sourceTypes: true,
  }),
  Object.freeze({
    relative: 'dist/safety/print-file.js',
    original: '4e187a9c8ea41ea04607b9b9891bb7daf0c856ff50e71d397330838e05fde3c4',
    anchor: "                const vendorWait = code === 'M109' && ['a1', 'a1mini'].includes(model);",
    bannerAnchor: "            if (line === '========== record data ==========' && h2cStartup(index))",
    indent: '                ', bannerIndent: '            ', sourceTypes: false,
  }),
]);
export const THERMAL_FILES = Object.freeze([
  Object.freeze({ relative: 'src/safety/limits.ts', original: 'acd7e2a2c170d320d8efbb3207e77e73598e1c2d8b8de5e300b80d1969e6d1c3' }),
  Object.freeze({ relative: 'dist/safety/limits.js', original: '08d11576453bad4cf5003f43f29954d3660f0a6d61ff329057a253431b0796be' }),
]);
const modulePath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(modulePath), '../..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const backupName = relative => relative.replaceAll('/', '__') + '.' + UPSTREAM_VERSION + '.original';

const markerBody = [
  '// Local X2D compatibility: Bambu Studio 02.08.02.61 WipeTowerWriter',
  '// emits N0 as a slicer-origin marker, not a temperature. This marker',
  '// is untrusted and grants no thermal exception. The two nozzle count',
  '// below comes from consistent file metadata, never request options.',
  "if (args.has('N')) {",
  "  if (model !== 'x2d' || nozzleDiameters.length !== 2 ||",
  "      !['M104', 'M109'].includes(code) || args.size !== 3 ||",
  "      !args.has('T') || !args.has('S') || args.get('N') !== 0 ||",
  "      !Number.isInteger(args.get('T')) || ![0, 1].includes(args.get('T')) ||",
  '      !/(?:^|\\s)N0(?=\\s|$)/i.test(argumentsText))',
  "    fail('unsupported X2D slicer-origin temperature parameters');",
  "  args.delete('N');",
  '}',
];
const bannerBody = [
  '// Local X2D exact banner: the official filament-change template omits',
  '// its leading semicolon. Ignore only this entire non-executable literal.',
  "if (model === 'x2d' && nozzleDiameters.length === 2 && line === '======== X2D filament_change gcode ==========') continue;",
];
function descriptor(relative) {
  const file = INSPECTOR_FILES.find(candidate => candidate.relative === relative);
  if (!file) throw new Error('Unsupported compatibility target.');
  return file;
}
function assertOriginal(bytes, file) {
  if (sha256(bytes) !== file.original) throw new Error('Pinned upstream SHA-256 mismatch: ' + file.relative);
}

/** Pure transformation; only the byte-exact pinned upstream inspector is accepted. */
export function patchInspector(originalBytes, relative) {
  const file = descriptor(relative);
  assertOriginal(originalBytes, file);
  const text = Buffer.from(originalBytes).toString('utf8');
  if (text.split(file.anchor).length !== 2 || text.split(file.bannerAnchor).length !== 2)
    throw new Error('Expected compatibility anchors are not unique: ' + relative);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const typed = file.sourceTypes ? markerBody.map(line => line.replaceAll("args.get('T')", "args.get('T')!")) : markerBody;
  return Buffer.from(text
    .replace(file.anchor, typed.map(line => file.indent + line).join(newline) + newline + file.anchor)
    .replace(file.bannerAnchor, bannerBody.map(line => file.bannerIndent + line).join(newline) + newline + file.bannerAnchor), 'utf8');
}

/** Pure restoration; refuses modified backups and unknown current-file contents. */
export function restoreInspector(currentBytes, originalBackup, relative) {
  const file = descriptor(relative);
  assertOriginal(originalBackup, file);
  const currentHash = sha256(currentBytes);
  if (currentHash !== file.original && currentHash !== sha256(patchInspector(originalBackup, relative)))
    throw new Error('Unexpected local inspector edits; refusing to overwrite: ' + relative);
  return Buffer.from(originalBackup);
}

async function readOptional(file) {
  try { return await fs.readFile(file); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

/** Apply/restore only the pinned inspector. Does not import MCP, slice, or connect. */
export async function applyCompatibility({ root = defaultRoot, restore = false } = {}) {
  root = path.resolve(root);
  const packageRoot = path.join(root, 'node_modules', 'bambu-printer-mcp');
  const artifacts = path.join(root, 'artifacts', 'compatibility');
  const packageData = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (packageData.name !== 'bambu-printer-mcp' || packageData.version !== UPSTREAM_VERSION)
    throw new Error('X2D compatibility requires exactly bambu-printer-mcp ' + UPSTREAM_VERSION + '.');
  // Check, but never edit, independent temperature/material policies.
  for (const file of THERMAL_FILES) assertOriginal(await fs.readFile(path.join(packageRoot, file.relative)), file);
  const plans = [];
  for (const file of INSPECTOR_FILES) {
    const target = path.join(packageRoot, file.relative);
    const backup = path.join(artifacts, backupName(file.relative));
    const current = await fs.readFile(target);
    const saved = await readOptional(backup);
    if (saved) assertOriginal(saved, file);
    const original = sha256(current) === file.original ? current : saved;
    if (!original) throw new Error('Missing pinned upstream backup for a changed inspector: ' + file.relative);
    restoreInspector(current, original, file.relative); // Validate every target before writing either.
    const desired = restore ? Buffer.from(original) : patchInspector(original, file.relative);
    plans.push({ ...file, target, backup, current, originalBytes: original, desired });
  }
  await fs.mkdir(artifacts, { recursive: true });
  for (const plan of plans) {
    try { await fs.writeFile(plan.backup, plan.originalBytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    assertOriginal(await fs.readFile(plan.backup), plan);
  }
  // Recheck the complete plan after backup creation, before making any edits.
  for (const plan of plans)
    if (sha256(await fs.readFile(plan.target)) !== sha256(plan.current)) throw new Error('Inspector changed during patch planning; retry after stopping other editors.');
  const written = [];
  try {
    for (const plan of plans) {
      if (sha256(plan.current) === sha256(plan.desired)) continue;
      written.push(plan);
      await fs.writeFile(plan.target, plan.desired);
    }
  } catch (error) {
    for (const plan of written.reverse()) await fs.writeFile(plan.target, plan.current);
    throw error;
  }
  const receipt = {
    status: written.length ? (restore ? 'restored' : 'applied') : (restore ? 'already_restored' : 'already_applied'),
    upstream_package: 'bambu-printer-mcp', upstream_version: UPSTREAM_VERSION,
    patch_id: PATCH_ID, official_sources: OFFICIAL_SOURCES,
    thermal_files_unchanged: true, device_connections: false, reload_mcp_required: written.length > 0,
    files: plans.map(plan => ({ relative: plan.relative, original_sha256: plan.original,
      patched_sha256: sha256(patchInspector(plan.originalBytes, plan.relative)), current_sha256: sha256(plan.desired) })),
  };
  // Receipts intentionally contain relative paths and hashes only.
  await fs.writeFile(path.join(artifacts, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--restore')) {
    console.error('Usage: node scripts/compatibility/apply-x2d-compat.mjs [--restore]');
    process.exitCode = 64;
  } else {
    try { console.log(JSON.stringify(await applyCompatibility({ restore: args[0] === '--restore' }), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}

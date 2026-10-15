// SPDX-License-Identifier: GPL-2.0-only
// Copyright (c) Bambu Headless Bridge contributors
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  applyCompatibility, backupName, INSPECTOR_FILES, THERMAL_FILES,
  patchInspector, restoreInspector, sha256, UPSTREAM_VERSION,
} from '../scripts/compatibility/apply-x2d-compat.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installedPackage = path.join(root, 'node_modules', 'bambu-printer-mcp');
const banner = '======== X2D filament_change gcode ==========';

function raw(command, { model = 'X2D', nozzles = '0.4;0.4', materials = 'PLA;PLA' } = {}) {
  return ['; BambuStudio 02.08.02.61', '; printer_model = Bambu Lab ' + model,
    ...(nozzles === null ? [] : ['; nozzle_diameter = ' + nozzles]),
    '; filament_type = ' + materials, command, ''].join('\n');
}

test('Pinned X2D compatibility: reversible patch and synthetic G-code policy boundaries', async t => {
  const metadata = JSON.parse(await fs.readFile(path.join(installedPackage, 'package.json'), 'utf8'));
  assert.equal(metadata.version, UPSTREAM_VERSION, 'Run npm ci for the pinned dependency before tests.');
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  const sandbox = await fs.mkdtemp(path.join(root, 'artifacts', 'compatibility-tests-'));
  const packageRoot = path.join(sandbox, 'node_modules', 'bambu-printer-mcp');
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'bambu-printer-mcp', version: UPSTREAM_VERSION, type: 'module' }));
  const originals = new Map();
  for (const file of INSPECTOR_FILES) {
    const current = await fs.readFile(path.join(installedPackage, file.relative));
    const bytes = sha256(current) === file.original ? current : restoreInspector(current,
      await fs.readFile(path.join(root, 'artifacts', 'compatibility', backupName(file.relative))), file.relative);
    originals.set(file.relative, bytes);
    const destination = path.join(packageRoot, file.relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
  }
  for (const relative of [...THERMAL_FILES.map(file => file.relative), 'dist/safety/archive.js']) {
    const destination = path.join(packageRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(installedPackage, relative), destination);
  }

  await t.test('Pure source/runtime patches reject unknown bytes and restore exactly', () => {
    for (const file of INSPECTOR_FILES) {
      const original = originals.get(file.relative);
      const patched = patchInspector(original, file.relative);
      assert.deepEqual(restoreInspector(patched, original, file.relative), original);
      assert.deepEqual(restoreInspector(original, original, file.relative), original);
      assert.throws(() => patchInspector(Buffer.concat([original, Buffer.from('\n')]), file.relative), /SHA-256 mismatch/);
      assert.throws(() => restoreInspector(Buffer.concat([patched, Buffer.from('\n')]), original, file.relative), /Unexpected local inspector edits/);
      assert.throws(() => restoreInspector(patched, Buffer.from('invalid backup'), file.relative), /SHA-256 mismatch/);
    }
    assert.throws(() => patchInspector(Buffer.alloc(0), '../outside.js'), /Unsupported compatibility target/);
  });
  await t.test('Filesystem patch is idempotent and preserves unchanged thermal policies', async () => {
    assert.equal((await applyCompatibility({ root: sandbox })).status, 'applied');
    assert.equal((await applyCompatibility({ root: sandbox })).status, 'already_applied');
    for (const file of THERMAL_FILES) assert.equal(sha256(await fs.readFile(path.join(packageRoot, file.relative))), file.original);
    const receipt = await fs.readFile(path.join(sandbox, 'artifacts', 'compatibility', 'receipt.json'), 'utf8');
    assert.equal(receipt.includes(sandbox), false, 'Receipts must not record absolute local paths.');
    const source = await fs.readFile(path.join(packageRoot, INSPECTOR_FILES[0].relative), 'utf8');
    const runtime = await fs.readFile(path.join(packageRoot, INSPECTOR_FILES[1].relative), 'utf8');
    const marker = text => text.slice(text.indexOf('// Local X2D compatibility:'), text.indexOf('const vendorWait', text.indexOf('// Local X2D compatibility:')))
      .replaceAll("args.get('T')!", "args.get('T')").split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n');
    assert.equal(marker(source), marker(runtime));
  });

  const { inspectPrintFile } = await import(pathToFileURL(path.join(packageRoot, 'dist/safety/print-file.js')).href);
  let serial = 0;
  const inspect = async (command, options = {}, request = { model: 'x2d' }) => {
    const file = path.join(sandbox, 'synthetic-' + serial++ + '.gcode');
    await fs.writeFile(file, raw(command, options));
    return inspectPrintFile(file, request);
  };
  for (const code of ['M104', 'M109']) for (const tool of [0, 1]) {
    await t.test(`${code} accepts physical tool ${tool} with exact N0`, async () => {
      assert.equal((await inspect(`${code} T${tool} S220 N0`)).maxNozzleTemperature, 220);
    });
  }
  for (const [name, command] of [
    ['heater-off', 'M104 T1 S0 N0'], ['existing form', 'M104 T1 S220'],
    ['exact official banner', banner + '\nM104 T1 S220 N0'],
    ['trimmed/commented exact banner', '  ' + banner + ' ; ordinary comment\nM104 T1 S220 N0'],
  ]) await t.test('Accepts ' + name, async () => { await inspect(command); });

  const unsupported = /unsupported X2D slicer-origin temperature parameters/;
  const syntax = /unsupported G-code command syntax/;
  const rejected = [
    ['another machine', 'M104 T1 S220 N0', unsupported, { model: 'H2D' }, { model: 'h2d' }],
    ['N1', 'M104 T1 S220 N1', unsupported],
    ['negative N', 'M104 T1 S220 N-1', unsupported],
    ['fractional N', 'M104 T1 S220 N0.5', unsupported],
    ['signed zero', 'M104 T1 S220 N-0', unsupported],
    ['decimal zero', 'M104 T1 S220 N0.0', unsupported],
    ['plus zero', 'M104 T1 S220 N+0', unsupported],
    ['bare N', 'M104 T1 S220 N', /missing numeric N/],
    ['duplicate N', 'M104 T1 S220 N0 N0', /duplicate N/],
    ['fractional T', 'M104 T0.5 S220 N0', unsupported],
    ['tool 2', 'M104 T2 S220 N0', unsupported],
    ['negative tool', 'M104 T-1 S220 N0', unsupported],
    ['missing S', 'M104 T1 N0', unsupported],
    ['missing T', 'M104 S220 N0', unsupported],
    ['extra flag', 'M104 T1 S220 N0 A', unsupported],
    ['extra R', 'M104 T1 S220 N0 R230', unsupported],
    ['extra unknown parameter', 'M104 T1 S220 N0 P1', unsupported],
    ['bed marker', 'M140 T1 S60 N0', unsupported],
    ['chamber marker', 'M141 T1 S40 N0', unsupported],
    ['wait with N1', 'M109 T1 S220 N1', unsupported],
    ['one declared nozzle', 'M104 T0 S220 N0', unsupported, { nozzles: '0.4' }],
    ['three declared nozzles', 'M104 T0 S220 N0', unsupported, { nozzles: '0.4;0.4;0.4' }],
    ['request cannot supply absent metadata', 'M104 T0 S220 N0', /missing nozzle diameter metadata/,
      { nozzles: null }, { model: 'x2d', nozzleDiameters: [0.4, 0.4] }],
    ['request cannot replace metadata', 'M104 T0 S220 N0', /contradict the requested nozzle diameters/,
      { nozzles: '0.4' }, { model: 'x2d', nozzleDiameters: [0.4, 0.4] }],
    ['nozzle hardware limit', 'M104 T1 S301 N0', /exceeds the 300 C hardware limit/],
    ['PLA material limit', 'M104 T1 S261 N0', /exceeds the independent 260 C material policy limit/],
    ['negative temperature', 'M104 T1 S-1 N0', /temperature must be a finite nonnegative number/],
    ['all materials constrain heater', 'M104 T1 S270 N0', /PLA nozzle temperature 270 C exceeds/, { materials: 'PETG;PLA' }],
    ['bed hardware limit', 'M140 S121', /exceeds the 120 C hardware limit/],
    ['chamber hardware limit', 'M141 S66', /exceeds the 65 C hardware limit/],
    ['banner on another model', banner + '\nM104 T1 S220', syntax, { model: 'H2D' }, { model: 'h2d' }],
    ['banner with one nozzle', banner + '\nM104 S220', syntax, { nozzles: '0.4' }],
    ['banner with three nozzles', banner + '\nM104 S220', syntax, { nozzles: '0.4;0.4;0.4' }],
    ['banner variant', banner.replace('filament_change', 'filament_changeX') + '\nM104 S220', syntax],
    ['banner extra equal sign', banner + '=\nM104 S220', syntax],
    ['banner followed by heat command', banner + ' M104 S999\nM104 S220', syntax],
    ['banner followed by motion command', banner + ' G1 X0 Y0\nM104 S220', syntax],
  ];
  for (const [name, command, expected, options, request] of rejected)
    await t.test('Rejects ' + name, async () => { await assert.rejects(inspect(command, options, request), expected); });

  await t.test('Restoration, version, hash and backup guards fail closed', async () => {
    const file = INSPECTOR_FILES[1];
    const target = path.join(packageRoot, file.relative);
    const knownPatched = await fs.readFile(target);
    await fs.appendFile(target, '\n// unexpected local edit');
    await assert.rejects(applyCompatibility({ root: sandbox, restore: true }), /Unexpected local inspector edits/);
    await fs.writeFile(target, knownPatched);
    const backup = path.join(sandbox, 'artifacts', 'compatibility', backupName(file.relative));
    await fs.writeFile(backup, 'bad backup');
    await assert.rejects(applyCompatibility({ root: sandbox }), /SHA-256 mismatch/);
    await fs.writeFile(backup, originals.get(file.relative));
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'bambu-printer-mcp', version: '1.1.28' }));
    await assert.rejects(applyCompatibility({ root: sandbox }), /requires exactly/);
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'bambu-printer-mcp', version: UPSTREAM_VERSION, type: 'module' }));
    assert.equal((await applyCompatibility({ root: sandbox, restore: true })).status, 'restored');
    assert.equal((await applyCompatibility({ root: sandbox, restore: true })).status, 'already_restored');
    for (const descriptor of INSPECTOR_FILES)
      assert.equal(sha256(await fs.readFile(path.join(packageRoot, descriptor.relative))), descriptor.original);
    const thermal = path.join(packageRoot, THERMAL_FILES[1].relative);
    await fs.appendFile(thermal, '\n// unexpected policy edit');
    await assert.rejects(applyCompatibility({ root: sandbox }), /SHA-256 mismatch/);
  });
});

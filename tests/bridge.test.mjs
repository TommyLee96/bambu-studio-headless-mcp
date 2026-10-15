// SPDX-License-Identifier: GPL-2.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OFFLINE_TOOLS, filterTools, forwardTool } from '../scripts/lib/bridge.mjs';
import { offlineEnvironment } from '../scripts/lib/config.mjs';

test('discovery and direct calls both enforce the offline allowlist', async () => {
  const tools = filterTools([...OFFLINE_TOOLS.map(name => ({ name })), { name: 'print_file' }, { name: 'set_temperature' }]);
  assert.equal(tools.length, 14);
  let called = false;
  const client = { callTool() { called = true; } };
  for (const name of ['print_file', 'set_temperature', 'camera_snapshot', 'get_printer_status', 'unknown']) {
    await assert.rejects(forwardTool(client, { name }, '.'), /offline bridge/);
  }
  assert.equal(called, false);
});
test('slice output survives upstream cleanup without modifying upstream response', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));
  try {
    const source = path.join(root, 'temporary.3mf');
    fs.writeFileSync(source, 'synthetic sliced artifact');
    const response = { content: [{ type: 'text', text: source }, { type: 'text', text: source }] };
    const result = await forwardTool({ async callTool() { return response; } }, { name: 'slice_stl' }, root);
    fs.unlinkSync(source);
    assert.equal(fs.readFileSync(result.content[0].text, 'utf8'), 'synthetic sliced artifact');
    assert.equal(result.content[0].text, result.content[1].text);
    assert.equal(response.content[0].text, source);
    assert.ok(result.content[0].text.includes(path.join('artifacts', 'jobs')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('an upstream error does not copy local files', async () => {
  const response = { isError: true, content: [{ type: 'text', text: process.execPath }] };
  assert.equal(await forwardTool({ async callTool() { return response; } }, { name: 'slice_stl' }, '.'), response);
});
test('only offline configuration reaches upstream', () => {
  const root = path.resolve('portable-test');
  const studioExe = path.join(root, 'Studio', 'bambu-studio.exe');
  const env = offlineEnvironment({ PATH: 'normal', PRINTER_HOST: 'sensitive', BAMBU_TOKEN: 'secret',
    BAMBU_X2D_PRIVATE_CONFIG: 'private', SLICER_PATH: 'unsafe', TEMP_DIR: 'unsafe' }, { root, studioExe });
  assert.equal(env.PATH, 'normal');
  assert.equal(env.PRINTER_HOST, undefined);
  assert.equal(env.BAMBU_TOKEN, undefined);
  assert.equal(env.BAMBU_X2D_PRIVATE_CONFIG, undefined);
  assert.equal(env.TEMP_DIR, undefined);
  assert.equal(env.SLICER_PATH, path.join(root, 'build', 'BambuCliHidden.exe'));
  assert.equal(env.BAMBU_STUDIO_EXE, studioExe);
  assert.equal(env.BAMBU_REQUIRE_CONFIRMATION, '1');
});
test('call arguments cannot opt into device reads or bypass the isolated executable', async () => {
  const received = [];
  const client = { async callTool(request) { received.push(request); return { content: [] }; } };
  for (const args of [{ host: 'device' }, { bambu_token: 'secret' }, { slicer_path: 'elsewhere' },
    { use_printer_filaments: true }, { slicer_type: 'orcaslicer' }]) {
    await assert.rejects(forwardTool(client, { name: 'slice_stl', arguments: args }, '.'), /offline|Offline/);
  }
  assert.equal(received.length, 0);
  await forwardTool(client, { name: 'slice_stl', arguments: { stl_path: 'part.stl' } }, '.');
  assert.equal(received[0].arguments.use_printer_filaments, false);
  assert.equal(received[0].arguments.slicer_type, 'bambustudio');
});
test('discovery does not advertise unsupported device or executable arguments', () => {
  const original = { name: 'slice_stl', inputSchema: { properties: { host: {}, bambu_token: {}, slicer_path: {},
    slicer_type: { enum: ['bambustudio', 'orca'] }, use_printer_filaments: {} } } };
  const [tool] = filterTools([original]);
  assert.equal(tool.inputSchema.properties.host, undefined);
  assert.equal(tool.inputSchema.properties.slicer_path, undefined);
  assert.equal(tool.inputSchema.properties.use_printer_filaments.const, false);
  assert.deepEqual(tool.inputSchema.properties.slicer_type.enum, ['bambustudio']);
  assert.ok(original.inputSchema.properties.host);
});

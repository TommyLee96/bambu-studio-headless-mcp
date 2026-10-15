// SPDX-License-Identifier: GPL-2.0-only
import './lib/windows-hidden.cjs';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT } from './lib/config.mjs';
import { assertAllowed } from './lib/bridge.mjs';

const client = new Client({ name: 'bambu-headless-cli', version: '0.1.0' });
try {
  const [name = '--list', file] = process.argv.slice(2);
  if (name !== '--list') assertAllowed(name);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(ROOT, 'scripts', 'server.mjs')], cwd: ROOT, stderr: 'pipe' });
  transport.stderr?.resume();
  await client.connect(transport);
  if (name === '--list') {
    const { tools } = await client.listTools();
    console.log(JSON.stringify({ server: client.getServerVersion(), tools }, null, 2));
  } else {
    const args = file ? JSON.parse(fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, '')) : {};
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 300000 });
    console.log(JSON.stringify(result, null, 2));
    if (result.isError) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await client.close().catch(() => {}); }

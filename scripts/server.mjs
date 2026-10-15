// SPDX-License-Identifier: GPL-2.0-only
import './lib/windows-hidden.cjs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ROOT, readConfig, findStudio, offlineEnvironment } from './lib/config.mjs';
import { filterTools, assertAllowed, forwardTool, OFFLINE_TOOLS } from './lib/bridge.mjs';

const upstream = new Client({ name: 'bambu-headless-bridge', version: '0.1.0' });
let transport;
let closing;
async function close() {
  if (!closing) closing = upstream.close().catch(() => {});
  return closing;
}
try {
  if (process.platform !== 'win32') throw new Error('The isolated Studio runtime requires Windows.');
  const studioExe = findStudio(readConfig());
  transport = new StdioClientTransport({
    command: process.execPath, args: [path.join(ROOT, 'scripts', 'upstream.mjs')], cwd: ROOT,
    env: offlineEnvironment(process.env, { root: ROOT, studioExe }), stderr: 'pipe',
  });
  transport.stderr?.resume();
  await upstream.connect(transport);
  const listing = await upstream.listTools();
  const tools = filterTools(listing.tools);
  if (tools.length !== OFFLINE_TOOLS.length) throw new Error('Pinned upstream does not supply every required offline tool.');
  const server = new Server({ name: 'bambu-headless-bridge', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try { assertAllowed(request.params.name); }
    catch { throw new McpError(ErrorCode.InvalidParams, 'Tool is not available in this offline bridge.'); }
    return forwardTool(upstream, request.params, ROOT, extra.signal);
  });
  server.onclose = () => { void close(); };
  upstream.onclose = () => { void server.close(); };
  process.stdin.once('end', async () => { await server.close(); await close(); });
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, async () => {
    await server.close(); await close(); process.exitCode = 0;
  });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error.message);
  await close();
  process.exitCode = 1;
}

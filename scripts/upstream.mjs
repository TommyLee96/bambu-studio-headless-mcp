// SPDX-License-Identifier: GPL-2.0-only
import './lib/windows-hidden.cjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readConfig, findStudio, offlineEnvironment } from './lib/config.mjs';

if (process.platform !== 'win32') throw new Error('The isolated Studio runtime requires Windows.');
const launcher = path.join(ROOT, 'build', 'BambuCliHidden.exe');
if (!fs.existsSync(launcher)) throw new Error('Build the isolated launcher before starting the bridge.');
const environment = offlineEnvironment(process.env, { root: ROOT, studioExe: findStudio(readConfig()) });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, environment);
const work = path.join(ROOT, 'artifacts', 'work');
fs.mkdirSync(work, { recursive: true });
process.chdir(work);
await import(pathToFileURL(path.join(ROOT, 'node_modules', 'bambu-printer-mcp', 'dist', 'index.js')).href);

// SPDX-License-Identifier: GPL-2.0-only
// Checks tracked files, never ignored local runtime data. This is a guard, not a secret scanner replacement.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/config.mjs';
const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = /^(?:node_modules|build|artifacts|private|templates)\/|^config\/(?!.*\.example\.json$)|(?:^|\/)\.env(?:\.|$)|\.(?:3mf|gcode|exe|dll|log|zip)$/i;
const patterns = [
  /[A-Z]:[\\/]Users[\\/](?!Public(?:[\\/]|$)|<)[^\s"'<>\\/]+/i,
  /(?:access_code|access_token|password)\s*[=:]\s*["'][A-Za-z0-9_+\/-]{8,}["']/i,
  /(?:github_pat_|ghp_|sk-proj-)[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const issues = [];
for (const file of files) {
  if (forbidden.test(file)) issues.push(`${file}: local/runtime file must not be tracked`);
  const full = path.join(ROOT, file);
  if (!fs.statSync(full, { throwIfNoEntry: false })?.isFile()) continue;
  const content = fs.readFileSync(full);
  if (content.includes(0)) { issues.push(`${file}: unexpected binary`); continue; }
  if (patterns.some(pattern => pattern.test(content.toString('utf8')))) issues.push(`${file}: possible private data`);
}
if (!files.length) issues.push('No tracked files; git add the intended public files before scanning.');
if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
else console.log(`Public-file guard passed for ${files.length} tracked files.`);

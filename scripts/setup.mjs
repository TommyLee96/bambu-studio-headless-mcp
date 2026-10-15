// SPDX-License-Identifier: GPL-2.0-only
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readConfig, findStudio } from './lib/config.mjs';

try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/setup.mjs [--studio-exe <executable>] [--enable-x2d-compat]');
  } else {
    const config = readConfig();
    let enableCompat = false;
    let explicitExecutable;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--studio-exe' && args[i + 1]) explicitExecutable = args[++i];
      else if (args[i] === '--enable-x2d-compat') enableCompat = true;
      else throw new Error('Unknown or incomplete setup argument. Use --help.');
    }
    if (process.platform !== 'win32') throw new Error('The isolated Studio runtime requires Windows.');
    const studioExe = findStudio(config, explicitExecutable ? { ...process.env, BAMBU_STUDIO_EXE: explicitExecutable } : process.env);
    if (!fs.existsSync(path.join(ROOT, 'build', 'BambuCliHidden.exe'))) throw new Error('Run npm run build:launcher first.');
    const profiles = path.join(path.dirname(studioExe), 'resources', 'profiles', 'BBL', 'machine');
    if (!fs.existsSync(profiles) || !fs.readdirSync(profiles).some(file => /X2D.*0\.4.*\.json$/i.test(file))) {
      throw new Error('Installed Studio does not contain the required X2D 0.4 preset.');
    }
    if (enableCompat) {
      const { applyCompatibility } = await import('./compatibility/apply-x2d-compat.mjs');
      await applyCompatibility({ root: ROOT, restore: false });
    }
    fs.mkdirSync(path.join(ROOT, 'config'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'config', 'local.json'), JSON.stringify({ studioExe }, null, 2) + '\n');
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
    const toml = `[mcp_servers.bambu_studio_headless_mcp]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(path.join(ROOT, 'scripts', 'server.mjs'))}]\ncwd = ${JSON.stringify(ROOT)}\nstartup_timeout_sec = 60\ntool_timeout_sec = 300\n`;
    fs.writeFileSync(path.join(ROOT, 'artifacts', 'codex-mcp.example.toml'), toml);
    console.log('Saved config/local.json and artifacts/codex-mcp.example.toml (both ignored).');
    console.log('Setup only writes project-local files; add the generated MCP entry to your client if desired.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }

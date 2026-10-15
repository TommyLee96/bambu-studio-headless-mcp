// SPDX-License-Identifier: GPL-2.0-only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function readConfig(root = ROOT) {
  const file = path.join(root, 'config', 'local.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : {};
}
export function findStudio(config = {}, env = process.env) {
  const supplied = env.BAMBU_STUDIO_EXE || config.studioExe;
  if (supplied) {
    if (!path.isAbsolute(supplied) || !fs.statSync(supplied, { throwIfNoEntry: false })?.isFile()) {
      throw new Error('BAMBU_STUDIO_EXE or studioExe must point to an installed executable.');
    }
    return path.resolve(supplied);
  }
  for (const key of ['ProgramW6432', 'ProgramFiles', 'ProgramFiles(x86)']) {
    if (!env[key]) continue;
    const candidate = path.join(env[key], 'Bambu Studio', 'bambu-studio.exe');
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }
  throw new Error('Bambu Studio was not found. Run setup with --studio-exe.');
}
export function offlineEnvironment(env, { root, studioExe }) {
  // Allow normal OS/runtime variables, but discard inherited printer/cloud/bridge configuration.
  const result = Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^(?:BAMBU_|PRINTER_|SLICER_|MCP_|NOZZLE_|TEMP_DIR$|BAMBUCONNECT|BAMBU_CONNECT)/i.test(key)));
  return Object.assign(result, {
    MCP_TRANSPORT: 'stdio', BAMBU_MODEL: 'x2d', SLICER_TYPE: 'bambustudio',
    SLICER_PATH: path.join(root, 'build', 'BambuCliHidden.exe'),
    BAMBU_STUDIO_PATH: path.join(root, 'build', 'BambuCliHidden.exe'),
    BAMBU_STUDIO_EXE: studioExe,
    BAMBU_PROFILES_ROOT: path.join(path.dirname(studioExe), 'resources', 'profiles'),
    BAMBU_REQUIRE_CONFIRMATION: '1', NOZZLE_DIAMETER: '0.4',
    BAMBU_TEMPLATE_DIR: path.join(root, 'templates'),
    BAMBU_BRIDGE_WORK_DIR: path.join(root, 'artifacts', 'launcher'),
  });
}

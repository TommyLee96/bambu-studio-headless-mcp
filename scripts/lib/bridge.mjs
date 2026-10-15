// SPDX-License-Identifier: GPL-2.0-only
import fs from 'node:fs';
import path from 'node:path';

export const OFFLINE_TOOLS = Object.freeze([
  'list_3mf_plate_objects', 'extend_stl_base', 'scale_stl', 'rotate_stl', 'get_stl_info',
  'list_templates', 'save_template', 'get_slice_settings', 'slice_with_template',
  'slice_stl', 'inspect_print_file', 'merge_vertices', 'center_model', 'lay_flat',
]);
const allowed = new Set(OFFLINE_TOOLS);
const deviceKeys = new Set(['host', 'bambu_serial', 'bambu_token', 'bambu_dev_id', 'connection_mode', 'ams_mapping', 'ams_mapping2']);
export function filterTools(tools) {
  return tools.filter(tool => allowed.has(tool.name)).map(tool => {
    const copy = structuredClone(tool);
    for (const key of [...deviceKeys, 'slicer_path']) delete copy.inputSchema?.properties?.[key];
    if (copy.inputSchema?.properties?.slicer_type) copy.inputSchema.properties.slicer_type.enum = ['bambustudio'];
    if (copy.inputSchema?.properties?.use_printer_filaments) {
      copy.inputSchema.properties.use_printer_filaments = { type: 'boolean', const: false,
        description: 'Always false in this offline bridge. Supply local filament profiles.' };
    }
    return copy;
  });
}
export function assertAllowed(name) {
  if (!allowed.has(name)) throw new Error('Tool is not available in this offline bridge.');
}
export function persistSlice(result, root) {
  if (result.isError) return result;
  const output = structuredClone(result);
  let directory;
  const copies = new Map();
  for (const block of output.content || []) {
    if (block.type !== 'text' || !path.isAbsolute(block.text) ||
        !fs.statSync(block.text, { throwIfNoEntry: false })?.isFile()) continue;
    if (!directory) {
      const jobs = path.join(root, 'artifacts', 'jobs');
      fs.mkdirSync(jobs, { recursive: true });
      directory = fs.mkdtempSync(path.join(jobs, 'slice-'));
    }
    if (!copies.has(block.text)) {
      const destination = path.join(directory, `${copies.size + 1}-${path.basename(block.text)}`);
      fs.copyFileSync(block.text, destination, fs.constants.COPYFILE_EXCL);
      copies.set(block.text, destination);
    }
    block.text = copies.get(block.text);
  }
  return output;
}
export async function forwardTool(client, request, root, signal) {
  assertAllowed(request.name);
  const args = { ...request.arguments };
  if ([...deviceKeys, 'slicer_path'].some(key => Object.hasOwn(args, key))) {
    throw new Error('Device credentials and executable overrides are unavailable in this offline bridge.');
  }
  if (['slice_stl', 'slice_with_template'].includes(request.name)) {
    if (args.use_printer_filaments === true || (args.slicer_type && args.slicer_type !== 'bambustudio')) {
      throw new Error('Offline slicing requires local profiles and the isolated Bambu Studio launcher.');
    }
    args.use_printer_filaments = false;
    args.slicer_type = 'bambustudio';
  }
  const result = await client.callTool({ ...request, arguments: args }, undefined, { timeout: 240000, signal });
  return ['slice_stl', 'slice_with_template'].includes(request.name) ? persistSlice(result, root) : result;
}

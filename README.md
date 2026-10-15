# Bambu Headless Bridge

[English](README.md) | [简体中文](README.zh-CN.md)

Run Bambu Studio CLI jobs from an MCP client while keeping the Windows mouse,
keyboard and visible desktop available for other work.

This independent project connects two useful building blocks:
[bambu-printer-mcp](https://github.com/DMontgomery40/bambu-printer-mcp) for MCP
tools and slicing, and optional
[bambu-studio-ai](https://github.com/heyixuan2/bambu-studio-ai) skills for model
preparation. It adds an isolated Windows launcher and an offline X2D dual-nozzle
workflow. Bambu Studio must be installed separately.

## What it does

- Runs each Bambu Studio CLI process on a separate, never-shown Windows desktop.
  CLI error dialogs remain there too; the launcher does not switch desktops or
  send mouse or keyboard input.
- Exposes a pinned `bambu-printer-mcp` **1.1.27** runtime through an MCP stdio
  bridge restricted to model preparation, inspection and slicing, with local
  configuration kept outside version control.
- Prepares two closed STL parts as one X2D dual-nozzle project, preserving their
  shared coordinates by default. The current builder supports the **0.4/0.4 mm**
  software baseline. Independent objects can use a separate layout.
- Checks the sliced 3MF archive, X2D metadata, physical nozzle assignments and
  G-code tool use offline.
- Provides an optional, narrowly scoped X2D inspector compatibility adaptation
  for Bambu Studio **02.08.02.61** output. Its source and version guards must pass;
  it does not raise temperature limits or accept arbitrary G-code.
- Documents how to use `bambu-studio-ai` for modelling, mesh checks and previews,
  then hand slicing to this background bridge.

## Requirements

- Windows with an interactive, unlocked desktop session. A hidden desktop is
  isolation inside that session, not a Windows service or a promise that GPU
  slicing works over every remote or locked session.
- Node.js **24 or later**, Python **3.10 or later**, and the C# build tools used
  by [`windows/build.ps1`](windows/build.ps1).
- A separately installed Bambu Studio with its own X2D machine/process/filament
  profiles when using the X2D workflow.
- Two closed STL meshes, a suitable X2D dual-nozzle template, and local filament
  profiles for a dual-nozzle job. Confirm the actual nozzle sizes and materials
  before preparing a file for physical printing.

Package installation may need internet access. Model preparation and slicing
can run offline; no printer IP, serial number, access code or cloud account is
needed.

## Quick start

Clone this repository, open PowerShell in its root, and install the pinned
dependency:

```powershell
npm install
powershell -ExecutionPolicy Bypass -File windows/build.ps1
node scripts/setup.mjs --studio-exe '<installed Bambu Studio executable>'
```

Replace every `<placeholder>` before running a command. Setup saves local
configuration in the ignored `config/local.json` and creates
`artifacts/codex-mcp.example.toml`; it does not edit an MCP client's existing
configuration. It does not bundle or upload Bambu Studio or its profiles. The compiled launcher is
`build/BambuCliHidden.exe`. It uses `BAMBU_STUDIO_EXE` to locate the real
executable, and the bridge sets that value from local configuration.

To opt into the guarded X2D inspector compatibility adaptation, add
`--enable-x2d-compat` to the setup command. It is disabled by default. Read the
[compatibility boundaries](docs/architecture.md) before enabling it.

Start the MCP server with:

```powershell
node scripts/server.mjs
```

For an MCP client, use the following generic configuration and replace the
repository placeholder with the absolute path on that computer:

```json
{
  "mcpServers": {
    "bambu_background": {
      "command": "node",
      "args": ["<absolute repository path>/scripts/server.mjs"]
    }
  }
}
```

The server uses stdio for MCP. Launch it through the MCP client rather than
expecting a web page. A local one-shot client is also provided:

```powershell
node scripts/call-tool.mjs <tool-name> <request.json>
node scripts/call-tool.mjs --list
```

Inspect the tool schema supplied by the running server before creating requests.
The bridge rejects device credentials, executable overrides, non-Studio slicers
and live-printer filament resolution; slicing always uses local profiles.
Refer to [architecture and runtime boundaries](docs/architecture.md) for the
launcher, tool exposure and X2D compatibility details.

## X2D dual-nozzle workflow

Use a genuine X2D project template prepared with the installed Bambu Studio
profiles. Retain its inherited and included start/end/filament-change G-code;
do not substitute an A1 or H2D template. The current builder accepts a single
plate, two 0.4 mm nozzles, two filament slots and an explicit manual mapping to
the two physical nozzles. It inherits project settings, then regenerates part
metadata; source mesh painting and object-specific overrides are not reused.

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r python/requirements.txt
.venv\Scripts\python.exe examples/make_sample_parts.py --output-dir artifacts/demo
.venv\Scripts\python.exe python/prepare_dual_parts.py --template '<X2D project.3mf>' --part1 artifacts/demo/part_1.stl --part2 artifacts/demo/part_2.stl --output artifacts/dual.3mf --filament1 '<PLA.json>' --filament2 '<PLA.json>'
node scripts/call-tool.mjs slice_stl artifacts/dual.mcp.json
.venv\Scripts\python.exe python/verify_dual.py '<sliced output.3mf>'
```

The sample generator creates two original 8 mm cubes with a 4 mm gap. Replace
them with your own STL files for real work. The preparation script writes a new
project, a `.mcp.json` request sidecar and a `.receipt.json` preparation receipt;
it refuses to overwrite existing output. Slice that request,
then use the actual output path returned by the tool for verification. The
default layout preserves assembly relationships; use `--layout separate` only
for deliberately independent objects.

Both filament slots and physical nozzle mappings must be explicit. AMS spool
slots are a separate choice. Two colours in a preview do not prove that two
physical nozzles are used. The verifier uses `filament_maps` to connect material
slots to physical nozzles; `T` and `H` values are not treated as physical nozzle
IDs on their own. See the full
[X2D preparation and acceptance workflow](docs/x2d-workflow.md).

## Optional modelling Skill

`bambu-studio-ai` can supply parametric models, mesh analysis and previews. Its
upstream GUI helpers and A1-based colour templates are not a background X2D
workflow by themselves. Use the
[generic Skill integration guide](docs/skill-integration.md) to keep all Bambu
CLI execution behind the hidden launcher and route dual-nozzle jobs through the
X2D preparation path. The generic agent instructions in
[`skills/bambu-headless/SKILL.md`](skills/bambu-headless/SKILL.md) can be read or
copied into a supported Skill location. The upstream Skill is not bundled or
automatically installed.

## Limits and verification

- This is an **unofficial** bridge. It is not a complete background API for the
  Bambu Studio GUI: interactive painting and every GUI-only operation are outside
  its scope.
- It does not expose printer control or migrate device credentials. Device
  connection and printer actions are outside this bridge's offline setup and
  require separate tooling, configuration and an explicit operator request.
- The upstream native X2D printing helper currently supports macOS. This
  project does not turn it into a Windows printing helper or launch Bambu
  Connect as a fallback.
- Software checks establish file preparation and static inspection. They do
  not establish live printer connectivity, loaded spool identity, nozzle
  dimensions or successful physical printing.
- The hidden desktop avoids desktop takeover. It still uses CPU, memory and
  graphics resources; performance depends on the computer and installed Studio.
- The compatibility adaptation targets the pinned MCP version and identified
  Studio output. Unexpected versions, source hashes or G-code must fail closed.
  Re-run local acceptance after dependency or Studio upgrades.

Run the included software checks from the repository root:

```powershell
npm test
.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_dual*.py'
powershell -ExecutionPolicy Bypass -File windows/test-launcher.ps1
```

These checks are followed by a local slice of a known project when accepting a
new Studio installation. None starts a print.

## Privacy and provenance

This repository contains source code and generic examples. It does not bundle
Bambu Studio, official system profiles, printer credentials, local account
configuration or machine-specific logs. Keep generated files in `artifacts/`
and local configuration in `config/`; review any file before sharing it.

Thanks to the upstream authors of
[bambu-printer-mcp](https://github.com/DMontgomery40/bambu-printer-mcp),
[bambu-studio-ai](https://github.com/heyixuan2/bambu-studio-ai), and
[Bambu Studio](https://github.com/bambulab/BambuStudio).
Their own licenses and terms apply to their software. This project does not
claim affiliation with or endorsement by Bambu Lab or those upstream authors.

This repository's code is licensed under [`GPL-2.0-only`](LICENSE).

---
name: bambu-studio-headless-mcp
description: "Use the Bambu Studio Headless MCP server to prepare and inspect STL/3MF models and slice with Bambu Lab Bambu Studio on Windows without taking over the active desktop. Includes X2D dual-nozzle offline validation. 拓竹 Bambu Studio 后台切片 MCP：模型准备、检查与 X2D 双喷头离线校验。"
---

Use the configured bridge's offline tools for mesh inspection, transformations, templates and slicing. If MCP is unavailable, use `node scripts/call-tool.mjs TOOL REQUEST_JSON` from the installed repository. Read that repository's README for setup; do not assume its installation directory.

All Studio CLI execution must go through the bridge's compiled isolated Windows launcher. Never fall back to GUI automation or launch Studio directly when isolation fails. The launcher creates a desktop which is never shown, and does not send mouse or keyboard input.

For an X2D dual-nozzle project, read `docs/x2d-workflow.md`. Use a user-supplied X2D template and two locally installed compatible filament profiles. Preserve shared coordinates for assembly parts. Keep material slots, AMS slots and physical nozzles distinct. Run `python/verify_dual.py` on the sliced artifact and report its evidence and limitations.

The documented offline baseline is the X2D 0.4/0.4 preset. A profile name is not confirmation of installed nozzle hardware. Other nozzle combinations require separate validation. Do not substitute another printer's preset or bypass G-code inspection errors. Apply the optional version-guarded X2D compatibility patch only as documented.

Successful offline slicing does not prove printer connectivity or a physical print. This bridge exposes file operations only; device control belongs to a separate explicitly requested integration.

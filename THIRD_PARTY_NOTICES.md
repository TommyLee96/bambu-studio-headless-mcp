# Third-party notices

This project is distributed under GPL-2.0-only. See [LICENSE](LICENSE).

- [bambu-printer-mcp](https://github.com/DMontgomery40/bambu-printer-mcp), pinned to 1.1.27, is a GPL-2.0 dependency. The optional compatibility patch modifies its G-code inspector. Its original copyright and license remain in the installed package. Modified behavior is documented in this repository and can be restored to the exact upstream files.
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) is an MIT-licensed runtime dependency. Its license remains in the installed package.
- [bambu-studio-ai](https://github.com/heyixuan2/bambu-studio-ai) is an MIT-licensed companion workflow and an inspiration for background model preparation. Its complete application and Skill are not bundled here.
- [Bambu Studio](https://github.com/bambulab/BambuStudio) is an independently installed application. This repository does not distribute its executable, machine presets, filament profiles, or project templates. The compatibility patch is based on the documented source behavior in [WipeTower.cpp](https://github.com/bambulab/BambuStudio/blob/926a7192574bcb9b3a732e1ec59a46d79cb45466/src/libslic3r/GCode/WipeTower.cpp#L1254-L1278) and the exact X2D filament-change banner in its official profiles.
- Python dependencies are installed separately from `python/requirements.txt`; their licenses remain with their distributions.

The project name describes interoperability. This is an independent community project and is not an official Bambu Lab product.

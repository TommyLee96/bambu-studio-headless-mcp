# X2D dual-nozzle workflow / X2D 双喷头流程

[English README](../README.md) | [中文 README](../README.zh-CN.md)

## Inputs / 输入

**English.** Supply two closed, positive-volume STL meshes and a known X2D
dual-nozzle 3MF template made with the installed Bambu Studio profiles. The
template must already use X2D machine settings and retain official inherited
and included G-code. Use local filament profiles appropriate for the intended
materials. The software preset is an input, not evidence of installed hardware.
Confirm both actual nozzle sizes, material compatibility and build plate before
physical use. Do not replace an X2D template with an A1 or H2D project.
The current builder supports one plate, exactly two 0.4 mm software nozzles,
two filament slots, manual physical mapping `1 2` or `2 1`, and rectangular
printable areas for both nozzles. Other baselines are rejected.

**中文。** 提供两个封闭且体积为正的 STL 网格，以及使用已安装 Bambu Studio 配置制作的 X2D 双喷头 3MF 模板。
模板必须使用 X2D 机器设置，保留官方继承和引用的 G-code；耗材配置应与预期材料相符。
软件预设是输入条件，不是实装硬件证据。实物使用前应确认两只喷嘴的真实尺寸、材料兼容性和打印板。
不得使用 A1 或 H2D 项目替代 X2D 模板。
当前构建器支持单盘、恰好两只 0.4 mm 软件喷嘴、两个耗材槽、手动物理映射 `1 2` 或 `2 1`，
且两个喷头的打印区域均为矩形；其他基线应拒绝。

## Prepare / 准备

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r python/requirements.txt
.venv\Scripts\python.exe python/prepare_dual_parts.py --template '<X2D project.3mf>' --part1 '<first part.stl>' --part2 '<second part.stl>' --output artifacts/dual.3mf --filament1 '<first filament.json>' --filament2 '<second filament.json>'
```

**English.** Relative input coordinates are preserved by default so interlocking
or touching parts keep their assembly relationship. The combined assembly is
placed on the bed as one unit. Use `--layout separate` only if the objects are
intended to be independent. Inspect the resulting dimensions and placement;
do not rely only on a colour thumbnail.

The generated project assigns the two parts to separate filament slots and
explicit physical nozzle mappings. An AMS slot describes spool selection; it
does not select a physical nozzle. The output is a new file, and the source
template remains a reusable input. Project-level settings are inherited;
original template meshes, painting and local object overrides are not reused.
The builder creates `.mcp.json` and `.receipt.json` sidecars and refuses to
overwrite existing output files.

**中文。** 默认保留输入的相对坐标，使嵌合或接触部件保持装配关系；组合作为整体放置在打印板上。
只有明确需要独立摆放的物件才使用 `--layout separate`。检查生成项目的尺寸和位置，不要仅依赖彩色缩略图。

生成项目将两个部件分配到不同耗材槽，并明确映射物理喷头。
AMS 槽位描述料盘选择，并不选择物理喷头。输出使用新文件，源模板仍作为可复用输入保留。
构建器继承项目级设置，不复用源模板网格、涂色或物件级局部覆盖。
同时生成 `.mcp.json` 和 `.receipt.json` 旁车文件，拒绝覆盖已有输出文件。

## Slice / 切片

```powershell
node scripts/call-tool.mjs slice_stl artifacts/dual.mcp.json
```

**English.** The preparation script creates the `.mcp.json` sidecar. It specifies
X2D, Bambu Studio, offline filament selection and the required local profile
paths. `load_filaments` is a semicolon-separated string of both filament profile
paths; keep that format when editing a request. The `stl_path` tool argument
also accepts the prepared 3MF.

Read the tool's returned output path. The slice must run through
`build/BambuCliHidden.exe`; a failure must not trigger visible Studio, desktop
automation or Bambu Connect. Keep failed-job diagnostics locally and remove
private paths or device details before sharing them.

**中文。** 准备脚本生成 `.mcp.json` 旁车文件，其中指定 X2D、Bambu Studio、离线耗材选择及所需本地配置路径。
`load_filaments` 为两个耗材配置路径以分号连接的字符串，编辑请求时保持此格式。
工具的 `stl_path` 参数也可接收准备好的 3MF。

读取工具返回的输出路径。切片必须经过 `build/BambuCliHidden.exe`；失败不得触发可见 Studio、桌面自动化或 Bambu Connect。
失败诊断保留在本地，分享前移除私有路径和设备信息。

## Verify / 验证

```powershell
.venv\Scripts\python.exe python/verify_dual.py '<sliced output.3mf>'
```

Add `--receipt artifacts/verification.json` to save a new verification receipt.
增加 `--receipt artifacts/verification.json` 可保存新的验证记录。

**English.** Inspect both the project metadata and sliced G-code. Acceptance
must include archive integrity, consistent X2D identity, two nozzle declarations,
per-part filament selection, physical nozzle mapping and extrusion paths using
both physical tools depositing on actual model objects. Material `T` commands
are mapped through `filament_maps`; an `H` operand is not a physical nozzle ID.
A single-material slice or two-colour preview is not
dual-nozzle acceptance. Preserve the original X2D start/end/change templates.
Review warnings from the slicer and inspector rather than treating artifact
creation alone as success.

The verifier is static. It does not simulate firmware, authenticate model
metadata, query the printer or confirm physical material loading. Review the
generated preview and estimates together with its checks before handing off the
file. A physical print requires a separate operator decision.

**中文。** 同时检查项目元数据和切片 G-code。验收应包含压缩包完整性、一致的 X2D 身份、双喷头声明、
各部件耗材选择、物理喷头映射和两个物理工具的挤出路径。
应确认两个物理工具均在模型对象上沉积材料；材料 `T` 指令需经 `filament_maps` 映射，`H` 参数不是物理喷头编号。
单耗材切片或双色预览不是双喷头验收。保留原有 X2D 启动、结束和换料模板，检查切片器及检查器警告，不能仅以文件生成判定成功。

验证器执行静态检查，不模拟固件、不认证模型元数据来源、不查询打印机，也不确认实际装料。
交付前将检查结果与生成预览、耗时和耗材估算一起复核。实物打印需操作者另行决定。

## When to stop / 应停止的情况

**English.** Stop on missing or contradictory machine/nozzle metadata, an
unrecognized profile or inspector version, extra executable banner content,
unknown temperature parameters, unsupported material limits, invalid geometry
or an output that uses only one physical tool. Fix the source project or
configuration and slice again; do not weaken validation to make a file pass.

**中文。** 机器／喷头元数据缺失或矛盾、配置或检查器版本未知、横幅包含额外可执行内容、温度参数未知、
材料温度超限、几何无效，或输出只使用一个物理工具时应停止。
修正源项目或配置后重新切片，不应降低验证要求以使文件通过。

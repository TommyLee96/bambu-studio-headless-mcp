# Architecture / 架构

[English README](../README.md) | [中文 README](../README.zh-CN.md)

## Execution path / 执行路径

```text
MCP client or scripts/call-tool.mjs
  -> scripts/server.mjs
  -> pinned bambu-printer-mcp 1.1.27
  -> build/BambuCliHidden.exe
  -> separately installed Bambu Studio CLI
     on a separate, never-shown Windows desktop
  -> local model / project / sliced artifacts
```

**English.** The bridge invokes the user's separately installed Bambu Studio.
The Windows launcher creates an independent desktop in the existing session and
starts Studio there. It never calls `SwitchDesktop`, sends UI input or opens the
visible Studio window. Standard output, standard error, exit status and timeout
handling provide the control path. If isolation cannot be established, fail the
job; do not launch Studio directly as a fallback. An unlocked interactive
Windows session and a working graphics environment are required.

**中文。** 桥接器调用操作者单独安装的 Bambu Studio。Windows 启动器在当前会话创建独立桌面并在其中启动 Studio，
不调用 `SwitchDesktop`、不发送界面输入，也不打开可见的 Studio 窗口。
控制依赖标准输出、标准错误、退出状态和超时处理。无法建立隔离时应使任务失败，不得回退为直接启动 Studio。
需要已解锁的交互式 Windows 会话和可用图形环境。

## Configuration / 配置

**English.** Run `scripts/setup.mjs --studio-exe '<installed executable>'` after
building the launcher. It records the executable location in ignored
`config/local.json`. It also writes `artifacts/codex-mcp.example.toml` without
editing an existing client configuration. `BAMBU_STUDIO_EXE` selects the real
Studio executable for the launcher. Use absolute local paths in MCP client configuration, but do not
commit machine-specific configuration. The repository does not distribute
Studio binaries, official profiles or device/account credentials.

**中文。** 编译启动器后运行 `scripts/setup.mjs --studio-exe '<已安装的可执行文件>'`，
程序位置保存于 Git 忽略的 `config/local.json`，并生成 `artifacts/codex-mcp.example.toml`，不修改客户端现有配置。
启动器通过 `BAMBU_STUDIO_EXE` 选择真实 Studio。
MCP 客户端配置使用本机绝对路径，但不得提交机器专属配置。
仓库不分发 Studio 程序、官方配置或设备／账户凭据。

| Launcher variable / 启动器变量 | Purpose / 用途 |
| --- | --- |
| `BAMBU_STUDIO_EXE` | Absolute path to the real Studio executable; recommended for custom install locations. / 真实 Studio 可执行文件的绝对路径，自定义安装位置建议明确设置。 |
| `BAMBU_CLI_TIMEOUT_SECONDS` | Timeout from 1 to 3,600 seconds; default 180. / 超时为 1 至 3,600 秒，默认 180 秒。 |
| `BAMBU_BRIDGE_WORK_DIR` | Optional local launcher work root; defaults to a dedicated temporary directory. / 可选的本地启动器工作根目录，默认使用专用临时目录。 |

**English.** These are standalone launcher variables. The MCP bridge constructs
its own offline environment, sets the executable/work directory from local
configuration and filters inherited printer/bridge variables. Merely setting a
launcher variable in the parent shell does not necessarily override the bridge.

**中文。** 上表为独立启动器变量。MCP 桥接器构造自身的离线环境，按本机配置指定程序及工作目录，
并过滤继承的打印机／桥接器变量。在父 shell 设置启动器变量不一定覆盖桥接器配置。

**English.** `windows/build.ps1` needs no arguments and uses the Windows .NET
Framework C# compiler. `BambuCliHidden.exe --help-wrapper` describes the wrapper
without starting Studio; Studio's own `--help` is forwarded to an isolated child.
The launcher preserves the caller's working directory, returns Studio's exit
code, and terminates the child process tree on timeout. A timeout returns `124`;
invalid or GUI-opening arguments return `64`; setup/isolation failures return
`70`. A blank Studio stdout stream is not sufficient evidence that an artifact
was created: inspect the actual output file.

**中文。** `windows/build.ps1` 无需参数，使用 Windows .NET Framework C# 编译器。
`BambuCliHidden.exe --help-wrapper` 不启动 Studio，仅说明启动器；Studio 自身的 `--help` 转发给隔离子进程。
启动器保留调用者工作目录，返回 Studio 的退出码，超时后终止子进程树。
超时返回 `124`，无效或打开 GUI 的参数返回 `64`，配置／隔离失败返回 `70`。
Studio 的标准输出为空不能证明生成了产物，应检查实际输出文件。

## Tool and device boundary / 工具和设备边界

**English.** Use the tools exposed by this bridge, not an unrestricted upstream
server, when the requirement is offline preparation. The bridge exposes only
the following 14 file tools, with no printer controls or credential migration.
Query the active schema:
upstream tools and arguments may change. `slice_stl` can receive a prepared
3MF through its `stl_path` field. Request `use_printer_filaments: false` for
offline work; do not discover devices or substitute spool information from a
live printer. Uploading or starting a job, heating, motion and other printer
changes are separate device actions. None are an installation test.
The bridge also rejects per-call device arguments, executable overrides,
non-Bambu-Studio slicer selection and live-printer filament resolution. Slice
requests are explicitly forwarded with `use_printer_filaments: false` and
`slicer_type: "bambustudio"`.

**中文。** 需要离线准备时应使用本桥接器开放的工具，不应直接开放无限制的上游服务。
桥接器仅开放以下 14 个文件工具，不含打印机控制或凭据迁移。
工具及参数可能变化，应查询当前 schema。`slice_stl` 的 `stl_path` 字段也可接收已准备的 3MF。
离线任务设置 `use_printer_filaments: false`，不扫描设备，也不从在线打印机代入料盘信息。
上传、启动打印、加热、运动及其他打印机变更属于单独的设备操作，不是安装测试。
桥接器同时拒绝每次调用传入设备参数、覆盖可执行文件、选择非 Bambu Studio 切片器或解析在线打印机耗材。
转发切片请求时明确设置 `use_printer_filaments: false` 和 `slicer_type: "bambustudio"`。

```text
list_3mf_plate_objects  extend_stl_base  scale_stl  rotate_stl
get_stl_info  list_templates  save_template  get_slice_settings
slice_with_template  slice_stl  inspect_print_file  merge_vertices
center_model  lay_flat
```

**English.** Printer status, filament/AMS queries and camera tools are not
exposed by this bridge. Use a separately reviewed upstream integration if those
capabilities are required.

**中文。** 本桥接器不开放打印机状态、耗材／AMS 查询或摄像头工具。
需要此类功能时，应使用另行审查的上游集成。

## Optional X2D inspection compatibility / 可选 X2D 检查兼容适配

**English.** Enable this optional adaptation with the setup flag
`--enable-x2d-compat`; the default setup does not apply it.
The targeted adaptation is local to `bambu-printer-mcp` 1.1.27; it
is not an upstream release. It requires file metadata that consistently
declares X2D and exactly two nozzles. Two narrowly identified Studio constructs
are handled:

1. For `M104`/`M109`, exactly `T`, `S` and literal `N0` are accepted, with physical
   heater `T` restricted to integer `0` or `1`. `N0` is removed before the
   existing target-temperature checks. Other markers or extra parameters fail.
2. The complete, non-executable X2D filament-change banner is recognized by exact
   match after comment stripping and trimming. Prefixes, altered banners and
   appended commands fail.

All original independent material and hardware temperature checks remain in
force. Copied markers do not prove file authenticity. Applying or restoring the
adaptation requires the expected package version and source/runtime hashes;
unexpected changes must be rejected. Restart the MCP process after a change.

**中文。** 通过 setup 参数 `--enable-x2d-compat` 启用可选适配；默认安装不应用此修改。
此适配仅为 `bambu-printer-mcp` 1.1.27 的本地变更，不是上游发布版本。
要求文件元数据一致声明 X2D 和恰好两个喷头，仅处理两种已明确的 Studio 输出：

1. `M104`／`M109` 只允许 `T`、`S` 和字面值 `N0`，物理加热器 `T` 仅允许整数 `0` 或 `1`。
   在原有目标温度检查之前移除 `N0`；其他标记或额外参数均拒绝。
2. 对去除注释和首尾空白后的完整 X2D 换料非执行横幅做精确匹配；前缀匹配、变体横幅和附加指令均拒绝。

原有独立的耗材和硬件温度检查全部保留。复制标记不能证明文件来源可信。
应用和恢复适配时校验包版本及源码／运行文件哈希，不符合预期的修改应拒绝；变更后需重启 MCP 进程。

The constructs are documented by the Bambu Studio **02.08.02.61** source:
上述构造的依据来自 Bambu Studio **02.08.02.61** 源码：

- [M104/M109 generation / 指令生成](https://github.com/bambulab/BambuStudio/blob/926a7192574bcb9b3a732e1ec59a46d79cb45466/src/libslic3r/GCode/WipeTower.cpp#L1254-L1278)
- [X2D filament-change template / 换料模板](https://github.com/bambulab/BambuStudio/blob/926a7192574bcb9b3a732e1ec59a46d79cb45466/resources/profiles/BBL/machine/Bambu%20Lab%20X2D%200.4%20nozzle%20template%20change_filament_gcode.json#L4)

## Acceptance / 验收

**English.** Treat configuration, MCP handshake, offline slicing, static output
checks, live status and physical printing as separate results. An offline test
can demonstrate that both tool paths are present without proving that the real
printer matches those declarations. Re-run local acceptance after updates; do
not generalize one tested Studio version to every release or hardware setup.

**中文。** 将配置、MCP 握手、离线切片、静态输出检查、实时状态和实物打印分别验收。
离线测试可以证明两个喷头路径均存在，不能证明真实打印机符合文件声明。
更新后需重新本地验收，不能将一个软件版本的通过结果推广到所有版本或硬件配置。

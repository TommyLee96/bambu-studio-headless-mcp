# 拓竹 Bambu Studio 后台切片 MCP

[English](README.md) | [简体中文](README.zh-CN.md)

面向**拓竹（Bambu Lab）Bambu Studio 的非官方 Model Context Protocol（MCP，模型上下文协议）服务器**。
AI Agent 可在 Windows 后台准备、检查 STL/3MF 模型并执行离线切片，鼠标、键盘和可见桌面仍可正常使用。
包含 **X2D 双喷头流程**，已验证 **0.4/0.4 mm 软件配置基线**。英文项目名为 **Bambu Studio Headless MCP**。

本独立项目连接两个现有工具：
[bambu-printer-mcp](https://github.com/DMontgomery40/bambu-printer-mcp) 提供 MCP 工具和切片能力，
可选的 [bambu-studio-ai](https://github.com/heyixuan2/bambu-studio-ai) Skill 提供模型准备能力。
本项目增加 Windows 隔离启动器和 X2D 双喷头离线流程。Bambu Studio 需单独安装。

## 功能

- 将每个 Bambu Studio CLI 进程放入独立且从不显示的 Windows 桌面，错误对话框也保留在该桌面内；启动器不切换桌面、不发送鼠标或键盘输入。
- 通过 MCP stdio 桥接固定为 **1.1.27** 的 `bambu-printer-mcp` 运行时，工具范围限定为模型准备、检查和切片，本机配置不进入版本控制。
- 将两个封闭 STL 部件组装成 X2D 双喷头项目，默认保留共享坐标；当前构建器支持 **0.4/0.4 mm** 软件基线，独立物件可选择分开摆放。
- 离线检查切片 3MF 的压缩包完整性、X2D 元数据、物理喷头分配和 G-code 中的喷头使用。
- 提供可选的严格 X2D 检查器兼容适配，面向 Bambu Studio **02.08.02.61** 输出；必须通过源码和版本校验，不提高温度限制，不放行任意 G-code。
- 说明如何使用 `bambu-studio-ai` 建模、检查网格和生成预览，再交由本后台桥接器切片。

## 环境要求

- Windows，具有已解锁的交互式桌面会话。隐藏桌面属于当前会话内的隔离，不是 Windows 服务，也不保证所有远程或锁屏场景都能使用 GPU 切片。
- Node.js **24 或更新版本**、Python **3.10 或更新版本**，以及 [`windows/build.ps1`](windows/build.ps1) 使用的 C# 编译工具。
- 单独安装的 Bambu Studio；使用 X2D 流程时还需其自带的 X2D 机器、工艺和耗材配置。
- 双喷头任务需要两个封闭 STL 网格、合适的 X2D 双喷头模板和本地耗材配置。用于实际打印前应确认真实喷嘴尺寸和耗材。

安装依赖可能需要联网。建模和切片可离线运行，不需要打印机 IP、序列号、访问码或云账户。

## 快速开始

克隆仓库，在仓库根目录打开 PowerShell，安装固定版本依赖：

```powershell
npm install
powershell -ExecutionPolicy Bypass -File windows/build.ps1
node scripts/setup.mjs --studio-exe '<已安装的 Bambu Studio 可执行文件>'
```

执行前替换所有 `<占位符>`。安装配置保存在被 Git 忽略的 `config/local.json`，并生成 `artifacts/codex-mcp.example.toml`，不会修改 MCP 客户端的现有配置。
不会捆绑或上传 Bambu Studio 及其配置文件。
编译产物为 `build/BambuCliHidden.exe`，通过 `BAMBU_STUDIO_EXE` 定位真实程序，桥接器根据本机配置设置该值。

需要启用严格 X2D 检查器兼容适配时，在 setup 命令增加 `--enable-x2d-compat`。
默认不启用；启用前请阅读 [兼容适配边界](docs/architecture.md)。

启动 MCP 服务：

```powershell
node scripts/server.mjs
```

MCP 客户端可使用以下通用配置，将仓库占位符替换为当前电脑上的绝对路径：

```json
{
  "mcpServers": {
    "bambu_studio_headless_mcp": {
      "command": "node",
      "args": ["<仓库绝对路径>/scripts/server.mjs"]
    }
  }
}
```

服务通过 stdio 提供 MCP，应由 MCP 客户端启动，不会提供网页。也可使用一次性本地调用器：

```powershell
node scripts/call-tool.mjs <工具名> <请求.json>
node scripts/call-tool.mjs --list
```

编写请求前先读取运行中服务提供的工具 schema。
桥接器拒绝设备凭据、可执行文件覆盖、非 Studio 切片器和在线打印机耗材解析；切片始终使用本地配置。
启动器、开放工具和 X2D 兼容适配说明见
[架构和运行边界](docs/architecture.md)。

## X2D 双喷头流程

使用由已安装 Bambu Studio 配置生成的真实 X2D 项目模板。保留其继承和引用的启动、结束及换料 G-code，不替换为 A1 或 H2D 模板。
当前构建器接受单盘、两只 0.4 mm 喷嘴、两个耗材槽，以及分别映射到两个物理喷头的明确手动分配。
继承项目级设置并重新生成部件元数据，不复用源模型涂色或物件级局部覆盖。

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r python/requirements.txt
.venv\Scripts\python.exe examples/make_sample_parts.py --output-dir artifacts/demo
.venv\Scripts\python.exe python/prepare_dual_parts.py --template '<X2D 项目.3mf>' --part1 artifacts/demo/part_1.stl --part2 artifacts/demo/part_2.stl --output artifacts/dual.3mf --filament1 '<PLA.json>' --filament2 '<PLA.json>'
node scripts/call-tool.mjs slice_stl artifacts/dual.mcp.json
.venv\Scripts\python.exe python/verify_dual.py '<切片输出.3mf>'
```

示例生成器创建两个原创的 8 mm 方块，间隔 4 mm；实际任务应替换为自己的 STL 文件。
准备脚本生成新项目、`.mcp.json` 请求旁车文件和 `.receipt.json` 准备记录，拒绝覆盖已有输出；对该请求切片后，使用工具返回的真实输出路径进行验证。
默认布局保留装配关系，只有需要独立摆放的物件才使用 `--layout separate`。

必须明确分配两个耗材槽和物理喷头。AMS 料盘槽位是另一个选择；预览中的两种颜色不能证明两个物理喷头均被使用。
验证器使用 `filament_maps` 将材料槽映射到物理喷头，不单凭 `T` 或 `H` 数值判断物理喷头编号。
完整步骤见 [X2D 准备与验收流程](docs/x2d-workflow.md)。

## 可选建模 Skill

`bambu-studio-ai` 可提供参数化模型、网格分析和预览。上游 GUI 辅助功能和基于 A1 的多色模板本身不构成 X2D 后台流程。
请按 [通用 Skill 集成说明](docs/skill-integration.md)，将所有 Bambu CLI 执行经由隐藏启动器，并将双喷头任务交给 X2D 项目准备流程。
可读取通用代理指引 [`skills/bambu-studio-headless-mcp/SKILL.md`](skills/bambu-studio-headless-mcp/SKILL.md)，或复制到支持的 Skill 目录。
仓库不捆绑或自动安装上游 Skill。

## 限制与验证

- 本项目为**非官方**桥接器，不是 Bambu Studio GUI 的完整后台 API；交互式涂色等仅在界面提供的操作不在范围内。
- 本桥接器不开放打印机控制，也不迁移设备凭据。设备连接和打印机操作不属于本离线安装流程，需要单独的工具、配置及操作者的明确请求。
- 上游 X2D 原生打印助手目前支持 macOS；本项目不会将其变成 Windows 打印助手，也不会退回启动 Bambu Connect。
- 软件检查只证明文件准备和静态检查，不证明打印机在线、实际装载的料盘、喷嘴尺寸或实物打印成功。
- 隐藏桌面避免接管桌面，但仍使用 CPU、内存和图形资源，性能取决于电脑及已安装的 Studio。
- 兼容适配仅面向固定 MCP 版本和已识别的 Studio 输出。未知版本、源码哈希或 G-code 应直接拒绝；升级依赖或 Studio 后需重新本地验收。

在仓库根目录运行内置软件检查：

```powershell
npm test
.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_dual*.py'
powershell -ExecutionPolicy Bypass -File windows/test-launcher.ps1
```

验收新的 Studio 安装时，软件检查之后还应在本机切片一个已知项目。上述检查均不启动打印。

## 隐私与来源

本仓库仅包含源码和通用示例，不捆绑 Bambu Studio、官方系统配置、打印机凭据、本地账户配置或特定机器日志。
生成文件放在 `artifacts/`，本机配置放在 `config/`；分享前请检查文件内容。

感谢 [bambu-printer-mcp](https://github.com/DMontgomery40/bambu-printer-mcp)、
[bambu-studio-ai](https://github.com/heyixuan2/bambu-studio-ai) 和
[Bambu Studio](https://github.com/bambulab/BambuStudio) 的上游作者。
上游软件遵循各自的许可证和条款。本项目不声称与 Bambu Lab 或上述作者存在从属或背书关系。

本仓库代码采用 [`GPL-2.0-only`](LICENSE) 许可证。

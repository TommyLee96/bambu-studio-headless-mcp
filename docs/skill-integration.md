# Optional Skill integration / 可选 Skill 集成

[English README](../README.md) | [中文 README](../README.zh-CN.md)

## Role / 职责

**English.** [bambu-studio-ai](https://github.com/heyixuan2/bambu-studio-ai) is an
optional model-preparation layer. It can create parametric geometry, inspect
and repair meshes, search for model candidates and render previews. Follow its
upstream installation and dependency instructions in a dedicated Python virtual
environment. Review model licenses before using downloaded assets. External AI
providers are optional and have their own credentials and data-sharing terms.
This repository does not bundle or automatically install that upstream Skill.
Its own generic agent policy is available in
[`skills/bambu-studio-headless-mcp/SKILL.md`](../skills/bambu-studio-headless-mcp/SKILL.md); copy it
only into the Skill location supported by the chosen agent client.

**中文。** [bambu-studio-ai](https://github.com/heyixuan2/bambu-studio-ai) 是可选的模型准备层，
可生成参数化几何、检查和修复网格、搜索模型候选并渲染预览。
按上游说明在独立 Python 虚拟环境安装及管理依赖，使用下载模型前检查许可证。
外部 AI 服务是可选项，需自行配置凭据并遵守数据分享条款。
本仓库不捆绑或自动安装上游 Skill。仓库自身的通用代理指引见
[`skills/bambu-studio-headless-mcp/SKILL.md`](../skills/bambu-studio-headless-mcp/SKILL.md)，可复制到所选代理客户端支持的 Skill 目录。

## Background-only contract / 纯后台约定

**English.** A Skill is agent guidance, not process isolation. Every path that
starts Bambu Studio must use this repository's hidden launcher. Configure the
upstream Skill's CLI route to `build/BambuCliHidden.exe` and set
`BAMBU_STUDIO_EXE` to the separately installed real executable. Verify that the
particular upstream version accepts this route before using it. If it does
not, keep the Skill for modelling/analysis/preview and send slicing requests
through this bridge. Do not assume a setting name or copy a private installation
configuration into a public repository.

Use the following policy in local agent instructions:

> Prepare, inspect and slice in the background. Do not send mouse or keyboard
> input, open application windows, invoke Bambu Connect or use GUI open helpers.
> Run every Bambu CLI job through the hidden desktop launcher. If background
> execution fails, inspect the local diagnostics and stop; do not fall back to
> the visible application. Keep credentials in private local configuration.

**中文。** Skill 提供代理操作指引，并不隔离进程。所有启动 Bambu Studio 的路径均须使用本仓库的隐藏启动器。
将上游 Skill 的 CLI 路由配置为 `build/BambuCliHidden.exe`，并将 `BAMBU_STUDIO_EXE` 指向单独安装的真实程序。
使用前验证该上游版本是否支持此路由；若不支持，Skill 只用于建模、分析和预览，切片请求交给本桥接器。
不要猜测配置字段名称，也不要将私有安装配置复制到公开仓库。

本地代理指令可采用以下约定：

> 在后台准备、检查和切片。不发送鼠标或键盘输入，不打开应用窗口，不调用 Bambu Connect 或 GUI 打开辅助功能。
> 所有 Bambu CLI 任务均通过隐藏桌面启动器。后台执行失败时检查本地诊断并停止，不回退到可见应用。
> 凭据保存在私有本机配置中。

## Model to artifact / 从模型到产物

**English.** Establish dimensions, fit, material and part/colour boundaries from
the task. Prefer parametric geometry for exact dimensions. Analyse the resulting
mesh, inspect a rendered preview and use the analysis tool's returned repaired
file when repair was needed. Avoid automatic reorientation of an intentionally
oriented assembly.

For X2D dual-nozzle work, provide two closed STL parts to
[`prepare_dual_parts.py`](../python/prepare_dual_parts.py), then send its
`.mcp.json` sidecar to `slice_stl` and run
[`verify_dual.py`](../python/verify_dual.py) on the actual sliced output. Follow
the [X2D workflow](x2d-workflow.md). Upstream A1-based multi-colour templates must
not replace the X2D machine template. Colour extraction to a model format does
not by itself assign physical nozzles or create a verified print project.

Return the editable source or model, a preview, the prepared project, sliced
artifact and the checks/estimates available. Do not represent software estimates
as a measured physical print result.

**中文。** 根据任务明确尺寸、配合、材料和部件／颜色边界；精确尺寸优先使用参数化几何。
分析生成网格并检查渲染预览，若进行了修复，应使用分析工具返回的修复文件。
对于刻意定向的装配，不要自动更改朝向。

X2D 双喷头任务应将两个封闭 STL 部件交给
[`prepare_dual_parts.py`](../python/prepare_dual_parts.py)，再将生成的 `.mcp.json` 旁车文件交给 `slice_stl`，
对真实切片输出执行 [`verify_dual.py`](../python/verify_dual.py)，步骤见 [X2D 流程](x2d-workflow.md)。
不得以上游基于 A1 的多色模板替换 X2D 机器模板。将颜色提取到模型格式本身并不分配物理喷头，也不构成验证过的打印项目。

交付可编辑源文件或模型、预览、准备项目、切片产物，以及可用的检查结果和估算。
不要将软件估算描述为实测打印结果。

## Printer connection / 打印机连接

**English.** Offline modelling and slicing require no device credentials. Add
device reading only when requested and configured separately. Keep LAN codes,
serials, addresses and cloud secrets out of tracked files, command transcripts
and shared screenshots. Installing either upstream project does not authorize
starting, pausing, uploading, heating or changing a printer. The upstream native
X2D printing helper's macOS support does not establish Windows support.

**中文。** 离线建模和切片不需要设备凭据。只有在收到请求并单独配置后才增加设备读取。
局域网访问码、序列号、地址和云端密钥不得进入跟踪文件、命令记录或共享截图。
安装任一上游项目不代表获得启动、暂停、上传、加热或修改打印机的授权。
上游 X2D 原生打印助手支持 macOS，并不代表支持 Windows。

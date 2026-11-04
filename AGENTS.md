# 项目开发约定

## 运行方式

- 日常改代码：`npm.cmd run dev`（或双击 `start.cmd`），renderer 热更新，main / preload 改动自动重启
- 想用正式窗口但不想打包：双击 `run.cmd`，它先 `npm run build`，再用
  `D:\Plugins\electron-45.0.0\electron.exe` 加载项目目录
- **非必要不打包**：只有版本稳定、要长期使用或分发时才 `npm.cmd run pack`

## 验证

- 每次改完至少跑 `npm.cmd run typecheck`
- 需要看运行时效果时用 `run.cmd` 或 `dev`，不要为了看效果重新打包
- 打包前先退出正在运行的应用，否则文件被占用

## 打包

- 产物必须在工作区外：`D:\Z_UserZYH\Projects\exports\opencode-dui`
  工作区文件带 Low 完整性标签，exe 在里面启动会以 `0x80000003` 退出
- 运行时固定用 `D:/Plugins/electron-45.0.0`（`build.electronDist`），不重新下载
- 产品名变了但 `userData` 固定为 `%APPDATA%\opencode-gui`，不要改，否则本地工作目录记录会丢

## 环境

- Node 在 `D:\Plugins\node24.15.0`，用 `npm.cmd` 而不是 `npm`
- 启动前必须清 `ELECTRON_RUN_AS_NODE`（机器环境默认是 1）
- `.cmd` 文件保持纯 ASCII
- 主进程日志：`%APPDATA%\opencode-gui\boot.log`

## 版本与记录

- 版本号取提交信息里的 `vX.Y.Z`，同时把 `package.json` 的 `version` 改成一样
- 提交前在 `docs/changelog.md` 当前版本下补一条，只写用户可感知的功能变化，不写文档、脚本和本地路径
- 自用项目，不强制打 tag；需要回看时用提交信息里的版本号定位

## 沙箱限制

- DSH 沙箱下 `build` / `pack` 需要完整权限，因为要清 `out/` 和写产物目录
- 用户双击 `start.cmd` / `run.cmd` 不受此限制

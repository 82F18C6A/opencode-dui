# 打包说明

## 命令

```powershell
cd D:\Z_UserZYH\Projects\opencode-dui
npm.cmd run pack
```

输出到：

```
D:\Z_UserZYH\Projects\exports\opencode-dui\win-unpacked\opencode-dui.exe
```

这个目录只是构建输出，装好之后可以随时删掉省空间，下次 `release.cmd` 或
`npm.cmd run pack` 会自动重建。`run.cmd` 不依赖这里的产物，它直接用
`D:\Plugins\electron-45.0.0\electron.exe` 加载项目目录，删掉 exports 也能用。

## 为什么输出到工作区外

工作区里的文件会被标上 Low 完整性标签，生成的 `opencode-dui.exe` 带上这个标签后，
启动会直接以 `0x80000003` 或 `0xc0000005` 退出。所以 `package.json` 里的
`build.directories.output` 指向了工作区外的 `D:\Z_UserZYH\Projects\exports\opencode-dui`
（`Projects` 目录本身不在工作区内，标签是正常的）。

同理，不要把 `win-unpacked` 复制回工作区再运行，也不要在 `tools/exports` 这类
工作区内目录里直接打包。

## 关键配置

- `build.electronDist` 指向 `D:/Plugins/electron-45.0.0`，打包时直接复制这份运行时，不重新下载
- `build.win.signAndEditExecutable: false`，跳过签名和图标编辑，自用够了
- `app.setPath('userData', ...)` 在 `src/main/index.ts` 里固定到 `%APPDATA%\opencode-gui`，
  这样打包后产品名变了，本地登记的工作目录和日志也不会丢
- 主进程仍然通过 `Service.discover()` 复用官方桌面版已经启动的服务；退出时只停自己拉起的

## 正式安装位置

```
D:\Softwares-self\opencode-dui
```

`release.cmd` 一个脚本同时负责首次安装和后续更新：构建 → 打包 → 把
`win-unpacked` 镜像到该目录 → 创建桌面快捷方式。

## 更新流程

1. 改完代码，确认 `npm.cmd run typecheck` 通过
2. 需要发版时先改 `package.json` 的 `version`
3. 退出正在运行的应用（`release.cmd` 会先检测，占用时直接退出）
4. 双击 `release.cmd`
5. 从桌面快捷方式启动 `opencode-dui.exe`

应用数据固定在 `%APPDATA%\opencode-gui`，覆盖安装不会丢工作目录记录和日志。

`robocopy /MIR` 是镜像复制：安装目录里多出来的文件会被删除，所以不要往
`D:\Softwares-self\opencode-dui` 里放个人文件。不想建桌面快捷方式时，把
`release.cmd` 里的 `CREATE_SHORTCUT` 改成 `0`。

## 后续可选

- 体积约 413 MB，其中 `app.asar` 约 57 MB，主要来自被算作生产依赖的 `vite-plugin-solid`
  及其 babel 依赖。把 `vite-plugin-solid` 移到 `devDependencies` 可以显著缩小
- 需要单文件或安装器时，把 `build.win.target` 换成 `portable` 或 `nsis`
- 需要图标时，在 `build/` 放 `icon.ico` 并去掉 `signAndEditExecutable: false`

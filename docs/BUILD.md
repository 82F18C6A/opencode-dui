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

## 更新流程

1. 先退出正在运行的应用（否则文件被占用，electron-builder 清不掉输出目录）
2. `npm.cmd run pack`
3. 双击 `D:\Z_UserZYH\Projects\exports\opencode-dui\win-unpacked\opencode-dui.exe`

## 后续可选

- 体积约 413 MB，其中 `app.asar` 约 57 MB，主要来自被算作生产依赖的 `vite-plugin-solid`
  及其 babel 依赖。把 `vite-plugin-solid` 移到 `devDependencies` 可以显著缩小
- 需要单文件或安装器时，把 `build.win.target` 换成 `portable` 或 `nsis`
- 需要图标时，在 `build/` 放 `icon.ico` 并去掉 `signAndEditExecutable: false`

# opencode-dui

自建的 opencode 桌面前端：只替换 UI 层，模型请求仍由官方 `opencode-cli` 服务发出。

## 目录结构

```
demo/     Electron + SolidJS 工程（package.json、src、构建产物）
docs/     设计、计划、打包与更新记录
tools/    本地启动、预览、发版脚本
```

## 开发

```powershell
cd demo
npm install
npm run dev
```

渲染层支持热更新，main / preload 改动会自动重启。

## 构建与预览

```powershell
cd demo
npm run build
```

Windows 下可以双击 `tools\run.cmd`：先构建，再用本机 Electron 运行时加载 `demo` 目录，不需要每次打包。

## 打包

```powershell
cd demo
npm run pack
```

产物输出到 `demo` 之外，避免工作区的完整性标签影响可执行文件。

## 文档

- [更新记录](docs/changelog.md)

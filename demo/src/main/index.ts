import { app, BrowserWindow, dialog, ipcMain, session, shell, type OpenDialogOptions } from 'electron'
import { appendFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Service } from '@opencode/client/service'

/**
 * 阶段 1b：主进程发现/拉起服务，渲染层是自建的 SolidJS 界面
 */

// 用户数据目录固定为 opencode-dui；首次启动时从旧的 opencode-gui 目录迁移一次
const appDataDir = app.getPath('appData')
const userDataDir = join(appDataDir, 'opencode-dui')
const legacyUserDataDir = join(appDataDir, 'opencode-gui')
if (!existsSync(userDataDir) && existsSync(legacyUserDataDir)) {
  try {
    cpSync(legacyUserDataDir, userDataDir, { recursive: true })
  } catch {
    // 迁移失败时仍用新目录，不影响启动
  }
}
app.setPath('userData', userDataDir)

// 主进程 stdout 在 Windows GUI 下不可见，日志落到文件
let logFile = ''
function log(...parts: unknown[]): void {
  const line = parts
    .map((p) => (p instanceof Error ? `${p.message}\n${p.stack ?? ''}` : String(p)))
    .join(' ')
  try {
    if (!logFile) {
      logFile = join(app.getPath('userData'), 'boot.log')
      mkdirSync(dirname(logFile), { recursive: true })
    }
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // 日志失败不影响主流程
  }
}

type EndpointInfo = { url: string; headers: Record<string, string> }

// opencode-cli 的候选路径，设置项优先
const CLI_CANDIDATES = [
  process.env.OPENCODE_CLI_PATH,
  'C:\\Users\\gf09\\AppData\\Local\\Programs\\@opencode-aidesktop\\resources\\opencode-cli.exe',
].filter((value): value is string => Boolean(value))

const PARTITION = 'persist:opencode'

let mainWindow: BrowserWindow | null = null
let ownedService = false
let quitting = false
let endpointInfo: EndpointInfo | null = null

/** 找出第一个存在的 CLI 路径 */
function resolveCli(): string {
  for (const candidate of CLI_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('找不到 opencode-cli.exe，请用 OPENCODE_CLI_PATH 指定路径')
}

// 官方桌面版更新接口
const OFFICIAL_UPDATE_API = 'https://opencode.ai/update/api/latest/desktop/opencode/'
const OFFICIAL_DOWNLOAD_PAGE = 'https://opencode.ai/download'

type OfficialUpdate = {
  current: string
  latest: string
  url: string
  sha256: string
}

/** 读取 CLI 同目录的版本文件 */
function readCliVersion(cliPath: string): string | null {
  try {
    return readFileSync(join(dirname(cliPath), 'opencode-cli.version'), 'utf8').trim()
  } catch {
    return null
  }
}

/** 比较 x.y.z 版本号 */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number(part) || 0)
  const right = b.split('.').map((part) => Number(part) || 0)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 检查官方 opencode 是否有新版本 */
async function checkOfficialUpdate(): Promise<OfficialUpdate | null> {
  if (process.platform !== 'win32') return null
  let cli: string
  try {
    cli = resolveCli()
  } catch {
    return null
  }
  const current = readCliVersion(cli)
  if (!current) return null

  try {
    const response = await fetch(OFFICIAL_UPDATE_API)
    if (!response.ok) return null
    const data: any = await response.json()
    const latest = String(data?.version ?? '')
    const file = data?.metadata?.files?.['opencode-desktop-win-x64.exe']
    if (!latest || !file?.url) return null
    if (compareVersions(latest, current) <= 0) return null
    return { current, latest, url: String(file.url), sha256: String(file.sha256 ?? '') }
  } catch {
    return null
  }
}

/** 下载官方安装包，校验后启动安装程序 */
async function downloadOfficialUpdate(
  url: string,
  sha256: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const target = join(app.getPath('temp'), 'opencode-update.exe')
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`下载失败：${response.status}`)

  const total = Number(response.headers.get('content-length') ?? 0)
  let received = 0
  let lastPercent = -1
  let lastSentAt = 0
  const hash = createHash('sha256')
  const tap = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      hash.update(chunk)
      if (total > 0) {
        const percent = Math.min(100, Math.floor((received / total) * 100))
        const now = Date.now()
        if (percent !== lastPercent && (percent === 100 || now - lastSentAt > 200)) {
          lastPercent = percent
          lastSentAt = now
          onProgress?.(percent)
        }
      }
      callback(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body as never), tap, createWriteStream(target))

  if (sha256 && hash.digest('hex').toLowerCase() !== sha256.toLowerCase()) {
    throw new Error('安装包校验失败')
  }

  onProgress?.(100)
  await shell.openPath(target)
  return target
}

/** 把 Service.headers 的返回值统一成普通对象 */
function toHeaderRecord(endpoint: unknown): Record<string, string> {
  const headers = Service.headers(endpoint as never)
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  return headers as Record<string, string>
}

/** 发现已有服务则复用，否则拉起一个并标记所有权 */
async function boot(): Promise<void> {
  log('[boot] discovering service...')
  const found = await Service.discover()
  log('[boot] discover:', found ? found.url : 'none')

  const endpoint = found ?? (await Service.ensure({ command: [resolveCli(), 'serve', '--service'] }))
  log('[boot] endpoint:', endpoint.url, 'owned:', !found)

  ownedService = !found
  endpointInfo = { url: endpoint.url, headers: toHeaderRecord(endpoint) }

  const ses = session.fromPartition(PARTITION)
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith(endpoint.url) && endpointInfo) {
      callback({ requestHeaders: { ...details.requestHeaders, ...endpointInfo.headers } })
    } else {
      callback({ requestHeaders: details.requestHeaders })
    }
  })

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'opencode',
    backgroundColor: '#eef3ff',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      partition: PARTITION,
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  log('[boot] window created')

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  log('[boot] renderer loaded')

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('opencode:endpoint', () => endpointInfo)

// 新建工作目录时选一个本地目录
ipcMain.handle('opencode:pick-directory', async (_event, defaultPath?: string) => {
  const options: OpenDialogOptions = {
    properties: ['openDirectory'],
    defaultPath: defaultPath || undefined,
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled) return null
  return result.filePaths[0] ?? null
})

// 用系统浏览器打开链接
ipcMain.handle('opencode:open-external', async (_event, url: string) => {
  if (!/^https?:\/\//i.test(url)) return
  await shell.openExternal(url)
})

// 用系统程序打开本地文件
ipcMain.handle('opencode:open-path', async (_event, path: string) => {
  if (!path) return
  await shell.openPath(path)
})

// 预览 HTML：写入临时文件后用系统浏览器打开
ipcMain.handle('opencode:preview-html', async (_event, html: string) => {
  if (typeof html !== 'string' || !html.trim()) return
  const file = join(app.getPath('temp'), 'opencode-dui-preview.html')
  writeFileSync(file, html, 'utf8')
  await shell.openPath(file)
})

// 检查官方 opencode 更新
ipcMain.handle('opencode:check-update', () => checkOfficialUpdate())

// 下载官方安装包并启动安装程序
ipcMain.handle('opencode:download-update', (event, url: string, sha256: string) =>
  downloadOfficialUpdate(url, sha256, (percent) => {
    event.sender.send('opencode:download-progress', percent)
  }),
)

// 打开官方下载页
ipcMain.handle('opencode:open-update-page', () => shell.openExternal(OFFICIAL_DOWNLOAD_PAGE))

app.whenReady().then(() => {
  log('[boot] app ready')
  boot().catch((error: unknown) => {
    log('[boot] failed:', error)
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('启动失败', message)
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      boot().catch(() => {})
    }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

// 只停自己启动的服务，复用别人的不碰
app.on('before-quit', (event) => {
  log('[quit] owned:', ownedService, 'quitting:', quitting)
  if (quitting || !ownedService) return
  event.preventDefault()
  quitting = true
  Service.stop()
    .catch(() => {})
    .finally(() => app.quit())
})

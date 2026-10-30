import { app, BrowserWindow, dialog, ipcMain, session, type OpenDialogOptions } from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Service } from '@opencode/client/service'

/**
 * 阶段 1b：主进程发现/拉起服务，渲染层是自建的 SolidJS 界面
 */

// 固定用户数据目录，避免打包后本地工作目录记录随 app 名变化而丢失
app.setPath('userData', join(app.getPath('appData'), 'opencode-gui'))

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
    backgroundColor: '#f7f7f9',
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

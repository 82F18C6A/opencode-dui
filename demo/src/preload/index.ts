import { contextBridge, ipcRenderer } from 'electron'

export type OpenCodeEndpoint = {
  url: string
  headers: Record<string, string>
}

// 凭证只在主进程与这里出现，渲染层不接触文件系统
contextBridge.exposeInMainWorld('opencode', {
  getEndpoint: (): Promise<OpenCodeEndpoint> => ipcRenderer.invoke('opencode:endpoint'),
  pickDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('opencode:pick-directory', defaultPath),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('opencode:open-external', url),
  openPath: (path: string): Promise<void> => ipcRenderer.invoke('opencode:open-path', path),
  previewHtml: (html: string): Promise<void> => ipcRenderer.invoke('opencode:preview-html', html),
})

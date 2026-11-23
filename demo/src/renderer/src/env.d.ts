export {}

declare global {
  interface Window {
    opencode: {
      getEndpoint(): Promise<{ url: string; headers: Record<string, string> } | null>
      pickDirectory(defaultPath?: string): Promise<string | null>
      openExternal(url: string): Promise<void>
      openPath(path: string): Promise<void>
      previewHtml(html: string): Promise<void>
      checkUpdate(): Promise<{
        current: string
        latest: string
        url: string
        sha256: string
      } | null>
      downloadUpdate(url: string, sha256: string): Promise<string>
      onDownloadProgress(callback: (percent: number) => void): () => void
      openUpdatePage(): Promise<void>
    }
  }
}

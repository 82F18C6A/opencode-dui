export {}

declare global {
  interface Window {
    opencode: {
      getEndpoint(): Promise<{ url: string; headers: Record<string, string> } | null>
      pickDirectory(defaultPath?: string): Promise<string | null>
      openExternal(url: string): Promise<void>
      openPath(path: string): Promise<void>
      previewHtml(html: string): Promise<void>
    }
  }
}

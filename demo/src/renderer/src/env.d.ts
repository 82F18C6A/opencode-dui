export {}

declare global {
  interface Window {
    opencode: {
      getEndpoint(): Promise<{ url: string; headers: Record<string, string> } | null>
      pickDirectory(defaultPath?: string): Promise<string | null>
    }
  }
}

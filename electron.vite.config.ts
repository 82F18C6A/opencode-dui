import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  main: {
    // @opencode/client 是 ESM 包，打进 bundle 避免 CJS require 的问题
    plugins: [externalizeDepsPlugin({ exclude: ['@opencode/client'] })],
  },
  preload: {},
  renderer: {
    plugins: [solid()],
  },
})

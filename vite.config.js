import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { localAIPlugin } from './server/localAI.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), localAIPlugin(loadEnv(mode, process.cwd(), 'VITE_'))],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        }
      }
    }
  }
}))

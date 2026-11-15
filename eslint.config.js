import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // These run in Node (the Vite config, the local AI middleware and the tests), not the browser.
    files: ['vite.config.js', 'playwright.config.js', 'server/**/*.js', 'tests/**/*.js', 'e2e/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])

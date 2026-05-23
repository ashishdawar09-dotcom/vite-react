import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Rules below are downgraded to "warn" to ship the pre-commit lint
      // hook on a codebase that has legacy debt. They are NOT off — they
      // surface in `npm run lint` and CI output — but they no longer block
      // a commit. Tracked as P3 cleanup:
      //   - @typescript-eslint/no-explicit-any (36 legacy `: any` / `as any`)
      //   - react-hooks v7 strict rules added recently (set-state-in-effect,
      //     purity, exhaustive-deps) flag patterns that may be valid here
      //   - react-refresh/only-export-components fires on main.tsx lazy()
      //     definitions that are co-located with router setup intentionally
      //   - no-empty-pattern / no-useless-escape on a few legacy spots
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/refs': 'warn',
      'no-useless-assignment': 'warn',
      'react-refresh/only-export-components': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty-pattern': 'warn',
      'no-useless-escape': 'warn',
      'no-empty': 'warn',
    },
  },
])

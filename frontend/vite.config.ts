import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import obfuscator from 'vite-plugin-javascript-obfuscator'

// The Logcat visual map is PROPRIETARY. Wails embeds the compiled frontend JS into
// the release binary (//go:embed all:frontend/dist), so without this the map's logic
// would ship in readable form. We obfuscate ONLY the map files (engine + renderers),
// and only in production builds (`apply: 'build'`, so `wails dev` stays debuggable).
// Settings are deliberately moderate: NO control-flow-flattening / self-defending
// (would wreck the 60fps render loop) and NO transformObjectKeys (the GraphConfig
// object is accessed across files — renaming its keys would break the app). What we
// DO get: local identifiers renamed + every string literal encoded into a base64
// string-array, so the algorithms aren't human-readable in the shipped bundle.
const MAP_FILES = [
  'src/lib/logcatgraph.ts',
  'src/components/views/LogcatMap.tsx',
]

export default defineConfig({
  plugins: [
    react(),
    obfuscator({
      apply: 'build',
      include: MAP_FILES,
      exclude: [/node_modules/],
      options: {
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        selfDefending: false,
        renameGlobals: false,
        transformObjectKeys: false,
        identifierNamesGenerator: 'hexadecimal',
        numbersToExpressions: true,
        simplify: true,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 1,   // encode EVERY string (deterministic; no stray plaintext labels)
        splitStrings: true,
        splitStringsChunkLength: 8,
        unicodeEscapeSequence: false,
      },
    }),
  ],
  build: {
    outDir: 'dist',
  },
})

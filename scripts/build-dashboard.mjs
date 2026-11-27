import { build } from 'esbuild'

const dev = process.argv.includes('--dev')

await build({
  entryPoints: ['dashboard/main.ts'],
  bundle: true,
  outfile: 'public/app.js',
  format: 'iife',
  target: ['chrome100', 'safari15', 'firefox100'],
  sourcemap: true,
  minify: !dev,
  legalComments: 'none',
  logLevel: 'info',
})

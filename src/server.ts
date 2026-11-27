#!/usr/bin/env node
import { createApp } from './relay/server.js'
import { dashboardUrl } from './relay/config.js'

interface CliOptions {
  mock: boolean
  dev: boolean
  host?: string
  port?: number
  dataDir?: string
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { mock: false, dev: false }
  for (const arg of argv) {
    if (arg === '--mock') options.mock = true
    else if (arg === '--dev') options.dev = true
    else if (arg.startsWith('--host=')) options.host = arg.slice('--host='.length)
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice('--port='.length))
    else if (arg.startsWith('--data-dir=')) options.dataDir = arg.slice('--data-dir='.length)
    else if (arg === '--help' || arg === '-h') {
      console.log(`Xbox Local Hub - relay

Uso:
  npm run dev                 inicia com reload (dashboard + API)
  npm run mock                inicia em modo simulado (sem Xbox)
  npm start -- [opções]

Opções:
  --mock                      usa o console simulado e autenticação fake
  --dev                       logs detalhados e cache desativado
  --host=0.0.0.0              expõe na rede local (gera token de acesso)
  --port=8787                 porta HTTP
  --data-dir=/caminho         diretório de tokens, logs e jogadores
`)
      process.exit(0)
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
const app = await createApp({
  mock: options.mock,
  dev: options.dev,
  host: options.host,
  port: options.port,
  dataDir: options.dataDir,
})

const { url } = await app.listen()
console.log('')
console.log('  Xbox Local Hub — relay')
console.log(`  Dashboard: ${dashboardUrl(app.config)}`)
console.log(`  Health:    ${url}/api/health`)
if (app.config.mock) {
  console.log('  MODO MOCK: nenhum console Xbox real será contatado.')
}
if (app.config.accessToken) {
  console.log('  Token de acesso exigido para a API (já incluído na URL do dashboard).')
}
console.log('')

let closing = false
const shutdown = async (signal: string): Promise<void> => {
  if (closing) return
  closing = true
  console.log(`\nEncerrando (${signal})...`)
  try {
    await app.close()
  } finally {
    process.exit(0)
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

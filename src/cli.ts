#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AuthService } from './relay/auth-service.js'
import { loadConfig } from './relay/config.js'
import { DiscoveryService } from './relay/discovery-service.js'
import { Logger } from './core/logger.js'
import { fetchConsoleList } from './core/xbox/console-list.js'

const command = process.argv[2] ?? 'help'
const json = process.argv.includes('--json')
const config = loadConfig()
const logger = new Logger({ filePath: config.logFile })

function print(value: unknown): void {
  if (json) console.log(JSON.stringify(value, null, 2))
  else console.log(value)
}

async function auth(): Promise<void> {
  const service = new AuthService(config.authFile, logger.child('auth'))
  if (service.getStatus().authenticated) {
    console.log('Já autenticado. Use o dashboard ou remova', config.authFile, 'para refazer.')
    return
  }
  const status = await service.beginDeviceCode()
  console.log('')
  console.log('Abra:', status.challenge?.verificationUri)
  console.log('Código:', status.challenge?.userCode)
  console.log('')
  console.log('Aguardando autenticação...')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tempo esgotado')), 15 * 60 * 1000)
    service.on('status', (next: { authenticated: boolean; error?: string }) => {
      if (next.authenticated) {
        clearTimeout(timer)
        resolve()
      } else if (next.error) {
        clearTimeout(timer)
        reject(new Error(next.error))
      }
    })
  })
  console.log('Autenticado. Tokens salvos em', config.authFile)
}

async function discover(): Promise<void> {
  const service = new DiscoveryService(logger.child('discovery'))
  const result = await service.scan({ timeoutMs: 3000, tries: 2 })
  if (json) return print(result)
  if (result.consoles.length === 0) {
    console.log('Nenhum console respondeu à descoberta SmartGlass.')
    console.log('Alvos testados:', result.targets.join(', '))
    console.log('Erros:', result.errors.length ? result.errors.join('; ') : 'nenhum')
    return
  }
  for (const entry of result.consoles) {
    console.log(`- ${entry.name}  ${entry.address}  uuid=${entry.uuid}`)
  }
}

async function consoles(): Promise<void> {
  const service = new AuthService(config.authFile, logger.child('auth'))
  if (!service.getStatus().authenticated) {
    console.error('Não autenticado. Execute: npm run auth')
    process.exit(2)
  }
  const tokens = await service.getSessionTokens()
  const list = await fetchConsoleList(tokens.webToken)
  print(list.map(({ id, name, powerState, consoleType }) => ({ id, name, powerState, consoleType })))
}

async function doctor(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  checks.push({
    name: 'Node.js',
    ok: Number(process.versions.node.split('.')[0]) >= 20,
    detail: process.versions.node,
  })
  checks.push({
    name: 'Dashboard compilado',
    ok: existsSync(join(config.publicDir, 'app.js')),
    detail: join(config.publicDir, 'app.js'),
  })
  checks.push({
    name: 'Token Microsoft',
    ok: existsSync(config.authFile),
    detail: config.authFile,
  })
  const service = new DiscoveryService(logger.child('discovery'))
  const scan = await service.scan({ timeoutMs: 2000 })
  checks.push({
    name: 'Descoberta SmartGlass',
    ok: scan.consoles.length > 0,
    detail: scan.consoles.length
      ? scan.consoles.map((entry) => `${entry.name}@${entry.address}`).join(', ')
      : `nenhum console (${scan.errors[0] ?? 'sem resposta'})`,
  })
  if (json) return print(checks)
  for (const check of checks) {
    console.log(`${check.ok ? 'OK  ' : 'AVISO'} ${check.name}: ${check.detail}`)
  }
}

async function main(): Promise<void> {
  switch (command) {
    case 'auth':
      return auth()
    case 'discover':
      return discover()
    case 'consoles':
      return consoles()
    case 'doctor':
      return doctor()
    default:
      console.log(`Comandos: auth | discover | consoles | doctor
Use --json para saída estruturada.`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

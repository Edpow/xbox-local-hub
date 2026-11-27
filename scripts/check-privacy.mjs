#!/usr/bin/env node
/**
 * Blocks accidental publication of personal data in tracked text files.
 *
 * Add local, never-committed terms (real name, gamertag, serial numbers) to
 * `.privacy-denylist`, one per line. The file is gitignored.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const SKIP_FILES = new Set(['package-lock.json', 'apps/android/package-lock.json'])
const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|apk|aab|jar|zip|gz|woff2?|ttf|otf)$/i

const RULES = [
  {
    name: 'caminho absoluto de usuário',
    re: /\/(?:home|Users)\/(?!:)[^/\s"'`]+\//g,
  },
  {
    name: 'caminho Windows de usuário',
    re: /[A-Za-z]:\\Users\\[^\\\s"'`]+\\/g,
  },
  {
    name: 'e-mail pessoal',
    re: /[A-Za-z0-9._%+-]+@(?:gmail|outlook|hotmail|live|yahoo|icloud|protonmail|uol|bol)\.[A-Za-z]{2,}/gi,
  },
  {
    name: 'serverId de console (14 hex)',
    re: /\b[0-9A-F]{14}\b/g,
  },
]

function loadDenylist() {
  if (!existsSync('.privacy-denylist')) return []
  return readFileSync('.privacy-denylist', 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((term) => ({
      name: `termo local (${term.slice(0, 2)}…)`,
      re: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
    }))
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

const rules = [...RULES, ...loadDenylist()]
const findings = []

for (const file of files) {
  if (SKIP_FILES.has(file) || SKIP_EXTENSIONS.test(file)) continue
  if (file.startsWith('dist/') || file.startsWith('public/app.js')) continue
  if (!existsSync(file)) continue

  const text = readFileSync(file, 'utf8')
  if (text.includes('\0')) continue

  for (const rule of rules) {
    for (const match of text.matchAll(rule.re)) {
      const value = match[0]
      findings.push({
        file,
        line: lineOf(text, match.index ?? 0),
        rule: rule.name,
        sample: value.length > 12 ? `${value.slice(0, 6)}…` : value,
      })
    }
  }
}

if (findings.length === 0) {
  console.log('Privacidade: nenhum dado pessoal encontrado nos arquivos versionados.')
  process.exit(0)
}

console.error(`Privacidade: ${findings.length} ocorrência(s) para remover antes do commit:`)
for (const item of findings) {
  console.error(`  ${item.file}:${item.line}  ${item.rule}  ${item.sample}`)
}
console.error('\nUse placeholders (<serverId>, <sessionId>, 192.168.1.x, $HOME) e tarje capturas.')
console.error('Para termos específicos, crie .privacy-denylist (gitignored) com um termo por linha.')
process.exit(1)

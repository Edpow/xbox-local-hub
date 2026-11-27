import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PlayerManager } from '../src/core/player-manager.js'

const dirs: string[] = []

function manager(): { manager: PlayerManager; file: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'xlh-players-'))
  dirs.push(dir)
  const file = join(dir, 'players.json')
  return { manager: new PlayerManager(file), file, dir }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('PlayerManager (P1..P4)', () => {
  it('assigns up to four players and persists them', () => {
    const { manager: players, file } = manager()
    players.assign({ slot: 0, controllerId: 'web:0', controllerName: 'Controle 1', source: 'web' })
    players.assign({ slot: 1, controllerId: 'web:1', controllerName: 'Controle 2', source: 'web' })
    players.assign({ slot: 3, controllerId: 'native:2', controllerName: 'Controle 4', source: 'native' })

    const snapshot = players.snapshot()
    expect(snapshot.assignments).toHaveLength(3)
    expect(snapshot.slots[0]?.controllerName).toBe('Controle 1')
    expect(snapshot.slots[2]).toBeNull()

    const reloaded = new PlayerManager(file).snapshot()
    expect(reloaded.assignments.map((entry) => entry.controllerId)).toEqual([
      'web:0',
      'web:1',
      'native:2',
    ])
  })

  it('prevents one controller from owning two slots', () => {
    const { manager: players } = manager()
    players.assign({ slot: 0, controllerId: 'web:0', controllerName: 'Pad' })
    expect(() =>
      players.assign({ slot: 1, controllerId: 'web:0', controllerName: 'Pad' }),
    ).toThrow(/já associado ao P1/)
    expect(players.snapshot().slots[1]).toBeNull()
  })

  it('replaces the controller in a slot and can unassign/reset', () => {
    const { manager: players } = manager()
    players.assign({ slot: 0, controllerId: 'a', controllerName: 'A' })
    players.assign({ slot: 0, controllerId: 'b', controllerName: 'B' })
    expect(players.snapshot().slots[0]?.controllerId).toBe('b')
    players.unassign(0)
    expect(players.snapshot().slots[0]).toBeNull()
    players.assign({ slot: 2, controllerId: 'c', controllerName: 'C' })
    players.reset()
    expect(players.snapshot().assignments).toEqual([])
  })

  it('rejects invalid slots and empty ids', () => {
    const { manager: players } = manager()
    expect(() => players.assign({ slot: 4, controllerId: 'x' })).toThrow(/Slot inválido/)
    expect(() => players.assign({ slot: -1, controllerId: 'x' })).toThrow(/Slot inválido/)
    expect(() => players.assign({ slot: 0, controllerId: '  ' })).toThrow(/controllerId/)
    expect(() => players.unassign(9)).toThrow(/Slot inválido/)
  })

  it('ignores a corrupted persistence file', () => {
    const { file, dir } = manager()
    writeFileSync(file, '{not json', 'utf8')
    const reloaded = new PlayerManager(file)
    expect(reloaded.snapshot().assignments).toEqual([])
    expect(dir).toBeTruthy()
  })
})

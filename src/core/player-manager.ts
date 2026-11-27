import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isPlayerIndex, PLAYER_SLOTS, type PlayerIndex } from './gamepad.js'

export interface PlayerAssignment {
  slot: PlayerIndex
  /** Stable controller id: Android device id, Web Gamepad id or native bridge id. */
  controllerId: string
  controllerName: string
  source: 'web' | 'native' | 'manual'
  assignedAt: string
}

export interface PlayerSnapshot {
  slots: Array<PlayerAssignment | null>
  assignments: PlayerAssignment[]
}

/**
 * P1..P4 manager. One controller can only own one slot, which is the main
 * invariant required by the spec ("evitar associações duplicadas").
 */
export class PlayerManager {
  private slots: Array<PlayerAssignment | null> = Array.from({ length: PLAYER_SLOTS }, () => null)

  constructor(private readonly filePath: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(raw)) return
      for (const item of raw.slice(0, PLAYER_SLOTS)) {
        if (!item || typeof item !== 'object') continue
        const candidate = item as Partial<PlayerAssignment>
        if (
          typeof candidate.slot === 'number' &&
          isPlayerIndex(candidate.slot) &&
          typeof candidate.controllerId === 'string' &&
          candidate.controllerId &&
          typeof candidate.controllerName === 'string'
        ) {
          this.slots[candidate.slot] = {
            slot: candidate.slot,
            controllerId: candidate.controllerId,
            controllerName: candidate.controllerName,
            source:
              candidate.source === 'web' || candidate.source === 'native'
                ? candidate.source
                : 'manual',
            assignedAt:
              typeof candidate.assignedAt === 'string'
                ? candidate.assignedAt
                : new Date().toISOString(),
          }
        }
      }
    } catch {
      // Corrupted state must not prevent the relay from booting.
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    writeFileSync(temp, JSON.stringify(this.snapshot().assignments, null, 2), { mode: 0o600 })
    renameSync(temp, this.filePath)
  }

  assign(input: {
    slot: number
    controllerId: string
    controllerName?: string
    source?: PlayerAssignment['source']
  }): PlayerSnapshot {
    if (!isPlayerIndex(input.slot)) throw new Error('Slot inválido (use 1 a 4)')
    const controllerId = input.controllerId?.trim()
    if (!controllerId) throw new Error('controllerId obrigatório')

    for (const existing of this.slots) {
      if (existing && existing.controllerId === controllerId && existing.slot !== input.slot) {
        throw new Error(
          `Controle já associado ao P${existing.slot + 1}; remova a associação antes de mover.`,
        )
      }
    }

    this.slots[input.slot] = {
      slot: input.slot,
      controllerId,
      controllerName: input.controllerName?.trim() || controllerId,
      source: input.source ?? 'manual',
      assignedAt: new Date().toISOString(),
    }
    this.persist()
    return this.snapshot()
  }

  unassign(slot: number): PlayerSnapshot {
    if (!isPlayerIndex(slot)) throw new Error('Slot inválido (use 1 a 4)')
    this.slots[slot] = null
    this.persist()
    return this.snapshot()
  }

  reset(): PlayerSnapshot {
    this.slots = Array.from({ length: PLAYER_SLOTS }, () => null)
    this.persist()
    return this.snapshot()
  }

  findByController(controllerId: string): PlayerAssignment | null {
    return this.slots.find((entry) => entry?.controllerId === controllerId) ?? null
  }

  snapshot(): PlayerSnapshot {
    return {
      slots: this.slots.map((entry) => (entry ? { ...entry } : null)),
      assignments: this.slots.filter((entry): entry is PlayerAssignment => entry !== null),
    }
  }
}

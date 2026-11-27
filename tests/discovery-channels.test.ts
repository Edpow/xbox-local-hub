import { describe, expect, it } from 'vitest'
import {
  DiscoveryClientType,
  PacketType,
  decodeDiscoveryResponse,
  encodeDiscoveryRequest,
} from '../src/core/discovery.js'
import {
  authorizationRequestMessage,
  gamepadChangedMessage,
  handshakeMessage,
  streamingConfigMessages,
} from '../src/core/channels.js'

function sgString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.alloc(2)
  length.writeUInt16BE(bytes.length)
  return Buffer.concat([length, bytes, Buffer.from([0])])
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16BE(value)
  return buffer
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

describe('SmartGlass discovery codec', () => {
  it('builds a valid discovery request for Android', () => {
    const request = encodeDiscoveryRequest()
    expect(request.length).toBe(16)
    expect(request.readUInt16BE(0)).toBe(PacketType.DiscoveryRequest)
    expect(request.readUInt16BE(2)).toBe(10)
    expect(request.readUInt16BE(4)).toBe(2)
    expect(request.readUInt32BE(6)).toBe(0)
    expect(request.readUInt16BE(10)).toBe(DiscoveryClientType.Android)
    expect(request.readUInt16BE(12)).toBe(0)
    expect(request.readUInt16BE(14)).toBe(2)
  })

  it('parses a discovery response', () => {
    const cert = Buffer.from([0x30, 0x03, 0x01, 0x02, 0x03])
    const payload = Buffer.concat([
      u32(2),
      u16(1),
      sgString('XboxOne'),
      sgString('DE305D54-75B4-431B-ADB2-EB6B9E546014'),
      u32(0),
      u16(cert.length),
      cert,
    ])
    const header = Buffer.concat([u16(PacketType.DiscoveryResponse), u16(payload.length), u16(2)])
    const response = decodeDiscoveryResponse(Buffer.concat([header, payload]), '192.168.1.50')
    expect(response).toMatchObject({
      address: '192.168.1.50',
      packetType: PacketType.DiscoveryResponse,
      version: 2,
      flags: 2,
      clientType: 1,
      name: 'XboxOne',
      uuid: 'DE305D54-75B4-431B-ADB2-EB6B9E546014',
      lastError: 0,
      certificatePresent: true,
    })
  })

  it('rejects non-discovery packets and truncated payloads', () => {
    const wrong = Buffer.alloc(16)
    wrong.writeUInt16BE(PacketType.Message, 0)
    expect(() => decodeDiscoveryResponse(wrong, '1.1.1.1')).toThrow(/Not a discovery/)

    const header = Buffer.concat([u16(PacketType.DiscoveryResponse), u16(20), u16(2)])
    expect(() => decodeDiscoveryResponse(Buffer.concat([header, Buffer.alloc(4)]), '1.1.1.1')).toThrow(
      /exceeds datagram/,
    )
  })
})

describe('data channel messages', () => {
  it('matches the reference authorization message', () => {
    expect(JSON.parse(authorizationRequestMessage())).toEqual({
      message: 'authorizationRequest',
      accessKey: '4BDB3609-C1F1-4195-9B37-FEFF45DA8B8E',
    })
  })

  it('registers and unregisters distinct gamepad slots', () => {
    expect(JSON.parse(gamepadChangedMessage(3, true))).toEqual({
      message: 'gamepadChanged',
      gamepadIndex: 3,
      wasAdded: true,
    })
    expect(JSON.parse(gamepadChangedMessage(1, false))).toEqual({
      message: 'gamepadChanged',
      gamepadIndex: 1,
      wasAdded: false,
    })
  })

  it('sends the messageV1 handshake', () => {
    expect(JSON.parse(handshakeMessage('abc'))).toEqual({
      type: 'Handshake',
      version: 'messageV1',
      id: 'abc',
      cv: '0',
    })
  })

  it('advertises a screen so the console can lay out its UI', () => {
    let counter = 0
    const messages = streamingConfigMessages(() => `id-${++counter}`)
    expect(messages).toHaveLength(6)
    const dimensions = JSON.parse(
      JSON.parse(messages[5] as string).content as string,
    ) as Record<string, unknown>
    expect(dimensions).toMatchObject({
      horizontal: 1280,
      vertical: 720,
      preferredWidth: 1280,
      preferredHeight: 720,
    })
  })
})

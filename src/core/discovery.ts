/**
 * SmartGlass LAN discovery (UDP 5050).
 *
 * Packet format from xbox-smartglass-core-python (`xbox/sg/packet/simple.py`):
 *   header (6 bytes): packet type u16 BE (0xDD00 request / 0xDD01 response),
 *                     unprotected payload length u16 BE, version u16 BE
 *   discovery request payload: flags u32 BE, client type u16 BE,
 *                              min version u16 BE, max version u16 BE
 *   discovery response payload: flags u32 BE, client type u16 BE,
 *                               name (u8 length + utf8), uuid (u8 length + utf8),
 *                               last error u32 BE,
 *                               certificate (u16 length + DER bytes)
 *
 * Discovery provides the console IP, name and SmartGlass UUID. It does NOT
 * provide the Xbox Live `serverId` required by the Remote Play REST API;
 * that comes from https://xccs.xboxlive.com/lists/devices.
 */

export const SMARTGLASS_PORT = 5050
export const SMARTGLASS_BROADCAST = '255.255.255.255'
export const SMARTGLASS_MULTICAST = '239.255.255.250'

export const PacketType = {
  DiscoveryRequest: 0xdd00,
  DiscoveryResponse: 0xdd01,
  PowerOnRequest: 0xdd02,
  Message: 0xd00d,
} as const

export const DiscoveryClientType = {
  XboxOne: 0x1,
  Xbox360: 0x2,
  WindowsDesktop: 0x3,
  WindowsStore: 0x4,
  WindowsPhone: 0x5,
  iPhone: 0x6,
  iPad: 0x7,
  Android: 0x8,
} as const

export const PrimaryDeviceFlag = {
  AllowConsoleUsers: 0x1,
  AllowAuthenticatedUsers: 0x2,
  AllowAnonymousUsers: 0x4,
  CertificatePending: 0x8,
} as const

export interface DiscoveryRequestOptions {
  clientType?: number
  minimumVersion?: number
  maximumVersion?: number
  flags?: number
}

export function encodeDiscoveryRequest(options: DiscoveryRequestOptions = {}): Buffer {
  const clientType = options.clientType ?? DiscoveryClientType.Android
  const minimumVersion = options.minimumVersion ?? 0
  const maximumVersion = options.maximumVersion ?? 2
  const flags = options.flags ?? 0

  const payload = Buffer.alloc(10)
  payload.writeUInt32BE(flags >>> 0, 0)
  payload.writeUInt16BE(clientType, 4)
  payload.writeUInt16BE(minimumVersion, 6)
  payload.writeUInt16BE(maximumVersion, 8)

  const header = Buffer.alloc(6)
  header.writeUInt16BE(PacketType.DiscoveryRequest, 0)
  header.writeUInt16BE(payload.length, 2)
  header.writeUInt16BE(2, 4)

  return Buffer.concat([header, payload])
}

export interface DiscoveryResponse {
  address: string
  packetType: number
  version: number
  flags: number
  clientType: number
  name: string
  uuid: string
  lastError: number
  certificatePresent: boolean
  receivedAt: string
}

/**
 * SmartGlass strings are a u16 big-endian length, the UTF-8 bytes and a
 * trailing null byte (construct.PascalString(Int16ub) + TerminatedField).
 * The u8 reading looked plausible on the synthetic fixture but broke against
 * a real Xbox One S: name came back empty and the UUID became "XboxOne".
 */
function readSgString(buffer: Buffer, offset: number, field: string): { value: string; next: number } {
  if (offset + 2 > buffer.length) throw new Error(`Discovery response truncated at ${field}`)
  const length = buffer.readUInt16BE(offset)
  const start = offset + 2
  const end = start + length
  if (end > buffer.length) throw new Error(`Discovery response truncated inside ${field}`)
  let next = end
  if (next < buffer.length && buffer[next] === 0) next += 1
  return { value: buffer.subarray(start, end).toString('utf8'), next }
}

export function decodeDiscoveryResponse(buffer: Buffer, address: string): DiscoveryResponse {
  if (buffer.length < 8) throw new Error('Discovery response too short')
  const packetType = buffer.readUInt16BE(0)
  if (packetType !== PacketType.DiscoveryResponse) {
    throw new Error(`Not a discovery response: 0x${packetType.toString(16)}`)
  }
  const payloadLength = buffer.readUInt16BE(2)
  const version = buffer.readUInt16BE(4)
  if (6 + payloadLength > buffer.length) throw new Error('Discovery payload length exceeds datagram')

  let offset = 6
  const flags = buffer.readUInt32BE(offset)
  offset += 4
  const clientType = buffer.readUInt16BE(offset)
  offset += 2
  const name = readSgString(buffer, offset, 'name')
  offset = name.next
  const uuid = readSgString(buffer, offset, 'uuid')
  offset = uuid.next
  const lastError = buffer.readUInt32BE(offset)
  offset += 4

  let certificatePresent = false
  if (offset + 2 <= 6 + payloadLength) {
    const certificateLength = buffer.readUInt16BE(offset)
    offset += 2
    certificatePresent = certificateLength > 0 && offset + certificateLength <= buffer.length
  }

  return {
    address,
    packetType,
    version,
    flags,
    clientType,
    name: name.value,
    uuid: uuid.value,
    lastError,
    certificatePresent,
    receivedAt: new Date().toISOString(),
  }
}

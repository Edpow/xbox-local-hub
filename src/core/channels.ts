/**
 * JSON messages exchanged on the WebRTC data channels.
 *
 * Sources: unknownskl/xbox-xcloud-player (control.ts, message.ts) and
 * Greenlight v2. Strings are kept byte-for-byte compatible with the
 * reference client. The `accessKey` is a public constant baked into every
 * open-source Xbox Remote Play client.
 */

export const CONTROL_ACCESS_KEY = '4BDB3609-C1F1-4195-9B37-FEFF45DA8B8E'
export const MESSAGE_PROTOCOL_VERSION = 'messageV1'

export type ControlMessage =
  | { message: 'authorizationRequest'; accessKey: string }
  | { message: 'gamepadChanged'; gamepadIndex: number; wasAdded: boolean }
  | { message: 'videoKeyframeRequested'; ifrRequested: boolean }

export function authorizationRequestMessage(): string {
  return JSON.stringify({
    message: 'authorizationRequest',
    accessKey: CONTROL_ACCESS_KEY,
  } satisfies ControlMessage)
}

export function gamepadChangedMessage(gamepadIndex: number, wasAdded: boolean): string {
  return JSON.stringify({
    message: 'gamepadChanged',
    gamepadIndex,
    wasAdded,
  } satisfies ControlMessage)
}

export function keyframeRequestMessage(ifrRequested = false): string {
  return JSON.stringify({
    message: 'videoKeyframeRequested',
    ifrRequested,
  } satisfies ControlMessage)
}

export interface MessageEnvelope {
  type: 'Handshake' | 'HandshakeAck' | 'Message' | 'TransactionComplete'
  id: string
  cv: string
  version?: string
  content?: string
  target?: string
}

export function handshakeMessage(id: string): string {
  return JSON.stringify({
    type: 'Handshake',
    version: MESSAGE_PROTOCOL_VERSION,
    id,
    cv: '0',
  } satisfies MessageEnvelope)
}

export interface StreamingClientConfig {
  width: number
  height: number
  clientAppInstallId: string
}

export const DEFAULT_CLIENT_CONFIG: StreamingClientConfig = {
  width: 1280,
  height: 720,
  clientAppInstallId: 'c97d7ee0-73b2-4239-bf1d-9d805a338429',
}

function envelope(id: string, target: string, content: unknown): string {
  return JSON.stringify({
    type: 'Message',
    content: JSON.stringify(content),
    id,
    target,
    cv: '',
  } satisfies MessageEnvelope)
}

/**
 * Messages the reference client sends right after HandshakeAck. They
 * advertise a screen (needed so the console lays out its UI) and disable
 * touch input.
 */
export function streamingConfigMessages(
  newId: () => string,
  config: StreamingClientConfig = DEFAULT_CLIENT_CONFIG,
): string[] {
  return [
    envelope(newId(), '/streaming/systemUi/configuration', {
      version: [0, 2, 0],
      systemUis: [],
    }),
    envelope(newId(), '/streaming/properties/clientappinstallidchanged', {
      clientAppInstallId: config.clientAppInstallId,
    }),
    envelope(newId(), '/streaming/characteristics/orientationchanged', {
      orientation: 0,
    }),
    envelope(newId(), '/streaming/characteristics/touchinputenabledchanged', {
      touchInputEnabled: false,
    }),
    envelope(newId(), '/streaming/characteristics/clientdevicecapabilities', {}),
    envelope(newId(), '/streaming/characteristics/dimensionschanged', {
      horizontal: config.width,
      vertical: config.height,
      preferredWidth: config.width,
      preferredHeight: config.height,
      safeAreaLeft: 0,
      safeAreaTop: 0,
      safeAreaRight: config.width,
      safeAreaBottom: config.height,
      supportsCustomResolution: true,
    }),
  ]
}

export function transactionCompleteMessage(id: string, result: unknown = ''): string {
  return JSON.stringify({
    type: 'TransactionComplete',
    content: JSON.stringify(result),
    id,
    cv: '',
  } satisfies MessageEnvelope)
}

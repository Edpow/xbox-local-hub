# Arquitetura — Xbox Local Hub (fase 1)

## 1. Objetivo da fase

Responder, com software executável, se é possível:

1. autenticar no Xbox Live;
2. abrir uma sessão de Remote Play sem depender de um app oficial;
3. manter o console enviando vídeo (ou ao menos aceitar a negociação) sem exibir a imagem;
4. registrar até quatro identidades de controle (`gamepadIndex` 0–3);
5. enviar estados independentes de botões/analógicos/gatilhos;
6. conviver com controles ligados diretamente ao Xbox.

O projeto entrega um protótipo, não o app final.

## 2. Visão de componentes

```text
┌───────────────────────────── Android / WebView ─────────────────────────────┐
│                                                                             │
│  Kotlin: ControllerHub            Dashboard TS                               │
│  ├─ InputManager (InputDevice)    ├─ XboxPeer (RTCPeerConnection)            │
│  ├─ GamepadMapper                 ├─ Gamepad API / bridge nativa             │
│  ├─ P1..P4 PlayerManager          ├─ Input scheduler (60 Hz)                 │
│  └─ 60 Hz JSON frames ───────────►├─ UI: sessão, slots, diagnóstico          │
│                                   └─ REST/WS com o relay                     │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ HTTP/WS (LAN)
┌───────────────────────────────▼─────────────────────────────────────────────┐
│ Relay Node/TypeScript                                                       │
│                                                                             │
│  AuthService ── xal-node ── Microsoft identity / XSTS / GSSV                 │
│  DiscoveryService ── UDP 5050 (SmartGlass)                                   │
│  ConsoleService ── xccs.xboxlive.com (serverId) + LAN merge                  │
│  SessionService ── /v5/sessions/home/*                                      │
│  PlayerManager ── players.json                                               │
│  HTTP API + WebSocket hub + logs JSONL                                       │
│  MockConsole (werift) ── somente em modo teste                              │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ HTTP (SDP/ICE), Wi-Fi
┌───────────────────────────────▼─────────────────────────────────────────────┐
│ Xbox One S — Remote Play                                                     │
│  provisionamento → configuração → SDP → ICE → WebRTC → input channel        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3. Por que o WebRTC fica no navegador/WebView

O protocolo de Remote Play não é um WebSocket de comandos: a sessão xHome termina em uma negociação WebRTC. O cliente open-source Greenlight usa `RTCPeerConnection` do navegador; o XStreaming usa a stack nativa do React Native. Reproduzir ICE/DTLS/SCTP/H.264 em Kotlin na fase 1 aumentaria o risco sem responder à pergunta principal.

Decisão:

- **Relay** implementa autenticação, descoberta, provisionamento e a sinalização SDP/ICE via REST.
- **Dashboard/WebView** implementa o peer WebRTC, os data channels e o envio dos pacotes binários.
- **Android nativo** captura os controles e injeta frames no WebView (sem bridge RN no caminho de 60 Hz).

Consequência: o dashboard precisa estar aberto durante a sessão. No modo app, o WebView é o transporte; no modo desktop, é uma aba do Chrome. Isso é aceitável para a prova de conceito e está documentado como decisão de fase.

## 4. Fluxo de uma sessão

```text
1. Device code
   Browser → Relay POST /api/auth/device-code
   Relay → Microsoft /devicecode
   Usuário autentica em microsoft.com/link
   Relay recebe refresh token, salva em auth.json (0600)

2. Tokens
   Relay → MSAL refresh → XSTS (gssv) → /v2/login/user (xhome)
        → XSTS (xboxlive.com) para a lista de consoles
   Cache de 4 min em memória

3. Descoberta
   Relay → UDP broadcast/multicast 5050 (SmartGlass) → IP, nome, uuid
   Relay → GET xccs.xboxlive.com/lists/devices → serverId (obrigatório)
   ConsoleService faz merge por nome

4. Sessão
   Relay → POST /v5/sessions/home/play { serverId }
          ← { sessionId, sessionPath, state }
   Relay → GET .../state (poll até Provisioned/ReadyToConnect)
   Relay → GET .../configuration { serverDetails }

5. WebRTC
   Browser cria RTCPeerConnection + canais message/control/input
   Browser → POST /api/session/sdp { offer } → Relay → Xbox
   Xbox → answer (via exchangeResponse) → Browser setRemoteDescription
   Browser coleta ICE → POST /api/session/ice → Xbox
   Xbox devolve candidatos → Browser addIceCandidate
   ICE/DTLS/SCTP conectam; canais abrem

6. Handshake
   message: {"type":"Handshake","version":"messageV1",...}
   ← HandshakeAck
   control: authorizationRequest (accessKey público)
   control: gamepadChanged(i, false) para 0..3
   input:   metadata do cliente (15 bytes)
   message: configuração de tela/system UI
   control: gamepadChanged(i, true) para slots ativos

7. Input
   Browser/nativo → encodeInputPacket (gamepad index, botões, eixos, gatilhos)
   → data channel "input" a 60 Hz (heartbeat de 100 ms por slot)
```

## 5. Componentes do relay

| Arquivo | Responsabilidade |
|---|---|
| `src/relay/server.ts` | HTTP, rotas, auth por token, WS hub, estáticos, throttling de broadcast |
| `src/relay/auth-service.ts` | device code, refresh, XSTS, tokens xHome, cache, logout |
| `src/relay/discovery-service.ts` | socket UDP, broadcast/multicast, dedupe, erros |
| `src/relay/console-service.ts` | merge LAN + Xbox Live, cache de 30 s, modo mock |
| `src/relay/session-service.ts` | máquina de estados da sessão, SDP/ICE, keepalive |
| `src/relay/mock-console.ts` | peer WebRTC de teste que decodifica os pacotes reais |
| `src/core/*` | protocolo puro (sem I/O): gamepad, encoder, discovery, canais, players |
| `src/core/xbox/gssv.ts` | cliente REST xHome puro, com `fetch` injetável |
| `src/core/xbox/console-list.ts` | cliente xccs |

O núcleo (`src/core`) não depende do servidor e é reaproveitado pelo dashboard via esbuild.

## 6. Componentes Android

| Arquivo | Responsabilidade |
|---|---|
| `bluetooth/ControllerDiscovery.kt` | enumera `InputDevice` com `SOURCE_JOYSTICK`/`SOURCE_GAMEPAD`, ignora virtuais, observa add/remove |
| `input/GamepadMapper.kt` | `KeyEvent`/`MotionEvent` → bitmask, eixos, gatilhos, deadzone |
| `input/ControllerHub.kt` | estado por `deviceId`, P1–P4, frames a 60 Hz, ponte para o WebView |
| `multiplayer/PlayerManager.kt` | atribuição persistida, evita duplicidade |
| `XboxLocalHubTransportView.kt` | WebView com `evaluateJavascript("window.XLH.setNativeFrame(...)")` |
| `XboxLocalHubControllerModule.kt` | APIs/eventos para a UI RN (diagnóstico e associação) |
| `diagnostics/DiagnosticsLog.kt` | ring buffer de eventos |

O app não depende de root, kernel ou driver. Ele usa a API pública `InputDevice`, a mesma que qualquer jogo Android usa para ler um controle.

## 7. Segurança

- O relay escuta em `127.0.0.1` por padrão.
- Ao escutar em `0.0.0.0`, exige `Authorization: Bearer <token>` ou `?token=`; o token é gerado com 24 bytes aleatórios e gravado com `0600`.
- Refresh token e logs ficam no diretório de configuração do usuário, com permissões restritas.
- O logger redige campos que contenham `token`, `authorization`, `secret`, `password`, `refresh`.
- Não há telemetria externa. As únicas chamadas externas são Microsoft/Xbox e o console na LAN.
- O dashboard serve apenas arquivos estáticos e JSON; não há upload de arquivos nem execução de conteúdo do usuário.

## 8. Persistência

| Dado | Local | Formato |
|---|---|---|
| Refresh token | `auth.json` | JSON do xal-node |
| Associação P1–P4 (relay) | `players.json` | JSON |
| Associação P1–P4 (Android) | SharedPreferences | JSON simples |
| Logs | `logs/relay.jsonl` | JSON Lines |
| Preferências da UI | `localStorage` | chaves `xlh.*` |

## 9. Modo mock

`MockConsole` usa `werift` para aceitar o offer do Chrome, responder, receber os data channels e decodificar `encodeInputPacket`. Ele existe para:

- testar a UI e o scheduler sem console;
- detectar regressões de layout binário;
- provar que quatro índices chegam independentes;
- permitir desenvolvimento offline.

Ele **não** é evidência de compatibilidade com o Xbox. A UI e os logs deixam isso explícito (“MOCK”, “nenhum console real”).

## 10. Limitações arquiteturais conhecidas

1. **Um peer por sessão.** Para quatro jogadores, um único peer com quatro `GamepadIndex` é o caminho; abrir quatro sessões Remote Play não é suportado pelo console.
2. **Vídeo ainda é recebido.** O console negocia um sink de vídeo; o MVP simplesmente não o apresenta. “Sem streaming” significa “sem exibição/retransmissão”, não “sem bytes de vídeo” até que o protocolo permita data-only.
3. **Dependência de navegador.** A stack WebRTC do Android WebView é a do sistema; em aparelhos antigos pode faltar H.264/ICE. O app documenta a versão mínima.
4. **Android e dashboard duplicam parte da UI.** O dashboard é a fonte de verdade da sessão; o app nativo é o front-end de captura.
5. **Sem reconexão automática de sessão.** Keepalive é enviado; se o console derrubar, o usuário reinicia.
6. **Sem áudio.** O transceiver de áudio é recvonly e ignorado.

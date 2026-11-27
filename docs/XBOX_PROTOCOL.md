# Protocolo Xbox Remote Play — o que foi pesquisado e implementado

> Documento técnico da fase 1. Fontes públicas consultadas em novembro de 2026. O protocolo não é documentado pela Microsoft e pode mudar sem aviso. Nada aqui deve ser tratado como API oficial.

## 1. Fontes principais

| Projeto | O que forneceu |
|---|---|
| [unknownskl/xbox-xcloud-player](https://github.com/unknownskl/xbox-xcloud-player) | layout binário do input, canais WebRTC, handshake |
| [unknownskl/greenlight](https://github.com/unknownskl/greenlight) (`main-v2`) | fluxo completo xHome, REST, ICE/SDP, 4 handlers de gamepad |
| [Geocld/XStreaming](https://github.com/Geocld/XStreaming) | documentação do fluxo xHome, SDP/ICE, co-op de 2 jogadores |
| [OpenXbox/xbox-smartglass-core-python](https://github.com/OpenXbox/xbox-smartglass-core-python) | pacotes SmartGlass, descoberta UDP |
| [nafields/stratix](https://github.com/nafields/stratix) | análise independente do protocolo, input e SDP |

Esses projetos se baseiam em engenharia reversa. O MVP reimplementa apenas o necessário e cita o comportamento observado.

## 2. Camadas

```text
Descoberta LAN (opcional)     SmartGlass UDP 5050
Autenticação                  Microsoft OAuth device code → XSTS → GSSV
Catálogo de console           xccs.xboxlive.com (serverId)
Provisionamento               /v5/sessions/home/*
Sinalização                   SDP/ICE via REST
Transporte                    WebRTC (DTLS/SRTP/SCTP)
Controle                      data channels "message", "control", "input"
```

## 3. Descoberta SmartGlass (UDP 5050)

Pacote binário, big-endian:

```text
Header (6 bytes)
  0  u16  packet type     0xDD00 request / 0xDD01 response
  2  u16  payload length
  4  u16  protocol version (2)

Discovery request payload (10 bytes)
  0  u32  flags
  4  u16  client type     0x08 = Android
  6  u16  minimum version
  8  u16  maximum version
```

Resposta:

```text
  0  u32   flags (bit 1 = allow authenticated users, bit 2 = allow anonymous...)
  4  u16   client type
  6  u16   name length + UTF-8 + NUL
  .. u16   uuid length + UUID textual + NUL
  .. u32   last error
  .. u16   certificate length + DER
```

O IP vem do endereço de origem do datagrama. A descoberta **não** retorna o `serverId` usado pela API de sessão; retorna o UUID SmartGlass. A lista de consoles do Xbox Live é obrigatória para obter o `serverId`.

Implementação: `src/core/discovery.ts`, `src/relay/discovery-service.ts`.

## 4. Autenticação

Fluxo do `xal-node` (o mesmo do Greenlight):

1. `POST https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode`
   `client_id=<público>&scope=xboxlive.signin openid profile offline_access`
2. Usuário abre `https://www.microsoft.com/link` e digita o código.
3. Poll em `/consumers/oauth2/v2.0/token` até receber `access_token` + `refresh_token`.
4. `POST https://user.auth.xboxlive.com/user/authenticate` → token Xbox Live.
5. `POST https://xsts.auth.xboxlive.com/xsts/authorize` com:
   - `RelyingParty: http://gssv.xboxlive.com/` para streaming;
   - `RelyingParty: http://xboxlive.com` para a lista de consoles.
6. `POST https://xhome.gssv-play-prod.xboxlive.com/v2/login/user`
   ```json
   { "token": "<xsts gssv>", "offeringId": "xhome" }
   ```
   Retorna `gsToken` e `offeringSettings.regions[]` (cada uma com `baseUri`).

O `uhs` (user hash) vem de `DisplayClaims.xui[0].uhs` no token XSTS de `xboxlive.com`.

**Limitação conhecida:** o `xal-node` usa um client id público do Greenlight. Um produto final deve ter app registration própria.

## 5. Lista de consoles (serverId)

```http
GET https://xccs.xboxlive.com/lists/devices?queryCurrentDevice=false&includeStorageDevices=true
Authorization: XBL3.0 x=<uhs>;<xsts-token>
x-xbl-contract-version: 4
skillplatform: RemoteManagement
Content-Type: application/json
```

Resposta contém `data.result[]`; cada item tem `id` (usado como `serverId`), `name`, `consoleType`, `powerState`.

O `id` é um identificador do console, diferente do UUID SmartGlass.

## 6. Sessão xHome

Host: `baseUri` da região padrão do token xHome (ex.: `https://uks.core.gssv-play-prodxhome.xboxlive.com`). Todos os requests usam `Authorization: Bearer <gsToken>`.

### 6.1 Criar

```http
POST /v5/sessions/home/play
X-MS-Device-Info: <JSON fixo>
Content-Type: application/json

{
  "titleId": "",
  "systemUpdateGroup": "",
  "clientSessionId": "",
  "settings": {
    "nanoVersion": "V3;WebrtcTransport.dll",
    "enableTextToSpeech": false,
    "highContrast": 0,
    "locale": "en-US",
    "useIceConnection": false,
    "timezoneOffsetMinutes": 120,
    "sdkType": "web",
    "osName": "windows"
  },
  "serverId": "<serverId>",
  "fallbackRegionNames": []
}
```

Resposta:

```json
{
  "sessionId": "<sessionId>",
  "sessionPath": "v5/sessions/home/<sessionId>",
  "state": "Provisioning"
}
```

### 6.2 Estados

`GET /v5/sessions/home/:sessionId/state`

- `Provisioning` — aguardar;
- `Provisioned` — pronto para SDP (xHome);
- `ReadyToConnect` — aceito como pronto pelo cliente; alguns fluxos enviam MSAL/LPT antes (xCloud);
- `Failed` — `errorDetails.message`.

O MVP aceita `Provisioned` e `ReadyToConnect`.

### 6.3 Configuração

`GET .../configuration` devolve `keepAlivePulseInSeconds` e `serverDetails` (`ipAddress`, `port`, `iceExchangePath`, `srtp`). Útil para diagnóstico; o WebRTC do navegador não precisa dos candidatos manualmente.

### 6.4 SDP

```http
POST /v5/sessions/home/:sessionId/sdp
{
  "messageType": "offer",
  "sdp": "<offer>",
  "configuration": {
    "chatConfiguration": { ... },
    "chat":    { "minVersion": 1, "maxVersion": 1 },
    "control": { "minVersion": 1, "maxVersion": 3 },
    "input":   { "minVersion": 1, "maxVersion": 8 },
    "message": { "minVersion": 1, "maxVersion": 1 }
  }
}
```

O POST não devolve a resposta. É preciso poll:

```http
GET /v5/sessions/home/:sessionId/sdp
→ { "exchangeResponse": "{\"sdp\":\"...\",\"sdpType\":\"answer\",\"status\":\"success\"}", ... }
```

O primeiro GET pode vir vazio; repetir a cada ~500 ms.

### 6.5 ICE

```http
POST /v5/sessions/home/:sessionId/ice
{ "messageType": "iceCandidate", "candidate": [ ... ] }

GET /v5/sessions/home/:sessionId/ice
→ { "exchangeResponse": "[{\"candidate\":\"a=candidate:...\",\"sdpMid\":\"0\",\"sdpMLineIndex\":0}]" }
```

Candidatos do Xbox podem vir com prefixo literal `a=` (inválido para a API WebRTC); o cliente remove. Candidatos Teredo (IPv6 `2001:...`) são voltados para WAN; em LAN os host candidates bastam.

### 6.6 Keepalive e fim

- `POST .../keepalive` (o servidor informa o intervalo, normalmente 300 s; o MVP usa metade).
- `DELETE .../` encerra.

## 7. WebRTC

Configuração do peer que funcionou nos clientes de referência:

- `iceServers: []` (a sinalização vem por HTTP);
- `bundlePolicy: max-bundle`, `rtcpMuxPolicy: require`;
- transceiver de áudio `recvonly`;
- transceiver de vídeo `recvonly`, H.264 priorizado (High `4d`, Constrained High `42e`, Baseline `420`);
- três data channels criados pelo cliente, ordenados:

| Canal | Protocolo | Uso |
|---|---|---|
| `message` | `messageV1` | handshake, mensagens de sistema |
| `control` | `controlV1` | autorização, registro de gamepads |
| `input` | `1.0` | frames binários de entrada |

O console responde com `setup:active` e o SDP de resposta. DTLS/SCTP sobem os canais.

### 7.1 Handshake

No `message`:

```json
{ "type": "Handshake", "version": "messageV1", "id": "<uuid>", "cv": "0" }
```

Resposta:

```json
{ "type": "HandshakeAck", "id": "<uuid>", "cv": "" }
```

Após o ACK, o cliente envia:

```json
{ "message": "authorizationRequest", "accessKey": "4BDB3609-C1F1-4195-9B37-FEFF45DA8B8E" }
{ "message": "gamepadChanged", "gamepadIndex": 0, "wasAdded": false }
...
{ "message": "gamepadChanged", "gamepadIndex": 0, "wasAdded": true }
```

Também envia uma mensagem JSON de configuração de sistema (dimensões de tela, touch desabilitado, systemUis vazio) no canal `message`.

### 7.2 Entrada binária

Cabeçalho (14 bytes, little-endian):

| Offset | Tam | Campo |
|---|---|---|
| 0 | 2 | bitmask de report type (`2` = gamepad, `8` = client metadata) |
| 2 | 4 | número de sequência (u32, incrementa por pacote) |
| 6 | 8 | timestamp do cliente em ms (f64) |

Bloco de gamepads: `u8 count`, depois `count` frames de **23 bytes**:

| Offset no frame | Tam | Campo |
|---|---|---|
| 0 | 1 | `gamepadIndex` (0–3) |
| 1 | 2 | botões (bitmask u16 LE) |
| 3 | 2 | LX (i16 LE) |
| 5 | 2 | LY (i16 LE) — **negado** pelo cliente de referência |
| 7 | 2 | RX (i16 LE) |
| 9 | 2 | RY (i16 LE) — **negado** |
| 11 | 2 | LT (u16 LE, 0–65535) |
| 13 | 2 | RT (u16 LE) |
| 15 | 4 | physical physicality (u32 **LE**; Greenlight envia 1, Better xCloud envia 0) |
| 19 | 4 | virtual physicality (u32 **BE**; Greenlight envia 1, Better xCloud envia 0) |

Os últimos 8 bytes têm endianness mista no cliente de referência. O MVP copia exatamente e expõe um modo co-op que envia 0/0 (valores do Better xCloud) em vez de 1/1 (Greenlight). O significado exato desses campos não é documentado; 0/0 é o valor usado pelo cliente web oficial e pelo recurso de co-op local do Better xCloud.

Bitmask de botões:

| Bit | Valor | Botão |
|---|---|---|
| 1 | 0x0002 | Nexus (Xbox) |
| 2 | 0x0004 | Menu (Start) |
| 3 | 0x0008 | View (Back) |
| 4 | 0x0010 | A |
| 5 | 0x0020 | B |
| 6 | 0x0040 | X |
| 7 | 0x0080 | Y |
| 8 | 0x0100 | D-Pad Up |
| 9 | 0x0200 | D-Pad Down |
| 10 | 0x0400 | D-Pad Left |
| 11 | 0x0800 | D-Pad Right |
| 12 | 0x1000 | LB |
| 13 | 0x2000 | RB |
| 14 | 0x4000 | L3 |
| 15 | 0x8000 | R3 |

O primeiro pacote no canal `input` é metadata do cliente: 14 bytes de cabeçalho + `u8 maxTouchPoints` = 15 bytes, report type `8`.

O scheduler envia quando o estado muda e mantém um heartbeat (33 ms no Greenlight; o MVP usa 100 ms) para o console não considerar o controle inativo.

## 8. Quatro identidades — o que se sabe

Evidências de que o protocolo **transporta** quatro índices:

- `xbox-xcloud-player` define `GamepadHandlers` para índices `0,1,2,3`;
- o frame tem um byte `gamepadIndex`;
- o controle `gamepadChanged` aceita `gamepadIndex` arbitrário;
- o Greenlight cria um handler por índice e envia frames com o índice correspondente.

Evidência de limite potencial:

- o XStreaming expõe “co-op” para **dois** jogadores (`gamepadIndex` 0 e 1), não quatro.

Conclusão da fase de pesquisa: o **formato** suporta quatro; a **política do console/serviço** para uma sessão xHome é a incógnita. Isso só se resolve experimentalmente, olhando a tela de lobby de um jogo com 4 jogadores. Ver [MULTIPLAYER.md](MULTIPLAYER.md).

## 8.1. O que o teste real confirmou (27/11/2026)

- Descoberta LAN: Xbox One S na LAN; strings SmartGlass são u16 + NUL (o parser u8 falhava no console real).
- WakeUp via xccs acordou o console de `ConnectedStandby`; depois o estado ficou `On`.
- `/play` + poll → `Provisioned`; `configuration` com `serverDetails` e STUN da Microsoft.
- SDP/ICE via REST funcionaram com o offer do Chrome/WebView Android; o answer foi aceito.
- Canais `message`/`control`/`input` abriram; `HandshakeAck` e `authorizationRequest` funcionaram.
- Vídeo real 1280×720 chegou ao cliente.
- Quatro `gamepadIndex` foram registrados e frames dos quatro foram aceitos; o console processou botões.
- A tentativa data-only (sem áudio/vídeo) foi rejeitada com `SessionInUnexpectedState`, reforçando que o console espera mídia no SDP.
- No Sky Force, Start/A do P2 não criou um segundo jogador; o jogo exige dois perfis e o console tinha um perfil ativo. A separação de identidades segue não comprovada.

## 9. Sem streaming de vídeo

O fluxo padrão sempre negocia um transceiver de vídeo `recvonly`; o console provavelmente assume que há um sink. O MVP:

- negocia vídeo por padrão, mas **não** anexa a track a nenhum elemento visível;
- oferece um checkbox para omitir áudio/vídeo e testar se o console aceita data-only;
- registra no diagnóstico se a negociação sem mídia falhou.

“Sem streaming” no MVP significa “sem exibir/retransmitir a imagem”, não “sem receber bytes de vídeo”. A pergunta “é possível uma sessão data-only?” fica como experimento de hardware.

## 10. Pontos não verificados

1. ~~Aceitação do SDP gerado pelo Chrome atual pelo firmware do Xbox One S.~~ **confirmado em hardware**
2. Se `gamepadIndex` 2 e 3 viram jogadores no console ou são somados no jogador ativo. **em aberto** — o teste inicial sugere soma, mas faltou o segundo perfil.
3. Se os campos de “physicality” (1/1 vs 0/0) mudam o comportamento de identidade. **em aberto** — modo 0/0 implementado.
4. Se data-only é aceito. **não** — o console rejeitou a tentativa.
5. Se o console mantém a sessão sem um vídeo sendo consumido (PLI/RTCP). **parcial** — a sessão funciona e o vídeo chega; a prévia é opcional.
6. Coexistência com controles físicos ligados ao console. **em aberto**
7. Limites de firmware e de contas (Remote Play habilitado, console em standby vs ligado). **parcial** — WakeUp e conta única testados.

O relatório [MVP_RESULTS.md](MVP_RESULTS.md) registra o que já foi confirmado em hardware e o que permanece aberto.

## 11. Limitação conhecida do Remote Play

A documentação de suporte da Microsoft e desenvolvedores de clientes independentes indicam que o Remote Play normalmente encaminha **um** controle e soma os demais no jogador ativo. O recurso de co-op local do Better xCloud contorna isso no cliente, o que mostra que o protocolo permite múltiplas identidades quando o cliente as representa corretamente. O MVP precisa reproduzir esse comportamento com dois perfis e o modo `physicality 0/0`.

Referências:

- https://answers.microsoft.com/en-us/xbox/forum/all/can-you-play-2-player-when-using-local-remote-play/c5b67b63-d13c-4776-906e-bac288bd838f
- https://github.com/redphx/better-xcloud/blob/main/src/modules/patcher/patches/src/local-co-op-enable.ts
- https://github.com/redphx/better-xcloud/blob/main/src/utils/gamepad.ts

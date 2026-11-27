# Resultados do MVP — fase 1

**Data da execução:** 26–27/11/2026  
**Ambiente:** Linux x86_64, Node.js 24.22.0, JDK 17, Android SDK 35, Moto G200 (Android 12) via ADB, Xbox One S na LAN  
**Hardware ainda ausente:** controles Bluetooth físicos pareados ao celular

> **Atualização 27/11/2026:** o MVP foi executado em um **Xbox One S real**, com o app instalado em um **Moto G200**. A entrada remota foi comprovada visualmente. A separação de quatro identidades ainda não foi concluída. Este documento separa o que foi verificado em software, em hardware e o que permanece aberto.

## 1. Resumo executivo

O MVP foi implementado e executado em software e em hardware real:

- relay Node/TypeScript com auth, descoberta, sessão xHome, SDP/ICE, WakeUp, API e logs;
- dashboard web responsivo com WebRTC, handshake, quatro slots e diagnóstico;
- codificador binário de entrada compatível com a referência open-source;
- console simulado (`werift`) que decodifica os pacotes reais;
- app Android (RN + Kotlin) **compilado, instalado e executado** no Moto G200;
- sessão real no Xbox One S com vídeo 1280×720 e entrada remota funcional.

**Resultado:** o fluxo completo foi provado em hardware — app → relay → Xbox → SDP/ICE → WebRTC → handshake → entrada. Dois D-Pad Right moveram o foco do dashboard de YouTube para Sky Force; A abriu e iniciou jogos. Quatro `gamepadIndex` foram registrados e aceitos. A pergunta que permanece é mais estreita: **o console converte esses quatro índices em quatro jogadores independentes?** A tentativa inicial no Sky Force sugere que não sem dois perfis/configuração adequada.

## 2. Execuções realizadas

| Execução | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | 0 erros |
| Build do relay | `npm run build` | sucesso (tsc + esbuild) |
| Testes unitários/integração | `npm test` | **39/39 passaram** |
| E2E com Chrome real | `npm run test:e2e` | **1/1 passou** (~3,4 s) |
| Servidor mock | `npm run mock` | health/state/consoles/sessão OK |
| Device code Microsoft | login real pelo usuário | concluído; tokens salvos |
| Build/instalação Android | Gradle + ADB | APK debug instalado no Moto G200 |
| Descoberta SmartGlass | UDP 5050 na LAN | Xbox One S encontrado em `192.168.15.12` |
| Sessão + WebRTC reais | dashboard no celular | `Provisioned`, peer `connected`, handshake `ok` |
| Entrada remota real | D-Pad/A pelo dashboard | foco mudou; jogos abriram/iniciaram |

Saída resumida do e2e:

```text
✓ tests/e2e/dashboard.test.ts (1 test) 3386ms
  connects WebRTC, registers four slots and delivers independent frames

registered: [0,1,2,3]
slots:
  0: buttons=16  LX=16384  LT=65535
  1: buttons=32  RY=24575  RT=32768
  2: buttons=320 (X|DPadUp)
  3: buttons=640 (Y|DPadDown)
control true: [0,1,2,3]
```

A captura do dashboard durante o teste está em [`docs/evidence/dashboard-mock-4-slots.png`](evidence/dashboard-mock-4-slots.png).

## 3. O que foi verificado de verdade

### 3.1 Protocolo binário

- O frame tem 23 bytes por gamepad, com índice, botões, eixos, gatilhos e os dois campos de “physicality”.
- O eixo Y é negado, como na referência.
- Quatro índices são codificados e decodificados sem colisão.
- Valores de fronteira (−32767, 32767, 65535) e IDs inválidos são tratados.
- O primeiro pacote de metadata tem 15 bytes e report type `8`.

### 3.2 Sessão e sinalização (com API mockada)

- `POST /v5/sessions/home/play` com `serverId`, `X-MS-Device-Info` e token.
- Poll de estado até `Provisioned`.
- `GET /configuration`.
- `POST/GET /sdp` com `exchangeResponse` duplo-encoded.
- `POST/GET /ice` com o envelope `{messageType:'iceCandidate', candidate:[...]}`.
- Keepalive e DELETE.
- Erros HTTP viram `GssvError` com status/corpo.

### 3.3 WebRTC e handshake (com Chrome real)

- Peer com data channels `message`/`control`/`input`.
- Conexão ICE/DTLS até `connected`.
- Handshake `messageV1` → `HandshakeAck`.
- `authorizationRequest`, `gamepadChanged(false)` para 0–3 e `gamepadChanged(true)` para os slots ativos.
- Quatro slots enviando pacotes simultâneos; o mock decodifica botões/eixos distintos.
- Nenhum erro de página no Chrome durante o teste.

### 3.4 Segurança e operação

- Token de acesso obrigatório fora de loopback (testado 401/200).
- Refresh token e logs com permissões restritas; redaction de campos sensíveis.
- API testada: consoles, sessão, jogadores, duplicidade, payload inválido, estáticos.

## 3.5. Execução em hardware real (26–27/11/2026)

### Ambiente

| Item | Valor |
|---|---|
| Celular | Moto G200 5G, Android 12, Wi-Fi `192.168.15.6` |
| PC do relay | Linux, `192.168.15.8`, USB/ADB com o celular |
| Console | Xbox One S, `192.168.15.12`, serverId `FD004670BEF12927` |
| App | `com.xboxlocalhub` 0.1.0, build debug, instalado via ADB |
| Transporte | WebView do app → relay via `adb reverse` → Xbox na Wi-Fi |

### O que aconteceu

1. **Descoberta LAN real.** O console respondeu ao UDP 5050. O parser inicialmente retornou `name=""` e `uuid="XboxOne"`; a captura do datagrama revelou que as strings SmartGlass usam **u16 + terminador NUL**, não u8. O bug foi corrigido e um teste de regressão foi adicionado. Depois: `name="XboxOne"`, `uuid="D27B0930-54AC-1F7B-C49C-FBA19B73BEC7"`.
2. **Login Microsoft real.** Device code concluído pelo usuário. A lista Xbox Live retornou o console e o `serverId`.
3. **Console em standby.** O primeiro `/play` falhou com `WaitingForServerToRegister`. O comando `Power/WakeUp` via xccs foi aceito; o console acordou (`powerState: On`) e o ping passou a responder.
4. **Sessão real.** `POST /v5/sessions/home/play` → `Provisioned`; `configuration` retornou `serverDetails` (IP `10.0.0.1`, STUN da Microsoft) e keepalive de 300 s.
5. **WebRTC real.** O WebView do celular enviou o offer, recebeu o answer, trocou ICE e conectou. Canais `message`, `control` e `input` abriram; `HandshakeAck` recebido. Vídeo real **1280×720** chegou ao `#preview` (usado só para diagnóstico).
6. **Entrada remota real.** Com o dashboard aberto no Xbox:
   - dois **D-Pad Right** enviados pelo celular moveram o foco de **YouTube** para **Sky Force Anniversary**;
   - **A** abriu a página de **Star Wars Jedi: Fallen Order**;
   - **A** iniciou o jogo;
   - depois, **A** iniciou o Sky Force.
   Os frames de vídeo antes/depois estão em [evidence](evidence/).
7. **Quatro índices.** O peer registrou `gamepadChanged` para 0,1,2,3 e enviou mais de 300 pacotes com frames dos quatro índices. O console aceitou e processou os botões (todos os índices conseguiam navegar no dashboard).
8. **Tentativa de co-op.** No Sky Force, o P2 enviou Start/A. O jogo não criou uma segunda nave; o botão foi interpretado como ação do P1. O Sky Force exige **dois perfis/controles logados** para co-op local. O console tinha apenas um perfil ativo no momento. Portanto, **identidade separada não foi comprovada**.
9. **Modo co-op experimental.** Foi adicionado um toggle que envia `PhysicalPhysicality=0` / `VirtualPhysicality=0` (valores usados pelo Better xCloud) em vez de `1/1` (Greenlight). O modo foi conectado, mas o teste de co-op com dois perfis ainda não foi feito.

### Evidências

| Evidência | Arquivo |
|---|---|
| App no Moto G200 | [app-android-status.png](evidence/app-android-status.png) |
| Dashboard no celular com sessão real | [phone-real-session.png](evidence/phone-real-session.png) |
| Foco em YouTube (antes) | [xbox-real-home-youtube-focus.png](evidence/xbox-real-home-youtube-focus.png) |
| Foco em Sky Force (depois de 2× D-Pad Right) | [xbox-real-home-skyforce-focus.png](evidence/xbox-real-home-skyforce-focus.png) |
| Detalhes do Jedi abertos com A | [xbox-real-jedi-details.png](evidence/xbox-real-jedi-details.png) |
| Jogo iniciado pelo comando remoto | [xbox-real-game-launched.png](evidence/xbox-real-game-launched.png) |
| Prompt P1 no Sky Force | [xbox-real-p1-prompt.png](evidence/xbox-real-p1-prompt.png) |
| Menu do Sky Force | [xbox-real-skyforce-menu.png](evidence/xbox-real-skyforce-menu.png) |
| Tentativa de P2 no co-op | [xbox-real-coop-p2-attempt.png](evidence/xbox-real-coop-p2-attempt.png) |

## 4. O que NÃO foi verificado

| Item | Motivo | Consequência |
|---|---|---|
| Autenticação completa | sem conta Microsoft no ambiente | fluxo testado até o device code |
| Lista real de consoles | exige login | parsing testado com envelope sintético |
| Quatro identidades no console | jogo exigia 2 perfis; P2 foi tratado como P1 | **pergunta central em aberto** |
| Coexistência com controles locais | não testada | em aberto |
| Quatro controles BT no Moto G200 | nenhum controle pareado durante o teste | captura nativa sem hardware; bridge sintético validado |
| Sessão data-only | o console rejeitou a tentativa (`SessionInUnexpectedState`) | vídeo continua necessário na prática |
| Co-op com 2 perfis | não configurado | próximo teste recomendado |

## 5. Resposta à pergunta central

**“É possível usar o Moto G200 como central de controles Bluetooth, comunicando-se diretamente com o Xbox One S e encaminhando comandos independentes para multiplayer, sem streaming de vídeo e sem hardware adicional?”**

Resposta atual: **sim para o caminho de comunicação e para uma entrada remota funcional; ainda indeterminado para quatro identidades independentes.**

O que foi comprovado:

1. O Moto G200, via app próprio, autenticou, abriu uma sessão xHome real e estabeleceu WebRTC com o Xbox One S.
2. Entradas remotas reais moveram o foco do console, abriram páginas e iniciaram jogos — sem root, dongle ou hardware adicional.
3. Quatro `gamepadIndex` foram registrados e aceitos; o console processou seus botões.
4. O vídeo real chega ao cliente (1280×720) e pode ser ignorado; a tentativa data-only foi rejeitada, então “sem streaming” hoje significa “sem exibir/retransmitir”.

O que permanece aberto:

1. Se os índices 1–3 são convertidos em **jogadores distintos** ou somados no jogador ativo. A tentativa no Sky Force sugere soma, mas o jogo exigia dois perfis.
2. Se o modo `physicality 0/0` (Better xCloud) muda esse comportamento.
3. Coexistência com controles físicos no console.

O próximo teste decisivo é um jogo local com **dois perfis logados** (ou um jogo que aceite guest) e o modo co-op ativado. Roteiro em [TESTING.md](TESTING.md) e matriz em [MULTIPLAYER.md](MULTIPLAYER.md).

## 6. Critérios de aceitação da IDEIA

| Critério | Status | Evidência |
|---|---|---|
| Detectar o Xbox One S | **sim** | descoberta LAN real (após corrigir strings u16) |
| Estabelecer comunicação com o console | **sim** | sessão xHome + WebRTC + handshake reais |
| Validar autenticação | **sim** | device code concluído pelo usuário |
| Investigar sessão sem streaming | **parcial** | vídeo real recebido e ignorado; data-only rejeitado |
| Detectar quatro controles Bluetooth | **não verificado** | app instalado; nenhum controle BT pareado no teste |
| Ler eventos individualmente | **sim (software)** | 4 índices e bridge nativo; falta hardware BT |
| Encaminhar ao menos uma entrada ao Xbox | **sim** | D-Pad moveu o foco; A abriu/iniciou jogos |
| Comprovar reconhecimento | **sim** | reação visual no dashboard do Xbox |
| Investigar quatro jogadores independentes | **parcial** | 4 índices aceitos; P2 não virou jogador no Sky Force (exige 2 perfis) |
| Documentar limitações | **sim** | este documento + protocolo + multiplayer |

## 7. Riscos identificados

1. **Limite de identidades do console.** Pode aceitar só 1 ou 2 índices. mitigação: cenário “2 remotos + 2 locais”.
2. **SDP do Chrome x firmware do console.** Pode exigir munging extra (H.264, bitrate, ICE). mitigação: transporte isolado no dashboard, fácil de ajustar.
3. **Data-only pode ser rejeitado.** mitigação: vídeo recvonly sem renderização.
4. **WebView Android antigo.** mitigação: exigir Android 12 (o alvo do projeto) e Chrome atualizado; fallback para dashboard externo.
5. **Latência da bridge WebView.** mitigação: `evaluateJavascript` nativo, sem bridge RN; medir no aparelho.
6. **Auth dependente de client id de terceiros.** mitigação: documentado; próximo passo é app registration própria.
7. **Remote Play fora da LAN.** mitigação: foco em LAN; Teredo fica para fase futura.

## 8. Próximos passos

### Imediato (hardware)

1. ~~Habilitar Remote Play, autenticar, conectar e provar uma entrada.~~ **feito**
2. Conectar 1–4 controles Bluetooth reais ao Moto G200 e verificar a captura nativa.
3. Configurar **dois perfis logados** no Xbox e repetir o co-op do Sky Force com o modo co-op (`physicality 0/0`).
4. Testar um jogo com split-screen/guest (ex.: Terraria) e registrar quantos jogadores aparecem.
5. Testar coexistência com controles físicos no console.
6. Medir latência real e testar 125 Hz.

### Curto prazo (engenharia)

- ~~Compilar o APK e testar no Moto G200.~~ **feito**
- Investigar o patch do Better xCloud e a semântica de `physicality` para quatro identidades.
- Melhorar a UI de seleção de perfil/segundo jogador no fluxo co-op.
- Adicionar reconexão automática de sessão e de controles.
- Melhorar a UI de associação com identificação visual do controle (cor/ID).
- Expandir o log de diagnóstico com RTT do console (quando disponível) e perda de pacotes.

### Médio prazo

- App registration própria para auth.
- Empacotar o relay em um serviço local no Android (Termux ou módulo nativo) para eliminar o PC.
- Avaliar WebRTC nativo no Android (substituir WebView) se a latência exigir.
- Perfis de mapeamento e suporte a mais jogadores.

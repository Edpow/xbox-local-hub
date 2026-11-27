# AGENTS.md

Guia para agentes e contribuidores que forem continuar o Xbox Local Hub.

## 1. Estado do repositório

- Fase 1 (MVP) implementada em TypeScript/Node + dashboard web.
- App Android em React Native + Kotlin em `apps/android/`; compilado, instalado e executado no Moto G200.
- Validação real no Xbox One S: sessão, WebRTC, handshake, vídeo e entrada remota. Ver `docs/MVP_RESULTS.md`.
- Testes automatizados: `npm test` e `npm run test:e2e`.
- O modo `--mock` usa um console simulado; não o trate como prova de hardware.

## 2. Comandos

```bash
npm install
npm run build              # tsc + dashboard bundle
npm test                   # unitários/integração
npm run test:e2e           # Chrome real + mock
npm run mock               # dashboard em http://127.0.0.1:8787
npm run dev                # dashboard + tsx watch
npm start -- --host=0.0.0.0
npm run typecheck
npm run discover
npm run auth
npm run doctor
npm run check:privacy      # varredura de dados pessoais antes do commit
```

Build Android (JDK 17 + SDK 35):

```bash
export JAVA_HOME=/caminho/jdk-17
export ANDROID_HOME=/caminho/android-sdk
cd apps/android && npm install
npx react-native start --port 8081
cd android && gradle assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787
```

## 3. Estrutura

```text
src/core/                  protocolo puro, sem I/O de rede
  gamepad.ts               modelo, bits, deadzone
  input-packet.ts          encoder/decoder binário
  channels.ts              JSON dos canais
  discovery.ts             UDP SmartGlass codec
  player-manager.ts        P1..P4 persistidos
  xbox/gssv.ts             cliente REST xHome
  xbox/console-list.ts     xccs
src/relay/                 serviços com I/O
src/server.ts              entrypoint
src/cli.ts                 auth/discover/consoles/doctor
dashboard/                 UI + WebRTC (bundle esbuild)
public/                    shell HTML/CSS + app.js gerado
apps/android/              RN + Kotlin
docs/                      arquitetura, protocolo, testes, resultados
tests/                     vitest + e2e
```

## 4. Invariantes que não podem quebrar

1. **Índice de gamepad.** Cada frame leva um `gamepadIndex` 0–3; não concatene estados de jogadores em um único índice.
2. **Y negado.** O encoder escreve `-leftStickY` e `-rightStickY`. Alterar isso exige atualizar os testes e a documentação do protocolo.
3. **Ordem dos campos.** Botões, eixos, gatilhos, physicality — nessa ordem; o `virtualPhysicality` é big-endian, o resto é little-endian.
4. **`gamepadChanged` antes do input.** Não envie frames de um índice sem registrar `wasAdded: true`.
5. **Handshake antes de tudo.** `authorizationRequest` e metadata só depois de `HandshakeAck`.
6. **Um peer por sessão.** Não abra quatro sessões Remote Play. Reaproveite a sessão ativa ao reconectar o WebRTC; não envie um segundo SDP em uma sessão que já falhou.
7. **Segredos.** Nunca logue tokens; o logger redige, mas não imprima respostas brutas de auth.
8. **Mock não é console.** Resultados do mock vão para “software verificado”, nunca para “compatível com Xbox”.
9. **Auth em LAN.** Fora de loopback, o relay exige token; preserve esse comportamento.
10. **Testes antes de refatorar protocolo.** Os testes de bytes são a especificação executável.
11. **Privacidade.** Nunca versione nome real, gamertag, e-mail pessoal, `serverId`/UUID de console ou de sessão, IPs da LAN, serial de aparelho ou caminhos com o usuário do sistema. Use placeholders (`<serverId>`, `<sessionId>`, `192.168.1.x`, `$HOME`) e tarje capturas antes do commit. Rode `npm run check:privacy`; o hook `.githooks/pre-commit` bloqueia o commit se encontrar um padrão proibido.

## 5. Onde adicionar coisas

- Novo campo de input/experimento: `src/core/input-packet.ts` + teste byte a byte + `docs/XBOX_PROTOCOL.md`.
- Novo endpoint REST: `src/relay/server.ts` + teste em `tests/server.test.ts`.
- Novo serviço: `src/relay/*` com `fetch`/socket injetável, para testar sem rede.
- Nova tela web: `dashboard/main.ts` + `public/index.html` + CSS.
- Nova tela Android: `apps/android/src/screens`.
- Novo mapeamento de controle: `src/core/gamepad.ts` (web) e `apps/android/.../GamepadMapper.kt` (nativo), mantendo os mesmos bits.

## 6. Convenções

- TypeScript estrito, ESM, imports com `.js`.
- Nada de dependências novas sem justificativa; o relay deve rodar em Node 20+.
- Português na UI e na documentação; inglês nos comentários de código e nomes de API.
- Logs estruturados com `logger.child('scope')`.
- Erros de API retornam `{ error, message }` e status adequado.
- O dashboard não deve quebrar se o relay cair; o WS reconecta.
- Antes de commitar, rode `npm run check:privacy`. Ative o hook com `git config core.hooksPath .githooks` (uma vez por clone).
- Termos sensíveis específicos vão em `.privacy-denylist` (gitignored), um por linha; nunca versione esse arquivo.
- Em capturas, tarje nome, gamertag, e-mail, IDs de console/sessão e IPs antes de salvar em `docs/evidence/`.

## 7. Armadilhas conhecidas

- **werift + Chrome:** o answer do werift com áudio/vídeo não é aceito pelo Chrome (BUNDLE/RTCP mux). O mock força `media=false`. Não “conserte” isso habilitando mídia no mock sem testar.
- **RN 0.76 + Gradle:** use `autolinkLibrariesFromCommand()` e `SoLoader.init(this, OpenSourceMergedSoMapping)`. Sem isso o app crasha com `libhermes_executor.so not found`.
- **SDP real:** o primeiro SDP enviado em uma sessão precisa ter áudio/vídeo. Uma tentativa data-only deixa a sessão em `SessionInUnexpectedState`; encerre e abra outra antes de tentar de novo.
- **WakeUp:** console em `ConnectedStandby` pode responder `WaitingForServerToRegister`; envie `Power/WakeUp` via xccs e aguarde o ping/estado `On`.
- **Physicality:** o modo co-op usa `0/0` (Better xCloud); o padrão Greenlight é `1/1`. Ainda não há prova de que 0/0 resolva as quatro identidades; teste com dois perfis.
- **Buffer no browser:** o core usa `Uint8Array`, não `Buffer`. Não reintroduza APIs Node no código compartilhado.
- **`evaluateJavascript`:** deve rodar na thread principal; o `XboxLocalHubTransportView` cuida disso.
- **Android `InputDevice`:** `SOURCE_JOYSTICK`/`SOURCE_GAMEPAD`; ignore dispositivos virtuais. Eventos chegam pela Activity em foco.
- **Heartbeat nativo:** o dashboard expira um slot nativo após 1,5 s sem frames; o app envia a 60 Hz.
- **Token de acesso:** a URL do dashboard inclui `?token=`; o bundle o guarda em `sessionStorage`. Não coloque o token em logs.
- **Rotas estáticas:** somente `/`, `/app.js`, `/styles.css`, `/favicon.ico`; não abra um servidor de arquivos genérico.

## 8. Definição de pronto para a fase 1

- [x] Protocolo de entrada documentado e testado.
- [x] Sessão xHome implementada e testada contra API mockada.
- [x] WebRTC + handshake + 4 índices testados em Chrome real.
- [x] Dashboard e diagnóstico operacionais.
- [x] App Android escrito, compilado e instalado no Moto G200.
- [x] Uma entrada remota real moveu o dashboard do Xbox (D-Pad/A).
- [x] Quatro `gamepadIndex` registrados e aceitos pelo console.
- [ ] Quatro identidades de jogador confirmadas em um jogo local (ou limite documentado).
- [ ] Coexistência com controles locais testada.
- [ ] Captura de controles Bluetooth físicos no Moto G200 testada.

Ao concluir os itens de hardware, atualize `docs/MVP_RESULTS.md` e anexe logs/capturas. Não altere resultados de teste sem evidência.

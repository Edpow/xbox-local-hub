# Testes e validação

## 1. Testes automatizados

```bash
npm test            # 39 testes (protocolo, REST, players, API)
npm run test:e2e    # 1 teste ponta a ponta em Chrome real + mock console
npm run typecheck
```

### Cobertura atual

| Suíte | O que valida |
|---|---|
| `tests/input-packet.test.ts` | layout binário byte a byte, 4 índices, eixos negados, triggers, metadata, clamping |
| `tests/discovery-channels.test.ts` | request/response SmartGlass, strings, certificado, mensagens de controle e handshake |
| `tests/xbox-rest.test.ts` | URLs, headers, corpos, polling de estado/SDP/ICE, erros, lista de consoles |
| `tests/player-manager.test.ts` | P1–P4, duplicidade, persistência, arquivo corrompido |
| `tests/server.test.ts` | health/state/consoles/sessão mock, token de acesso, validação, estáticos |
| `tests/e2e/dashboard.test.ts` | Chrome → WebRTC → handshake → 4 slots → frames independentes → mock decodifica |

O e2e usa `playwright-core` com um Chrome do sistema. Ele procura, nesta ordem:

1. `CHROME_PATH`;
2. `/home/edgar/.local/bin/google-chrome`;
3. `/usr/bin/google-chrome`;
4. `/usr/bin/chromium`;
5. `/usr/bin/chromium-browser`.

Se não encontrar, o teste é pulado. A evidência visual é salva em `docs/evidence/dashboard-mock-4-slots.png`.

### O que o e2e prova

- o dashboard cria um peer WebRTC real;
- o relay troca SDP/ICE com o mock;
- os canais `message`, `control` e `input` abrem;
- o handshake e a autorização são enviados;
- quatro slots são registrados;
- o mock decodifica frames com índices 0,1,2,3 e valores de botões/eixos distintos;
- não há erro de página no Chrome.

### O que o e2e não prova

- compatibilidade com o Xbox real;
- autenticação concluída;
- captura de Bluetooth real;
- limite de identidades do console.

## 2. Teste do relay real (sem console)

```bash
npm run build
npm start
# em outro terminal:
curl -s http://127.0.0.1:8787/api/health
curl -s http://127.0.0.1:8787/api/state
npm run discover
npm run doctor
```

A descoberta pode falhar em containers/VPNs. Erros de broadcast são esperados; teste em uma rede doméstica.

## 3. Teste de autenticação

```bash
npm run auth
```

O terminal imprime um código e um link. Depois de autenticar:

```bash
npm run consoles
```

Deve listar o console com `id` (serverId). Se retornar 401/403, o token XSTS de `xboxlive.com` ou o `uhs` estão errados.

## 4. Roteiro de hardware (fase 1)

Pré-requisitos:

- Xbox One S ligado, Remote Play habilitado, mesma rede do relay;
- conta Microsoft com o console associado;
- Chrome atualizado;
- 1–4 controles Bluetooth;
- opcional: Android com o app compilado.

Passos:

1. `npm run build && npm start -- --host=0.0.0.0`
2. Abra a URL impressa (com token) no Chrome do celular/PC.
3. Login → procurar consoles → conectar.
4. Confirme: sessão `Provisioned`, peer `connected`, handshake `ok`.
5. Conecte um controle; confirme o slot na UI.
6. Pressione A. **Observe o Xbox.** Se o jogo/lobby reagir, a comunicação básica está provada.
7. Teste analógicos e gatilhos.
8. Repita com 2 e 4 controles; anote o que o console mostra.
9. Teste `Pulso de teste (todos)` para separar problema de captura de problema de identidade.
10. Teste coexistência com um controle físico.
11. Teste sem mídia (checkbox desmarcado) e registre o resultado.
12. Baixe o JSONL de diagnóstico e anexe ao relatório.

## 5. Teste do app Android

Requer JDK 17 e Android SDK 35. O build foi executado com sucesso no ambiente do MVP.

```bash
export JAVA_HOME=/caminho/jdk-17
export ANDROID_HOME=/caminho/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH

cd apps/android
npm install
npx react-native start --port 8081   # terminal 1

cd android
gradle assembleDebug                 # terminal 2
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787        # relay local via USB
adb shell am start -n com.xboxlocalhub/.MainActivity
```

Se o relay estiver em outro PC na Wi-Fi, não use `adb reverse`: configure no app a URL `http://IP:8787` e o token de `--host=0.0.0.0`.

### Armadilhas de build encontradas

- RN 0.76.5 usa `ex.autolinkLibrariesFromCommand()` em `settings.gradle` (não `autolinkLibrariesWithApp()`).
- É necessário `@react-native-community/cli@15` para o Metro subir.
- `SoLoader.init(this, OpenSourceMergedSoMapping)` é obrigatório no RN 0.76; sem isso o app morre com `libhermes_executor.so not found`.
- A verificação do Play Protect pode bloquear `adb install`; use `adb install -r -d` ou desabilite o verificador para o teste.
- O `WebView` precisa de `setWebContentsDebuggingEnabled(true)` para o teste via CDP; o app habilita em debug.

Checklist:

- [x] `adb devices` mostra o Moto G200.
- [x] O app abre e o relay responde (health OK).
- [x] O WebView carrega o dashboard do relay.
- [x] O frame pump nativo está ativo.
- [x] A sessão real conecta pelo WebView e o handshake fica OK.
- [x] Entrada sintética pelo bridge nativo chega ao Xbox.
- [ ] Um controle Bluetooth físico aparece com nome e `deviceId`.
- [ ] Um evento de botão físico atualiza o slot correto.
- [ ] Quatro controles físicos aparecem; cada `deviceId` fica em um slot.
- [ ] Girar a tela não perde a captura.
- [ ] Pausar/retomar o app mantém a sessão.

## 6. Diagnóstico de problemas

| Sintoma | Verificação |
|---|---|
| “Dashboard não encontrado” | `npm run build:dashboard` |
| Auth 401 | token expirado; refaça o login |
| Console não aparece | Remote Play habilitado? mesma rede? `npm run discover` |
| `Provisioned` mas peer `new` | SDP/ICE rejeitado; veja `logs/relay.jsonl` |
| Peer `connected`, handshake `pendente` | canal `message` não abriu; firewall/ICE |
| Handshake ok, sem pacotes | nenhum slot reivindicado ou nenhum controle associado |
| Slots aparecem, jogo não reage | índice não aceito pelo console — registrar como limitação |
| Controle “sumiu” | heartbeat nativo expirou (>1,5 s) ou BT desconectou |
| Mock conecta, real não | problema de SDP/ICE real, não do encoder |

## 7. Evidências

- `docs/evidence/dashboard-mock-4-slots.png` — e2e com quatro slots.
- `docs/evidence/app-android-status.png` — app no Moto G200.
- `docs/evidence/phone-real-session.png` — dashboard real no celular.
- `docs/evidence/xbox-real-home-youtube-focus.png` / `xbox-real-home-skyforce-focus.png` — prova do D-Pad.
- `docs/evidence/xbox-real-jedi-details.png` / `xbox-real-game-launched.png` — prova do A.
- `docs/evidence/xbox-real-p1-prompt.png` / `xbox-real-coop-p2-attempt.png` — tentativa de co-op.
- Logs JSONL por execução em `~/.config/xbox-local-hub/logs/relay.jsonl`.
- Para o relatório de hardware, anexar:
  - captura do dashboard (diagnóstico);
  - captura do lobby do jogo;
  - JSONL;
  - modelo/firmware do console e dos controles.

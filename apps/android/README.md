# App Android — Xbox Local Hub

React Native (TypeScript) + módulo nativo Kotlin para capturar controles Bluetooth e alimentar o dashboard WebRTC.

> **Status:** compilado, instalado e executado no Moto G200 5G (Android 12) durante a fase 1. O bridge nativo e o frame pump foram validados; a captura de controles Bluetooth físicos ainda precisa ser exercitada com hardware.

## Arquitetura

```text
MainActivity (dispatchKeyEvent / dispatchGenericMotionEvent)
        │
        ▼
ControllerHub (singleton, main thread, 60 Hz)
  ├─ ControllerDiscovery/InputManager (add/remove)
  ├─ GamepadMapper (KeyEvent/MotionEvent → bitmask/eixos)
  ├─ NativePlayerManager (P1..P4 em SharedPreferences)
  └─ FrameSink
        │ JSON a 60 Hz
        ▼
XboxLocalHubTransportView (WebView nativo)
        │ evaluateJavascript
        ▼
window.XLH.setNativeFrame(...)  → dashboard → WebRTC → Xbox
```

O caminho de alta frequência **não passa pela bridge do React Native**. A bridge é usada apenas para:
- lista de controles e associação P1–P4;
- logs de diagnóstico;
- URL/token do relay;
- botões de manutenção.

## Build

Requisitos: JDK 17, Android SDK 35, Node 18+, um dispositivo com depuração USB.

```bash
export JAVA_HOME=/caminho/jdk-17
export ANDROID_HOME=/caminho/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH

npm install
npx react-native start --port 8081        # terminal 1

cd android
gradle assembleDebug                      # ou ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081             # Metro
adb reverse tcp:8787 tcp:8787             # relay, se estiver em 127.0.0.1
adb shell am start -n com.xboxlocalhub/.MainActivity
```

Se o relay estiver em outro PC na mesma Wi-Fi:

1. no PC: `npm start -- --host=0.0.0.0`;
2. no app, aba **Status**, use `http://IP-DO-PC:8787` e o token gerado;
3. a URL do dashboard no WebView já inclui o token.

### Notas de build (RN 0.76.5)

- `settings.gradle` usa `autolinkLibrariesFromCommand()`.
- `MainApplication` usa `SoLoader.init(this, OpenSourceMergedSoMapping)`.
- O Metro exige `@react-native-community/cli@15`.
- O Play Protect pode bloquear a instalação: `adb install -r -d` ou desative o verificador no aparelho.
- O WebView habilita depuração remota em builds debug (`chrome://inspect` / CDP).

## Permissões

- `BLUETOOTH_CONNECT` (Android 12+) para ler nomes/estado dos dispositivos.
- `INTERNET` para o relay.
- Nenhuma permissão de root, overlay ou acessibilidade.

O pareamento Bluetooth é feito no sistema Android (Configurações → Bluetooth). O app apenas lê os `InputDevice` resultantes.

## Mapeamento

Bitmask idêntico a `src/core/gamepad.ts` / protocolo Xbox:

| Android | Bit |
|---|---|
| `KEYCODE_BUTTON_A/B/X/Y` | 0x10/0x20/0x40/0x80 |
| `KEYCODE_BUTTON_L1/R1` | 0x1000/0x2000 |
| `KEYCODE_BUTTON_THUMBL/R` | 0x4000/0x8000 |
| `KEYCODE_BUTTON_START` | 0x0004 (Menu) |
| `KEYCODE_BUTTON_SELECT` | 0x0008 (View) |
| `KEYCODE_BUTTON_MODE` | 0x0002 (Nexus) |
| D-Pad | 0x0100–0x0800 |
| `AXIS_X/Y` | stick esquerdo (−1..1) |
| `AXIS_RX/RY` (fallback `Z/RZ`) | stick direito |
| `AXIS_LTRIGGER/RTRIGGER` (fallback `BRAKE/GAS`) | gatilhos 0..1 |
| `AXIS_HAT_X/Y` | D-Pad analógico |

O eixo Y é mantido positivo para baixo (Android/Gamepad API); o encoder TS aplica a negação do protocolo. Deadzone de 8%.

## Associação P1–P4

- O primeiro evento de um controle novo o associa ao primeiro slot livre.
- Um controle só pode ocupar um slot.
- A associação é persistida em `SharedPreferences` (`xlh.players`).
- O dashboard expira a entrada nativa se ficar 1,5 s sem frames; o app envia a 60 Hz.
- A UI permite remapear ou liberar um slot.

## Diagnóstico

A aba **Diagnóstico** mostra:
- eventos de conexão/remoção de `InputDevice`;
- associação de slots;
- snapshot com bitmask/eixos por controle;
- logs nativos.

O dashboard mostra:
- pacotes/s, slots registrados, handshake;
- mensagens de controle;
- estado do peer/ICE;
- vídeo real (prévia opcional).

## Limitações atuais

- A captura de controles Bluetooth **físicos** ainda não foi testada neste aparelho; o bridge foi validado com entradas sintéticas.
- O app depende do relay (PC ou Termux) para auth/sessão; o WebView é o transporte WebRTC.
- O frame pump usa `evaluateJavascript` a 60 Hz; medir latência real no aparelho é o próximo passo.
- Quatro identidades de jogador no console dependem do teste co-op com dois perfis (ver `docs/MULTIPLAYER.md`).
- O app é Android-only nesta fase (o dashboard web roda em qualquer Chrome).

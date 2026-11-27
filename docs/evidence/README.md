# Evidências

Capturas geradas durante a fase 1.

## Software (mock)

- `dashboard-mock-4-slots.png` — e2e com Chrome real contra o console simulado (`npm run test:e2e`). Mostra 4 slots, peer conectado e pacotes/segundos. **Não é prova de compatibilidade com o Xbox.**

## Hardware real (Xbox One S + Moto G200)

- `app-android-status.png` — app React Native + Kotlin instalado no Moto G200, relay OK, captura ativa.
- `phone-real-session.png` — dashboard no WebView do celular com sessão xHome real e transporte aberto.
- `xbox-real-home-youtube-focus.png` — frame 1280×720 do dashboard do Xbox, foco em YouTube.
- `xbox-real-home-skyforce-focus.png` — após dois D-Pad Right enviados pelo celular, foco em Sky Force.
- `xbox-real-jedi-details.png` — A remoto abriu os detalhes de Jedi: Fallen Order.
- `xbox-real-game-launched.png` — A remoto iniciou o jogo.
- `xbox-real-p1-prompt.png` — Sky Force reconhece P1 (perfil do teste) e pede um botão.
- `xbox-real-skyforce-menu.png` — menu principal do Sky Force.
- `xbox-real-coop-p2-attempt.png` — tentativa de P2 no co-op; o jogo não criou a segunda nave.

> Os frames do Xbox foram capturados do transceiver WebRTC de vídeo usado apenas para diagnóstico. O MVP não exibe/retransmite o vídeo na UI normal.

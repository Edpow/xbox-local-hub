# Multiplayer — hipótese, evidências e plano de prova

## 1. Pergunta central

A pergunta da fase 1 não é “o Android enxerga quatro controles?”, e sim:

> **Uma única sessão Remote Play aceita quatro identidades independentes (`gamepadIndex` 0–3) e o console as apresenta como quatro jogadores?**

Detectar quatro controles no Android é pré-requisito, não aprovação.

## 2. Hipótese de trabalho

```text
Um peer WebRTC
  ├─ canal control: gamepadChanged(0,true) … gamepadChanged(3,true)
  └─ canal input:   frames com GamepadIndex 0,1,2,3
                    → o console mapeia cada índice para um slot local
```

O console provavelmente trata cada índice como um controle “virtual” local. Os campos `physicalPhysicality`/`virtualPhysicality` do frame podem influenciar essa classificação; o MVP replica os valores da referência (1/1) e permite experimentar.

## 3. Evidências a favor

| Evidência | Onde |
|---|---|
| O frame tem um byte de índice de gamepad | `xbox-xcloud-player/src/channel/input/packet.ts` |
| O controle tem `gamepadChanged` com índice arbitrário | `control.ts` |
| O Greenlight declara slots `0..3` | `ControlChannel` em `channel/control.ts` |
| O XStreaming usa índice 0 e 1 no modo co-op | `src/webrtc/Channel/Control.ts` |
| Jogos Xbox suportam até 4 jogadores locais | documentação dos jogos, não do protocolo |

## 4. Evidências de risco

| Risco | Detalhe |
|---|---|
| Limite de dois | XStreaming só oferece co-op de 2 jogadores; pode ser limitação do app ou do serviço. |
| Identidade compartilhada | Se o servidor ignorar o índice, todos os frames caem no P1. |
| “Physicality” | O console pode aceitar apenas um controle “physical” e tratar os demais como virtuais com regras diferentes. |
| Controles locais | Um controle físico ligado ao Xbox pode ocupar o slot que o índice remoto tentaria usar. |
| Política de conta | O Remote Play pode limitar uma sessão por conta/console. |
| Firmware | One S original, firmwares recentes podem ter mudado o comportamento. |

## 5. Como o MVP instrumenta a prova

- **Slots independentes:** o dashboard mantém um estado por slot e envia apenas os slots registrados.
- **`gamepadChanged` explícito:** `Reivindicar slots ativos` envia `wasAdded: true` para cada slot; `Liberar slots` envia `false`.
- **Pulso sintético:** `Pulso de teste (todos)` gera A nos quatro índices, permitindo testar o protocolo sem quatro controles físicos. É marcado como sintético.
- **Diagnóstico:** pacotes/s, slots registrados, frames por slot, botões/eixos do último frame, mensagens de controle, estado do peer.
- **Mock console:** decodifica os pacotes e mostra exatamente o que chegaria ao console, com quatro índices.
- **Logs:** JSONL com timestamps para anexar ao relatório.

## 5.1. Resultado do teste real (27/11/2026)

O que foi feito no Xbox One S real:

- sessão xHome `Provisioned`, WebRTC conectado e handshake concluído;
- `gamepadChanged` enviado para 0,1,2,3; mais de 300 pacotes com quatro índices;
- D-Pad/A do P1 moveram o foco no dashboard e iniciaram jogos;
- A do P2/P3/P4 também navegou no dashboard (esperado: qualquer controle navega);
- no Sky Force, o Start/A do P2 **não criou uma segunda nave**; o jogo tratou o comando como P1;
- o Sky Force exige **dois perfis/controles logados** para co-op local; o console estava com um perfil ativo.

Conclusão parcial: **quatro índices são aceitos e processados**, mas a separação em jogadores não foi observada. Pode ser (a) limitação da sessão Remote Play, que soma os índices no jogador ativo; (b) requisito de dois perfis do jogo; ou (c) falta de um ajuste de protocolo (physicality/registro).

Evidências: [xbox-real-p1-prompt.png](evidence/xbox-real-p1-prompt.png), [xbox-real-coop-p2-attempt.png](evidence/xbox-real-coop-p2-attempt.png).

## 5.2. Pista do Better xCloud

O Better xCloud implementa co-op local em Remote Play/xCloud. Dois detalhes do código público:

1. ele usa `PhysicalPhysicality: 0` e `VirtualPhysicality: 0` nos mappings;
2. ele patcheia o cliente oficial para que `gamepadStates` seja indexado por `GamepadIndex` (em vez de um estado único).

O MVP já envia `GamepadIndex` por frame. Foi adicionado um modo experimental que envia `physicality 0/0` (checkbox “Modo co-op”). O próximo teste deve ativá-lo com **dois perfis logados** e um jogo de co-op.

Referências:
- https://github.com/redphx/better-xcloud/blob/main/src/utils/gamepad.ts
- https://github.com/redphx/better-xcloud/blob/main/src/modules/patcher/patches/src/local-co-op-enable.ts
- https://www.reddit.com/r/xcloud/comments/1b5d4dl/new_better_xcloud_feature_play_local_coop_games/

Aviso: o suporte oficial da Microsoft/xbPlay indica que o Remote Play normalmente encaminha apenas um controle e soma os demais no jogador ativo. O Better xCloud contorna isso no cliente. Portanto, a conclusão final depende de um teste controlado.

## 6. Matriz de teste de hardware

Execute na ordem. Não avance sem registrar o resultado anterior.

| # | Cenário | Ação | Critério de aprovação |
|---|---|---|---|
| M0 | Console | Remote Play habilitado; console ligado e na LAN | Lista Xbox Live mostra o console e IP |
| M1 | Sessão | Conectar no dashboard | `Provisioned`, peer `connected`, handshake `ok` |
| M2 | Um controle remoto | 1 controle BT no celular/navegador, P1, A | Personagem/UI do Xbox reage ao A do P1 |
| M3 | Um controle, analógicos | Mover LX/LY/RT | Movimento e gatilho corretos, sem drift |
| M4 | Dois controles | P1 e P2, botões distintos | Cada jogador controla seu próprio slot no lobby |
| M5 | Quatro controles | P1–P4 | Lobby/jogo reconhece 4 jogadores independentes |
| M5a | Quatro índices (feito) | 4 slots sintéticos | Console aceita os 4 índices e processa botões — **passou** |
| M5b | Co-op 2 perfis | Sky Force com 2 perfis + modo co-op | Segunda nave/jogador aparece — **pendente** |
| M6 | Sintético | `Pulso de teste (todos)` | Diagnóstico mostra 4 índices; console reage se o jogo permitir |
| M7 | Coexistência | 2 remotos + 1 controle físico no Xbox | Todos controlam; nenhum “rouba” o slot do outro |
| M8 | Vídeo off | Desmarcar “negociar vídeo/áudio” e reconectar | Registrar se o console aceita data-only |
| M9 | Reconexão | Desligar/ligar um controle BT | Slot volta sem reiniciar a sessão |

### Registro mínimo por cenário

```text
Data/hora:
Console (modelo/firmware):
Jogo e modo multiplayer:
Controles (modelo, conexão BT/BLE):
Slots registrados no diagnóstico:
Pacotes/s:
Resultado observado no jogo:
Log JSONL anexado? (sim/não)
```

## 7. Interpretação dos resultados

### Aprovado para multiplayer

- M5 passa e o jogo/lobby mostra quatro jogadores distintos;
- cada botão afeta somente o jogador esperado;
- M7 não derruba a sessão.

### Aprovado parcial (limite documentado)

- M4 passa, M5 falha ou só dois índices são aceitos;
- documentar que o protocolo/console limita a dois jogadores remotos;
- a arquitetura passa a oferecer “2 remotos + 2 locais” como cenário suportado.

### Reprovado

- Nenhum índice remoto é aceito;
- o console rejeita o SDP/handshake;
- a sessão só funciona com o app oficial.

Nesse caso, a limitação é de plataforma, não do app, e deve ser registrada com evidências (logs, capturas, firmware).

## 8. Coexistência com controles locais

Hipótese: o console soma os controles físicos (via rádio Xbox) e os virtuais da sessão. Problemas possíveis:

- o controle físico assume o slot 0 e o virtual 0 fica sem identidade;
- o console pede “pressione A para entrar” em cada controle;
- o Remote Play bloqueia input local enquanto transmite.

Procedimento: entrar com um controle físico, verificar o jogador dele no lobby e então reivindicar P1–P4 remotos. Registrar a ordem de entrada e quem ocupa cada slot.

## 9. O que não conta como aprovação

- Quatro controles aparecendo no Android.
- Quatro slots aparecendo no dashboard.
- Quatro pacotes sendo decodificados pelo mock.
- Botões mudando na UI sem o jogo reagir.

Esses são pré-requisitos. A aprovação exige **reação observada no console**, com identidade separada.

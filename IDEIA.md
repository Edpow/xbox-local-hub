# Xbox Local Hub

**Documento:** IDEIA.md  
**Versão:** 1.1  
**Plataforma inicial:** Android + Xbox One S  
**Objetivo:** Central multiplayer de controles Bluetooth.

## 1. Visão geral

O Xbox Local Hub é um aplicativo Android desenvolvido para transformar um smartphone em uma central de gerenciamento e encaminhamento de controles Bluetooth para um console Xbox One S.

A proposta é permitir que até quatro controles Bluetooth conectados ao smartphone sejam utilizados como controles independentes no Xbox, possibilitando partidas multiplayer locais.

Inicialmente, o aplicativo não realizará streaming de vídeo ou áudio. A imagem do jogo continuará sendo exibida diretamente na televisão conectada ao Xbox.

## 2. Objetivo principal

Desenvolver uma solução exclusivamente por software que permita:

- Conectar até quatro controles Bluetooth ao Android.
- Identificar individualmente cada controle.
- Associar cada controle a um jogador.
- Estabelecer comunicação com o Xbox One S.
- Encaminhar comandos individuais ao console.
- Permitir coexistência com controles conectados diretamente ao Xbox.

Não serão utilizados adaptadores físicos, Arduino, microcontroladores ou dongles adicionais.

## 3. Cenário inicial

### Console
- Xbox One S.
- Sistema original.
- Sem necessidade de desbloqueio.
- Conectado à rede local.

### Smartphone
- Motorola Moto G200 5G.
- Android 12.
- Wi-Fi 6.
- Bluetooth integrado.

### Controles
- Até quatro controles Bluetooth conectados ao smartphone.
- Possibilidade de utilizar controles adicionais conectados diretamente ao Xbox.

### Ambiente

O celular funcionará como central de controles. Os jogadores visualizarão o mesmo jogo na televisão conectada ao Xbox.

## 4. Conceito de funcionamento

O fluxo esperado:

1. O aplicativo identifica os controles Bluetooth.
2. O usuário associa os dispositivos aos jogadores P1–P4.
3. O Input Engine captura os comandos.
4. Os comandos são normalizados individualmente.
5. O Controller Bridge encaminha as entradas ao Xbox.
6. O Xbox reconhece os jogadores e processa os comandos.

O sistema deverá preservar a independência dos jogadores.

Não será suficiente combinar os comandos de quatro controles em um único dispositivo lógico.

## 5. Arquitetura

### 5.1. Android Client

Responsável pela interface e gerenciamento geral.

### 5.2. Bluetooth Device Manager

- Detectar controles.
- Identificar dispositivos.
- Monitorar conexões.
- Recuperar dispositivos reconectados.

### 5.3. Player Manager

- Gerenciar P1, P2, P3 e P4.
- Associar dispositivos.
- Salvar configurações.
- Evitar associações duplicadas.

### 5.4. Input Engine

- Capturar botões.
- Capturar analógicos.
- Capturar gatilhos.
- Normalizar estados.
- Aplicar mapeamentos.
- Preservar estados independentes.

### 5.5. Xbox Connection Manager

- Descobrir o Xbox na rede.
- Gerenciar autenticação.
- Estabelecer sessão.
- Monitorar conexão.
- Gerenciar reconexões.

### 5.6. Controller Bridge

Responsável pelo encaminhamento dos comandos ao Xbox.

Deverá utilizar mecanismos de comunicação comprovados e compatíveis com o console.

### 5.7. Diagnostics

- Monitoramento dos controles.
- Estado da conexão Xbox.
- Latência.
- Eventos recebidos.
- Falhas de comunicação.
- Histórico de testes.

## 6. Arquitetura de comunicação

```text
MOTO G200
│
├── Bluetooth Device Manager
│   ├── Controle P1
│   ├── Controle P2
│   ├── Controle P3
│   └── Controle P4
│
├── Player Manager
│
├── Input Engine
│
├── Xbox Connection Manager
│
└── Controller Bridge
        │
        │ Wi-Fi / LAN
        ▼
    XBOX ONE S
        │
        ├── Jogo multiplayer
        ├── Entradas remotas
        └── Controles Xbox locais
```

A arquitetura deverá permitir que os controles conectados diretamente ao Xbox continuem funcionando pelo mecanismo original do console.

A coexistência com os controles remotos deverá ser comprovada experimentalmente.

## 7. Tecnologias

| Componente | Tecnologia |
|---|---|
| Aplicativo | React Native |
| Linguagem principal | TypeScript |
| Integração Android | Kotlin |
| Bluetooth | Android InputDevice |
| Eventos | KeyEvent / MotionEvent |
| Rede | TCP / UDP, conforme protocolo |
| Persistência | SQLite |
| Configuração | JSON |
| Diagnóstico | Logs estruturados |

A captura de controles e operações sensíveis à latência deverão utilizar componentes nativos Kotlin.

## 8. Primeira fase — Prova de conceito integrada

**Esta é a primeira entrega obrigatória do projeto.**

O objetivo é validar simultaneamente o smartphone, os controles Bluetooth e a comunicação com o Xbox One S.

Não devemos desenvolver todo o aplicativo antes de comprovar essa integração.

### 8.1. Descoberta do Xbox

- Localizar o console na rede local.
- Identificar endereço IP.
- Identificar serviços disponíveis.
- Verificar disponibilidade de conexão.
- Registrar informações do console.

### 8.2. Autenticação e sessão

Investigar os mecanismos de autenticação e conexão utilizados pelo Xbox Remote Play.

Utilizar como referência implementações existentes de código aberto, especialmente o XStreaming.

Validar:

- Autenticação.
- Estabelecimento de sessão.
- Comunicação com o console.
- Possibilidade de manter a sessão sem renderização de vídeo.

### 8.3. Detecção dos controles

- Conectar um controle Bluetooth.
- Detectar o dispositivo no Android.
- Ler botões e analógicos.
- Repetir o procedimento com quatro controles.
- Verificar a independência dos eventos.

### 8.4. Teste de encaminhamento

- Implementar um primeiro adaptador de entrada.
- Enviar comandos pela comunicação validada.
- Verificar se o Xbox recebe os comandos.
- Testar movimentação e botões.
- Verificar o reconhecimento individual dos jogadores.

### 8.5. Teste multiplayer

Validar progressivamente:

1. Um controle conectado ao celular.
2. Dois controles conectados ao celular.
3. Quatro controles conectados ao celular.
4. Controles conectados ao celular e diretamente ao Xbox.

### 8.6. Resultado esperado

Ao final da primeira fase, teremos uma resposta técnica documentada sobre:

- Viabilidade de conexão Android–Xbox.
- Autenticação e estabelecimento de sessão.
- Comunicação sem streaming de vídeo.
- Possibilidade de encaminhamento de comandos.
- Reconhecimento de entradas independentes.
- Limitações do protocolo Xbox.

**Critério de aprovação:** comprovar pelo menos uma entrada remota funcional e determinar se o protocolo permite quatro identidades independentes.

A detecção de quatro controles no Android, isoladamente, não caracteriza aprovação da integração multiplayer.

## 9. Restrições técnicas

O Xbox One S não oferece uma API pública genérica para receber quatro controles Bluetooth encaminhados por um aplicativo Android.

O Remote Play convencional não deve ser considerado automaticamente compatível com essa finalidade.

A investigação deverá considerar:

1. Protocolo de entrada remota.
2. Autenticação e autorização.
3. Comunicação sem transmissão de vídeo.
4. Suporte a múltiplas identidades.
5. Coexistência com controles locais.
6. Restrições de firmware e sessão.

Não implementar protocolos presumidos ou APIs inexistentes.

Se não for possível estabelecer a comunicação desejada exclusivamente por software, a limitação deverá ser documentada.

## 10. Estrutura inicial

```text
Xbox-Local-Hub/
│
├── android/
│   └── app/src/main/java/com/xboxlocalhub/
│       ├── bluetooth/
│       ├── input/
│       ├── network/
│       ├── xbox/
│       └── diagnostics/
│
├── src/
│   ├── app/
│   ├── components/
│   ├── controllers/
│   ├── multiplayer/
│   ├── xbox/
│   ├── diagnostics/
│   └── settings/
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── MULTIPLAYER.md
│   ├── XBOX_PROTOCOL.md
│   └── TESTING.md
│
├── scripts/
│
├── AGENTS.md
├── IDEIA.md
└── README.md
```

## 11. Interface

### Tela principal

- Estado do Xbox.
- Endereço IP.
- Estado da sessão.
- Quantidade de controles conectados.
- Jogadores ativos.
- Botão de conexão.

### Tela multiplayer

- Quatro posições de jogadores.
- Identificação dos controles.
- Associação manual.
- Estado de conexão.
- Teste de botões e analógicos.

### Tela de diagnóstico

- Informações da sessão Xbox.
- Eventos de entrada.
- Latência.
- Estado da comunicação.
- Logs técnicos.

## 12. Etapas de desenvolvimento

| Fase | Entrega |
|---|---|
| 1 | Prova de conceito integrada Android + Xbox |
| 2 | Input Engine e normalização |
| 3 | Player Manager P1–P4 |
| 4 | Controller Bridge |
| 5 | Multiplayer com entradas independentes |
| 6 | Coexistência com controles locais Xbox |
| 7 | Otimização de latência |
| 8 | Interface definitiva |
| 9 | APK e documentação |

A fase 1 deverá produzir um protótipo executável, não apenas documentação.

## 13. Critérios de aceitação

- [ ] Detectar o Xbox One S.
- [ ] Estabelecer comunicação com o console.
- [ ] Validar autenticação.
- [ ] Investigar sessão sem streaming de vídeo.
- [ ] Detectar quatro controles Bluetooth.
- [ ] Ler eventos individualmente.
- [ ] Encaminhar pelo menos uma entrada ao Xbox.
- [ ] Comprovar reconhecimento da entrada.
- [ ] Investigar suporte a quatro jogadores independentes.
- [ ] Documentar limitações e resultados.

## 14. Evolução futura

Após a validação inicial:

- Streaming de vídeo.
- Streaming de áudio.
- Controle touch.
- Compatibilidade com outros consoles.
- Suporte a mais jogadores.
- Perfis de controles.
- Estatísticas de desempenho.

## 15. Diretriz principal

O Xbox Local Hub deverá priorizar a comprovação da viabilidade técnica antes da construção de funcionalidades secundárias.

A primeira fase deverá responder à pergunta fundamental:

**É possível utilizar o Moto G200 como uma central de controles Bluetooth, comunicando-se diretamente com o Xbox One S e encaminhando comandos independentes para multiplayer, sem streaming de vídeo e sem hardware adicional?**

Essa resposta determinará a arquitetura definitiva do projeto.

**Versão inicial:** Xbox Local Hub 1.0 — Central Multiplayer de Controles Bluetooth, com integração Xbox desde a primeira fase.
# Fork local do Codex Skin (não é upstream)

> **16/11/2026** — o skin foi desativado neste Mac: sobrou só o plugin
> `codex-inbox` (~/projetos/hermes-inbox). Este diretório guarda o patch, o
> handoff e o teste do fork para o caso de o skin voltar.

O `plugin.js` instalado é o **release v1.13.0** do `FPSUnleashed/hermes-codex-skin`
+ o fork local, que hoje é **só uma coisa**: escolher quais perfis alimentam o
Inbox agregado.

## O que o fork adiciona (v1.13.0)

- **Seed dos chats recentes**: o Inbox do v1.13 só admite thread com atividade
  ao vivo, então perfil parado renderiza vazio. O fork readmite, uma vez por
  seleção, os ~20 chats mais recentes com mensagens de cada perfil escolhido e,
  depois disso, os chats tocados nas últimas 48h — por isso abrir uma sessão já
  faz ela aparecer.
- **Thread em andamento fica na lista**: o v1.13 move a conversa em andamento
  (inclusive a que você acabou de iniciar) para um grupo **Working** recolhido,
  então ela "some" e só volta quando o turno termina. O fork não usa esse grupo:
  a linha mantém sua posição e só o indicador de estado muda.
- **Refresh por evento**: o primeiro evento de uma sessão recém-criada não casa
  com metadata nenhuma (o `read` pede `min_messages=1`), então ela só aparecia no
  poll de 10s. Agora um evento no escopo que não resolve dispara um refetch
  limitado a 1 por 2s.
- **Lista única por recência**: as linhas dos perfis escolhidos são ordenadas
  juntas por `last_active`, senão o perfil ativo empurra o outro pro fim da
  rolagem.
- **Chip sempre visível para perfil não-default**: `C` (e qualquer outro perfil)
  aparece em toda linha, mesmo quando é o perfil ativo; `default` segue limpo e
  só ganha o ícone de casa em linha estrangeira.
- **Whitelist de perfis** (`inbox-profiles` no storage do plugin): lista de
  perfis ou `["*"]` para todos. É um *filtro* em cima do Universal Inbox nativo:
  perfis fora da lista não são lidos, não viram owner e não aparecem nas linhas
  (evento ao vivo de perfil oculto não acha owner e cai na validação de escopo
  que já existia).
- **Comando ⌘K `Codex Skin: Inbox profiles`** com picker de checkboxes.
  Salvar uma seleção liga o Universal Inbox (uma seleção não faz nada com a
  agregação desligada). Com seleção salva, o `readUniversalInbox` já assume
  ligado; o toggle explícito em Off continua ganhando.
- **Prova de inventário honesta**: com whitelist, só os perfis escolhidos
  precisam estar completos/desambiguados — perfil oculto sem rota ou com fonte
  fora do ar não trava o Inbox nem mantém linha velha viva.

## O que virou nativo no v1.13.0 (e o fork abandonou)

- Inbox multi-perfil/multi-conexão ("Universal Inbox (Beta)") com observers por
  owner, chip de perfil por linha (letra + cor determinística, `default` limpo),
  Settle/Snooze por perfil real, reconhecimento do sentinel `__hermesExpected404__`,
  eventos ao vivo por owner e o grupo Working redesenhado.
- Por isso o fork antigo (escopo sintético `*`, seed de chats, código de chip,
  shim de 404, Working sempre aberto) foi **removido**, não portado. Reaplicar
  aqueles hunks duplicaria/atropelaria o nativo.

## Inbox como plugin separado (`codex-inbox`)

O Inbox também é um plugin próprio (repo `~/projetos/hermes-inbox`, instalado em
`desktop-plugins/codex-inbox`). O skin não desenha um Inbox quando esse plugin
está carregado:

- o plugin publica `globalThis.__hermesCodexInboxOwner`;
- o skin publica `globalThis.__hermesCodexInboxHandoff` (desliga serviço, menu,
  eventos e runtime) e o plugin consome — vale em qualquer ordem de carregamento;
- sem o plugin instalado, o skin volta a mostrar o Inbox dele normalmente.

## O updater do plugin apaga isso

O botão de update baixa o release e sobrescreve `plugin.js`. Depois de cada
update rode:

```sh
~/.hermes/desktop-plugins/codex-chat-look/.fork/reapply.sh
```

Ele aplica `fork-agregado.patch`, roda `test/fork.test.mjs` (11 asserts) e só
então grava. Se um hunk não aplicar, restaura o `plugin.js` intacto e deixa os
`.rej` pro merge manual.

Depois de um update grande, atualize o patch:
`diff -u --label plugin.js --label plugin.js <release-novo>.js plugin.js > .fork/fork-agregado.patch`

## Seleção de perfis

O Inbox mostra **apenas** os perfis escolhidos no picker:
⌘K → `Codex Skin: Inbox profiles`. Estado atual: `["classificador-fiscal","default"]`.
Lido de `hermes.plugin.codex-chat-look.inbox-profiles` no localStorage do app.
Sem valor (ou `["*"]`) = todos os perfis, igual ao upstream.

## Testes (rodar depois de qualquer mudança)

```sh
node .fork/test/fork.test.mjs plugin.js      # 11 asserts do fork
```

## v1.13.0 (09/11/2026)

O update sobrescreveu o fork de novo (`plugin.js` == `update-staged.js`, fork
preservado em `update-rollback.js`). O v1.13.0 reescreveu o Inbox inteiro e
absorveu as features do fork; só a whitelist sobrou como diferença. Patch
regenerado contra a v1.13.0 pura: 232 linhas, 4 pontos de inserção/edição
(helpers + picker, filtro no `readUniversalInboxInventory`, refetch no evento,
comando no ⌘K). Dry-run reproduz o `plugin.js` exato; 11 asserts verdes.

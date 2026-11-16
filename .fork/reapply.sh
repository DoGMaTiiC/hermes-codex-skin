#!/bin/sh
# Re-aplica o fork local do Codex Skin (selecao de perfis no Inbox agregado)
# por cima do plugin.js que o updater acabou de instalar.
#   uso: ./.fork/reapply.sh
# Se algum hunk nao aplicar (upstream mexeu no mesmo trecho), restaura o
# plugin.js intacto e mostra os .rej para resolver a mao.
set -eu
here=$(cd "$(dirname "$0")" && pwd); dir=$(dirname "$here")
cp "$dir/plugin.js" "$here/.before.js"
if ! patch -s -p0 --forward --fuzz=1 -r "$here/.rej" "$dir/plugin.js" < "$here/fork-agregado.patch"; then
  cp "$here/.before.js" "$dir/plugin.js"; rm -f "$dir/plugin.js.orig"
  echo "PATCH FALHOU: plugin.js restaurado como estava. Hunks rejeitados em $here/.rej" >&2
  exit 1
fi
rm -f "$dir/plugin.js.orig"
if ! node --check "$dir/plugin.js"; then
  cp "$here/.before.js" "$dir/plugin.js"; echo "SYNTAX QUEBRADA: restaurado" >&2; exit 1
fi
if ! node "$here/test/fork.test.mjs" "$dir/plugin.js"; then
  cp "$here/.before.js" "$dir/plugin.js"; echo "TESTE FALHOU: restaurado" >&2; exit 1
fi
cp "$dir/plugin.js" "$dir/desktop/plugin.js"
rm -f "$here/.before.js"
echo "ok: fork re-aplicado em $dir/plugin.js"

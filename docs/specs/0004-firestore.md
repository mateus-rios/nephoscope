# SPEC-0004 — Firestore (completo) e modo Datastore

| | |
|---|---|
| **Status** | Rascunho |
| **Autor(es)** | |
| **Revisores** | |
| **Sistemas** | `apps/api/src/products/firestore` (`codec`, `structured-query`, `data`, `admin`, `rules`, `listen`) · `apps/api/src/products/datastore` · `apps/web/src/products/firestore` · `packages/contracts/src/firestore-value.ts` |
| **SDKs** | `@google-cloud/firestore`: o `v1.FirestoreClient` de baixo nível, o `v1.FirestoreAdminClient` de administração e a classe `Firestore` de alto nível · `@googleapis/firebaserules` · `@google-cloud/datastore` · `@google-cloud/monitoring` (uso) |
| **Spec relacionada** | [SPEC-0001](./0001-platform.md) (operações, canal ao vivo, confirmações, emuladores D-18) · [SPEC-0002](./0002-design-system.md) · [SPEC-0005](./0005-observability.md) (métricas de uso) · [SPEC-0006](./0006-messaging-storage.md) (buckets do Cloud Storage para export e import) |
| **Última atualização** | 2026-09-28 |
| **Versão** | 0.3 |

---

## 1. Resumo

O Firestore é a vitrine do Nephoscope (M2): o usuário pediu "completo". O Nephoscope cobre:
- **o plano de dados:** navegar, editar, consultar, agregar, explicar, escutar ao vivo, importar e exportar;
- **o plano de administração:** bancos, índices, TTL, export e import gerenciados, backups e agendamentos, restauração e clonagem, exclusão em massa;
- **as Security Rules**, com editor e playground;
- **as métricas de uso.**

Também cobre o Firestore em modo Datastore no L2.

A escolha central de desenho é a **tipagem sem perda**. O console do Firestore e a maioria das ferramentas transformam os valores em JSON simples e perdem informação no caminho: inteiro contra double, precisão de timestamp, bytes, referências. O Nephoscope mantém o tipo exato de cada valor da API até a tela e de volta.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Banco** | Um banco Firestore num projeto: `(default)` ou um nomeado. Modo nativo ou modo Datastore; edição Standard ou Enterprise. |
| **Caminho de documento** | O caminho de um documento relativo à raiz do banco, como `users/abc/orders/o1`. |
| **Documento ausente** | Um caminho sem documento, mas com subcoleções. Aparece em itálico. |
| **Grupo de coleções** | Todas as coleções com o mesmo id, em qualquer profundidade. |
| **Valor de fio** | A codificação JSON do Nephoscope para um valor do Firestore, com uma etiqueta de tipo explícita (D-02). |
| **JSON tipado** | A forma editável de um documento em JSON, com invólucros `$` onde o JSON simples seria ambíguo (D-03). |
| **Precondição** | Uma condição presa a uma escrita: o documento precisa existir, não pode existir, ou precisa ainda ter um dado horário de atualização. |
| **Transformação** | Uma mudança de campo feita no servidor: timestamp do servidor, incremento, máximo, mínimo, adicionar a array, remover de array. |
| **Listener** | Uma consulta ao vivo que recebe as mudanças (D-10). |
| **Sobreposição de índice** | Uma configuração de índice de campo único que difere do padrão do banco, inclusive isenções. |
| **Política de TTL** | Uma configuração de campo que exclui documentos depois do timestamp guardado naquele campo. |
| **Ruleset** | Uma versão do código das Security Rules. Um **release** aponta um banco para um ruleset. |

---

## 3. Problema

Os dados do Firestore são hierárquicos, tipados e cobrados por leitura. O console do Firestore mostra documentos, mas perde os tipos ao editar como JSON. Ele não roda consultas arbitrárias com agregações e planos de explain num lugar só, esconde o índice de que uma consulta falha precisa atrás de um link para outro console, e não mostra listeners, TTL, backups e rules juntos. Ferramentas feitas sobre os SDKs de alto nível costumam arredondar inteiros e timestamps.

---

## 4. Objetivos

1. Navegar e editar qualquer documento sem perder informação de tipo, incluindo inteiros grandes, doubles como `1.0`, timestamps em nanossegundos, bytes, referências, geopoints e vetores.
2. Consultar com todos os operadores que o Firestore suporta, agregar, explicar e corrigir um índice faltante com um clique.
3. Ver as mudanças ao vivo quando preciso, com o custo de leitura visível.
4. Administrar bancos, índices, TTL, backups, exports e rules do mesmo lugar.
5. Ficar seguro: precondições contra atualizações perdidas, confirmações digitadas e travas de custo.

### Não-objetivos

- **Consultas de pipeline** (`executePipeline` da edição Enterprise).
- **API compatível com MongoDB** e as suas credenciais de usuário (edição Enterprise). Os bancos são listados; o lado MongoDB deles não é operado.
- **Recursos dos SDKs de cliente do Firebase** (persistência offline, auth de cliente). O Nephoscope usa apenas credenciais de servidor.
- **Migração de dados entre projetos.** O export e import gerenciados cobrem isso pelo Cloud Storage.

---

## 5. Decisões tomadas

### D-01 — Três camadas de SDK, cada uma onde é exata

| Camada | Usada para |
|---|---|
| **`v1.FirestoreClient` de baixo nível** | `listDocuments` paginado com `showMissing`, `pageSize`, `pageToken`, `orderBy`, `mask` e `readTime`; `listCollectionIds` paginado; `runQuery` a partir da consulta estruturada do próprio Nephoscope; `runAggregationQuery`; `commit` com precondições e transformações; explain de consultas |
| **Classe `Firestore` de alto nível** com `useBigInt: true` | Listeners (`onSnapshot`), exclusão recursiva, imports com BulkWriter |
| **`v1.FirestoreAdminClient`** | Bancos, índices, campos (sobreposições e TTL), export e import gerenciados, exclusão em massa, backups, agendamentos de backup, restauração, clonagem |

Os clientes de baixo nível e de administração devolvem valores crus de protocolo, que o codec (D-02) mapeia diretamente. A classe de alto nível com `useBigInt: true` mantém os inteiros como `BigInt`, então int e double continuam distintos. Os documentos que o listener entrega são lidos dos campos de protocolo que o snapshot guarda (`_fieldsProto`) com o **mesmo** codec das outras leituras, em vez de um segundo decodificador: é exato por construção, e um teste com emulador confere (T-09).

No emulador, o cliente de baixo nível usa um canal sem TLS e envia `Authorization: Bearer owner` em cada chamada, para agir como administrador em vez de passar pelas Security Rules.

**Racional:** o cliente cru é o único jeito de paginar documentos incluindo os ausentes, e de expressar qualquer consulta com exatidão. A classe de alto nível já implementa o protocolo de listen (estados de alvo, resume tokens, resets por filtro de existência); reimplementar isso sobre o fluxo `listen` cru seria um código grande e arriscado, com pouco ganho.

### D-02 — Valores de fio carregam o seu tipo

Todo valor do Firestore atravessa a API como um objeto JSON etiquetado:

| Tipo do Firestore | Valor de fio | Observação |
|---|---|---|
| null | `{ "t": "null" }` | |
| boolean | `{ "t": "boolean", "v": true }` | |
| integer | `{ "t": "integer", "v": "9007199254740993" }` | String decimal; faixa int64 completa |
| double | `{ "t": "double", "v": 1.5 }` ou `{ "t": "double", "v": "NaN" }` | `"NaN"`, `"Infinity"`, `"-Infinity"` e `"-0"` vão como strings, já que o JSON não os representa |
| timestamp | `{ "t": "timestamp", "v": "2026-09-28T12:00:00.123456Z" }` | String RFC 3339 como devolvida, nunca via `Date` do JavaScript |
| string | `{ "t": "string", "v": "…" }` | |
| bytes | `{ "t": "bytes", "v": "base64…" }` | |
| reference | `{ "t": "reference", "v": "projects/p/databases/(default)/documents/users/abc" }` | Nome completo, pode apontar para outro banco |
| geopoint | `{ "t": "geopoint", "v": { "latitude": -23.5, "longitude": -46.6 } }` | |
| array | `{ "t": "array", "v": [ … ] }` | |
| map | `{ "t": "map", "v": { "campo": … } }` | |
| vector | `{ "t": "vector", "v": [0.1, 0.2] }` | O Firestore o guarda como map com chaves reservadas (`__type__: "__vector__"`); reconhecido e mostrado como vetor |
| outros tipos reservados | `{ "t": "special", "kind": "…", "v": { … } }` | Valores da edição Enterprise guardados como maps com chaves reservadas; mostrados somente leitura, com o seu tipo |

**Racional:** uma etiqueta por valor é a única codificação JSON que sobrevive à ida e volta para todos os tipos. Doubles como `NaN` e `-0` e valores int64 com precisão total não cabem em números JSON simples.

### D-03 — JSON tipado para editar

O editor JSON mostra e aceita **JSON tipado**, que continua legível para dados comuns:
- **Números:** um literal numérico sem fração nem expoente é um **integer** (na faixa int64, senão é erro); um literal com fração ou expoente é um **double**. `1` é integer, `1.0` é double.
- Strings, booleanos, null, arrays e objetos são eles mesmos.
- Invólucros (um objeto com exatamente uma chave `$`) cobrem o resto:

| Invólucro | Significado |
|---|---|
| `{ "$int": "9007199254740993" }` | Integer escrito como string (qualquer int64) |
| `{ "$double": "NaN" }` | Valores especiais de double (`NaN`, `Infinity`, `-Infinity`, `-0`), ou qualquer double |
| `{ "$timestamp": "2026-09-28T12:00:00.123456Z" }` | Timestamp |
| `{ "$bytes": "base64…" }` | Bytes |
| `{ "$ref": "users/abc" }` | Referência, relativa à raiz do banco, ou nome completo |
| `{ "$geo": { "latitude": 1.5, "longitude": 2.5 } }` | Geopoint |
| `{ "$vector": [0.1, 0.2] }` | Vetor |
| `{ "$serverTimestamp": true }`, `{ "$increment": 1 }`, `{ "$maximum": 5 }`, `{ "$minimum": 0 }`, `{ "$arrayUnion": [ … ] }`, `{ "$arrayRemove": [ … ] }` | Transformações (só em escritas) |

- **Chaves que começam com `$`:** uma chave de map que realmente começa com `$` é escrita com um `$` a mais (`"$$price"` significa o campo `$price`).
- **Parse sem perda:** o parser guarda o texto literal de cada número, então `1.0` continua double e inteiros grandes não são arredondados.
- **Nomes de campo como dados:** os campos são gravados como propriedades próprias, então nomes como `__proto__` continuam sendo campos (achado do teste de propriedade).
- **`$id` em arquivos de import e export (D-16):** a chave `"$id"` no nível do documento nomeia o documento e não é um campo.
- Inteiros até 2^53 são impressos sem invólucro; acima disso, como `{"$int": "…"}`, para ferramentas que leem números JSON como double.

**Racional:** a maioria dos documentos é feita de strings, números, booleanos e objetos aninhados, que se leem naturalmente como JSON. Os invólucros só aparecem onde o JSON simples perderia informação.

### D-04 — Três visões dos mesmos dados

- **Visão em painéis:** três colunas (coleções, documentos, campos), como no console do Firestore, com navegação por teclado e colunas redimensionáveis.
- **Visão em tabela:** uma linha por documento; colunas a partir da união dos campos da página carregada, células tipadas, edição inline de valores escalares.
- **Visão de documento:** o documento como árvore de campos (com rótulos de tipo) ou como JSON tipado, com metadados: caminho, horário de criação, de atualização e de leitura, e uma estimativa de tamanho calculada pelas regras documentadas de tamanho de armazenamento do Firestore.

Comum às três visões:
- Uma **barra de caminho** editável aceita qualquer caminho absoluto (`/users/abc/orders`) e salta para ele.
- Os documentos são ordenados por id por padrão e paginados pelo cliente de baixo nível (tamanho de página padrão 50, D-15).
- **Documentos ausentes** (subcoleções sem documento pai) aparecem em itálico com o rótulo "No document".
- As **subcoleções** de um documento são listadas com paginação.

**Racional:** a visão em painéis bate com o modelo mental do console do Firestore, e a visão em tabela é o que as pessoas querem ao comparar muitos documentos.

### D-05 — Escritas: exatas, com precondição, revisadas

- **Criar:** com id gerado de 20 caracteres ou id escolhido, com a precondição "não existe".
- **Editar:**
  - o usuário edita na árvore de campos, na tabela ou em JSON tipado;
  - antes de salvar, o Nephoscope mostra um **diff**;
  - envia um `update` restrito aos caminhos de campo alterados, com a precondição de que o documento ainda tenha **o horário de atualização lido**, mantido como a string exata da API;
  - se outra escrita aconteceu no meio, o salvamento falha com "Changed since you opened it", oferecendo recarregar ou sobrescrever (sobrescrever exige confirmação e não envia precondição).
- **Transformações** são enviadas como transformações de campo, não calculadas no cliente.
- **Caminhos de campo** com caracteres fora de `[A-Za-z_][A-Za-z_0-9]*` são citados com crases.
- **Excluir documento:** exclusão simples, ou exclusão recursiva que também remove as subcoleções, com contador de progresso e cancelamento. A exclusão recursiva é uma operação local do Nephoscope (SPEC-0001 D-09, família `local`): encontra os descendentes pela mesma consulta sem tipo (kindless) que o `recursiveDelete` do SDK usa, em páginas de 1.000 nomes, e os exclui com `batchWrite` em lotes de 500; o cancelamento é verificado entre lotes.
- **Excluir coleção:** exclusão recursiva de todos os documentos dela. A confirmação mostra o caminho da coleção e uma contagem de documentos obtida com uma agregação `count()`, e exige digitar essa contagem.
- **Exclusão em massa (administração):** exclui todos os documentos dos ids de coleção dados no banco inteiro, como operação. É a ação mais perigosa e é apresentada como tal.

**Racional:** o Firestore não tem desfazer. O diff, a precondição e as confirmações digitadas são as proteções que um console pode oferecer.

### D-06 — Construtor de consultas que cobre a linguagem inteira

Uma consulta é descrita por um `QuerySpec` (em `packages/contracts`) e convertida pelo servidor numa consulta estruturada do Firestore:
- **Origem:** um caminho de coleção ou um grupo de coleções (todos os descendentes).
- **Filtros:** filtros de campo com `<`, `<=`, `>`, `>=`, `==`, `!=`, `array-contains`, `in`, `array-contains-any` e `not-in`; filtros unários `is null`, `is NaN`, `is not null` e `is not NaN`; grupos AND e OR aninhados. Os valores são tipados com os mesmos editores dos campos.
- **Cláusulas:** ordenação (campo, direção), cursores de início e fim (at, after, before), limite e seleção de campos.
- **Vizinhos mais próximos:** campo vetorial, vetor de consulta, medida de distância (euclidiana, cosseno, produto escalar), limite, campo opcional de distância no resultado e limiar.

Estado da consulta:
- A consulta fica na URL (SPEC-0001 CA-61), pode ser salva com nome (SPEC-0001 CA-53), e as 20 últimas consultas por banco ficam guardadas.
- **"Copy as code"** gera a mesma consulta para os SDKs de servidor em Node, Python e Go.

**Ordem explícita.** O servidor envia a ordem que o Firestore aplicaria, por extenso: a ordem pedida, depois os campos de desigualdade ainda não ordenados (em ordem de caminho) e por último `__name__`, sempre no fim, já que o Firestore não aceita índice com campos depois de `__name__`. Assim o cursor da página seguinte sempre bate com a consulta. Agregações sem cursor não recebem essa ordem, porque o Firestore não calcula `sum` nem `avg` sobre uma consulta ordenada por `__name__`.

**Valores dos filtros.** Um valor digitado como palavra solta é lido como string; números, `true`, `false`, `null`, arrays, objetos e invólucros seguem o JSON tipado. `__name__` aceita o id do documento e o converte em referência.

**Racional:** o construtor de consultas do console do Firestore não expressa grupos OR, grupos de coleções com cursores nem busca vetorial. Montar nós mesmos a consulta estruturada significa que qualquer consulta que a API aceite pode ser rodada.

### D-07 — Agregações

`count`, `sum(campo)` e `avg(campo)`, até 5 por consulta, rodam sobre a consulta atual via `runAggregationQuery`. Os resultados mantêm os tipos:
- `count` é integer;
- `sum` é integer, a menos que estoure ou inclua um double, quando vira double;
- `avg` é sempre double.

O custo é mostrado: uma leitura por lote de até 1.000 entradas de índice.

### D-08 — Explain de consultas

"Explain" roda a consulta ou agregação atual com opções de explain. "Plan only" devolve o plano sem executar; "Analyze" executa e devolve estatísticas. O Nephoscope mostra:
- os índices usados;
- resultados devolvidos, leituras cobradas e tempo de execução, que só chegam com a **última** resposta do fluxo;
- as estatísticas de depuração numa tabela.

### D-09 — Um índice faltante se corrige com um clique

Quando uma consulta falha com `FAILED_PRECONDITION` porque precisa de um índice, a mensagem do Google traz um link cujo parâmetro `create_composite` codifica a definição do índice. O Nephoscope o decodifica numa definição legível (grupo de coleções, escopo da consulta, campos com ordem ou configuração de array) e oferece **Create index**, uma operação que roda a consulta de novo quando termina. Se o link não puder ser decodificado, o Nephoscope deriva a definição da própria consulta (campos de igualdade, depois campos de desigualdade e de ordenação) e diz que fez isso.

**Racional:** "a consulta exige um índice" é o erro mais comum do Firestore, e a correção normalmente exige ir a outro console.

### D-10 — Modo ao vivo pelo listener de alto nível

- **O que é.** "Live" transforma a coleção ou consulta atual num listener no canal `firestore.listen` (SPEC-0001 §8.6). O canal envia mudanças `added`, `modified` e `removed` com valores de fio, e o horário de leitura. As linhas alteradas ganham a tinta de linha ao vivo (SPEC-0002 D-10).
- **Limite e custo.** **O modo ao vivo exige um limite** (padrão 100, no máximo 1.000) e mostra o seu custo: o primeiro snapshot lê todos os documentos que casam, e cada mudança custa uma leitura.
- **Pausa quando a aba fica oculta** (SPEC-0001 CA-39). Como retomar um listener lê de novo todos os documentos que casam, o `firestore.listen` só pausa depois que a aba fica oculta por **60 segundos**, e a visão avisa antes de retomar que vai ler os documentos de novo.
- **Compartilhamento.** O servidor compartilha um listener entre assinaturas com o mesmo (perfil, banco, consulta). Um assinante novo recebe as linhas atuais sem custo de leitura.
- **Aviso antes de retomar.** A própria página encerra o modo ao vivo depois de 60 segundos oculta e mostra "Resume live mode", que avisa que retomar lê de novo os documentos; o atraso de 60 segundos no servidor fica como segunda proteção.

**Racional:** o modo ao vivo é valioso para depurar, e cada nova leitura custa dinheiro. A tolerância de 60 segundos evita reler em trocas rápidas de aba, e o compartilhamento evita pagar duas vezes por duas visões iguais.

### D-11 — Administração

| Área | Operações |
|---|---|
| **Bancos** | Listar (com location, tipo, edição, modo de concorrência, recuperação pontual e proteção contra exclusão); criar (id, location, modo nativo ou Datastore, edição; a edição Enterprise não tem modo Datastore); atualizar recuperação pontual e proteção contra exclusão; excluir (confirmação digitada, bloqueada enquanto a proteção estiver ligada); **clonar** um banco a partir de um ponto no tempo |
| **Índices compostos** | Listar com estado (criando, pronto, precisa de reparo) e escopo de consulta; criar (campos com configuração de ordem, array ou vetor); excluir |
| **Sobreposições de campo único** | Listar os campos cuja configuração de índice difere do padrão, inclusive isenções; adicionar ou mudar uma sobreposição por campo e escopo; remover uma sobreposição |
| **Políticas de TTL** | Listar os campos com política de TTL e o estado dela; ligar ou desligar TTL num campo |
| **Export e import gerenciados** | Exportar todos ou alguns ids de coleção para uma URI do Cloud Storage, opcionalmente num ponto no tempo; importar de uma pasta de export; os dois acompanhados como operações, com as operações do banco listadas |
| **Backups** | Listar por location, excluir, **restaurar** num banco novo |
| **Agendamentos de backup** | Listar, criar (diário ou semanal, retenção), atualizar, excluir |
| **Exclusão em massa** | Ver D-05 |

### D-12 — Security Rules com diff e playground

- **De onde vêm as rules:** as rules atuais são o ruleset do release `cloud.firestore` para o `(default)`, ou `cloud.firestore/{databaseId}` para um banco nomeado, lidas pelo `@googleapis/firebaserules`.
- **Editor:** Monaco, com uma gramática de Security Rules escrita pelo Nephoscope.
- **Publicar:** cria um ruleset novo, que o Google valida e cujos erros aparecem como marcadores no editor; mostra o diff com o ruleset atual; depois atualiza o release.
- **Histórico:** rulesets anteriores podem ser vistos, comparados e publicados de novo, o que é um rollback.
- **Playground:** roda a API de teste de rules com casos de teste. Cada caso tem uma autenticação (uid, claims do token ou não autenticado), um caminho, um método (get, list, create, update, delete) e, em escritas, os dados da requisição. O resultado mostra permitido ou negado, com os detalhes de avaliação devolvidos pelo Google.
- **Aviso no playground:** `get()` e `exists()` dentro das rules leem **dados de produção** durante esses testes.

### D-13 — Modo Datastore no L2

Bancos em modo Datastore abrem um navegador de Datastore (`@google-cloud/datastore`, com o id do banco):
- um seletor de namespace;
- kinds (a partir da consulta de metadados `__kind__`);
- entidades por kind, paginadas;
- um editor de consultas **GQL** com resultados tipados;
- visualização e edição de entidades, com propriedades tipadas (integer, double, boolean, string, timestamp, key, blob, geopoint, array, entidade embutida, null) e a flag "exclude from indexes" por propriedade;
- excluir entidade.

O emulador dos testes é o emulador do Firestore em modo Datastore (SPEC-0001 D-19).

Detalhes:
- As chaves circulam como literais GQL, como `KEY(Task, 'nome', Filho, 123)`, legíveis e digitáveis; o servidor as converte para o protocolo.
- Valores de propriedade usam os valores de fio da D-02 (chaves como `reference` com o literal GQL; entidades embutidas como `map`).
- O GQL roda com literais permitidos. A página seguinte de um GQL usa a consulta já interpretada pelo Google, guardada por 10 minutos, com o cursor final.
- Salvar uma entidade grava a entidade inteira (upsert); uma chave sem id nem nome recebe um id alocado.

### D-14 — Bancos da edição Enterprise

Bancos da edição Enterprise são listados com a sua edição. O navegador de dados funciona com eles pela API nativa do Firestore onde ela permitir. Valores de tipos exclusivos da Enterprise aparecem somente leitura (D-02, `special`). Consultas de pipeline e a API compatível com MongoDB são não-objetivos.

### D-15 — Travas de custo

- O tamanho de página padrão é 50, ajustável de 25 a 500.
- Toda ação que leria ou escreveria mais de 1.000 documentos pede confirmação com o número: carregar tudo, excluir uma coleção, importar, exportar resultados de consulta.
- O modo ao vivo exige limite (D-10).
- Agregações e modo ao vivo informam o custo de leitura (D-07, D-10).

### D-16 — Import e export no navegador

- **Exportar** os resultados da consulta atual como JSON tipado, NDJSON tipado (um documento por linha) ou CSV. O CSV achata campos aninhados em colunas e avisa que perde os tipos.
- **Importar** um array JSON tipado ou um arquivo NDJSON para uma coleção, usando BulkWriter no servidor:
  - o id do documento vem de um campo `$id` ou é gerado;
  - documentos existentes são pulados, sobrescritos ou mesclados, conforme a escolha;
  - o import mostra progresso e um relatório final de falhas;
  - acima de 1.000 documentos, pede confirmação;
  - a página envia lotes de 500 documentos, em ordem, e pode parar entre um lote e outro; o arquivo é lido e validado no navegador antes do primeiro lote, com linha e documento de cada erro.

### D-17 — Aba de uso

A aba Usage do banco mostra gráficos de leituras, escritas e exclusões de documentos, requisições por método e código de resposta, snapshot listeners ativos e conexões ativas, a partir do Cloud Monitoring (a lista de métricas está na SPEC-0005).

### D-18 — O emulador é um alvo de primeira classe

Com `FIRESTORE_EMULATOR_HOST` definido, todo cliente do Firestore, inclusive os de baixo nível e de administração, aponta para o emulador (SPEC-0001 D-18). Os recursos que o emulador não suporta (índices, TTL, backups, Explain, rules pela Rules API) aparecem como indisponíveis, com o motivo. O emulador não lista bancos: a lista mostra `(default)`, e qualquer id de banco digitado na URL abre, como no próprio emulador. `DATASTORE_EMULATOR_HOST` faz o mesmo para o modo Datastore.

---

## 6. Escopo

### Dentro
D-01 a D-18.

### Fora
Os não-objetivos de §4.

---

## 7. Requisitos

### 7.1 Valores e codec

**CA-01** — O codec converte entre valores crus de protocolo, valores do SDK de alto nível (`useBigInt: true`) e valores de fio (D-02) sem perda, para todos os tipos da D-02.

**CA-02** — O JSON tipado (D-03) faz parse e impressão sem perda: `print(parse(x)) == x` para entrada normalizada, e `parse(print(v)) == v` para todo valor de fio.

**CA-03** — As precondições de horário de atualização são as strings exatas devolvidas pela API; nunca passam por um `Date` do JavaScript.

### 7.2 Navegar

**CA-04** — O seletor de banco lista todos os bancos do projeto, com modo e edição.

**CA-05** — As visões em painéis, tabela e documento (D-04) estão disponíveis para qualquer caminho de coleção ou documento, e a barra de caminho navega para qualquer caminho digitado.

**CA-06** — Coleções raiz, subcoleções e documentos são paginados conforme o tamanho de página configurado; documentos ausentes aparecem em itálico.

**CA-07** — Valores de referência são links que abrem o documento referenciado, inclusive em outro banco.

**CA-08** — Há ações de copiar para caminho, id, JSON tipado e "código para ler este documento" em Node, Python e Go.

### 7.3 Escrever

**CA-09** — Criar, editar, transformar e excluir seguem a D-05. Todo salvamento mostra o diff antes.

**CA-10** — Um salvamento rejeitado pela precondição de horário de atualização oferece recarregar ou sobrescrever.

**CA-11** — Exclusões recursivas mostram progresso (documentos excluídos até agora) e podem ser canceladas; uma exclusão cancelada informa quantos documentos foram excluídos.

### 7.4 Consultar

**CA-12** — O construtor de consultas (D-06) suporta todos os operadores, aninhamento AND e OR, grupos de coleções, cursores, seleção e busca por vizinhos mais próximos, e mostra os erros de validação da API junto da parte da consulta a que se referem.

**CA-13** — Agregações (D-07), Explain (D-08) e "Copy as code" funcionam em qualquer consulta que o construtor consiga expressar.

**CA-14** — Uma falha por índice faltante oferece Create index (D-09), que roda como operação e executa a consulta de novo quando dá certo.

### 7.5 Ao vivo

**CA-15** — O modo ao vivo segue a D-10: exige limite, destaca as mudanças, informa o custo, pausa após 60 segundos oculto e compartilha listeners idênticos.

### 7.6 Administração

**CA-16** — Cada linha da D-11 está disponível, com confirmações digitadas para exclusões e restaurações, e operações acompanhadas na bandeja.

**CA-17** — A página Indexes mostra índices compostos e sobreposições de campo único em abas separadas, com o estado de cada índice.

**CA-18** — A página de TTL lista as políticas e permite ligar ou desligar TTL num campo, avisando que as exclusões são assíncronas e não podem ser desfeitas.

### 7.7 Rules

**CA-19** — As rules seguem a D-12: editor, marcadores de validação, diff antes de publicar, histórico com rollback e o playground com o aviso de dados de produção.

### 7.8 Modo Datastore

**CA-20** — Bancos em modo Datastore abrem o navegador de Datastore (D-13), com namespaces, kinds, entidades, GQL e edição tipada.

### 7.9 Import, export e uso

**CA-21** — Export e import no navegador seguem a D-16.

**CA-22** — A aba de uso segue a D-17.

---

## 8. Requisitos não-funcionais

| Id | Requisito |
|---|---|
| **NFR-01** | Uma página de 500 documentos renderiza na visão em tabela em menos de 300 ms depois que a API responde. |
| **NFR-02** | Uma escrita vista por um listener aparece na UI em até 1 s numa conexão normal. |
| **NFR-03** | O codec faz a ida e volta de 100% dos valores gerados em testes de propriedade (CA-01, CA-02). |
| **NFR-04** | Exclusão recursiva e import sustentam pelo menos 500 escritas por segundo onde o Firestore permitir, usando a limitação de taxa do BulkWriter. |

---

## 9. Cenários de teste

Os testes com emulador rodam no CI com `docker compose --profile emulators` (SPEC-0001 D-19). Os testes em sandbox usam o projeto da SPEC-0001 Q-02.

| Id | Cenário | Onde | Esperado |
|---|---|---|---|
| **T-01** | Teste de propriedade: valores de fio aleatórios pelo codec e pelo JSON tipado, nas duas direções | Unitário | Valores idênticos (NFR-03) |
| **T-02** | Salvar `{"a": 1, "b": 1.0, "c": {"$int": "9007199254740993"}, "d": {"$double": "NaN"}}` e ler de volta | Emulador | `a` integer, `b` double, `c` exato, `d` NaN |
| **T-03** | Salvar um timestamp com microssegundos e ler de volta | Emulador | A mesma string |
| **T-04** | Criar `users/u1/orders/o1` sem `users/u1` | Emulador | `users/u1` listado como documento ausente |
| **T-05** | Abrir um documento, mudá-lo por outro cliente e depois salvar pelo Nephoscope | Emulador | "Changed since you opened it"; recarregar mostra a mudança do outro cliente |
| **T-06** | Aplicar `$increment: 5` e `$serverTimestamp` num mesmo salvamento | Emulador | Campo incrementado; timestamp definido pelo servidor |
| **T-07** | Consultar com `(status == "open" OR priority > 3) AND owner == "me"`, ordenado, com cursor | Emulador | Resultados corretos; "Copy as code" gera Node, Python e Go equivalentes |
| **T-08** | Contar, somar e tirar a média numa consulta | Emulador | Valores e tipos conforme a D-07 |
| **T-09** | Ligar o modo ao vivo com limite 50 e mudar um documento que casa em outro lugar | Emulador | A linha se atualiza com a tinta em até 1 s |
| **T-10** | Ocultar a aba por 30 s e depois por 90 s, com o modo ao vivo ligado | Emulador | Não pausa aos 30 s; pausa após 60 s; aviso antes de retomar |
| **T-11** | Excluir recursivamente uma coleção de 3.000 documentos com subcoleções | Emulador | Confirmação com a contagem digitada; progresso; tudo removido |
| **T-12** | Importar um arquivo NDJSON de 2.000 documentos tipados com "skip existing" | Emulador | Confirmação acima de 1.000; o relatório mostra pulos e falhas |
| **T-13** | Rodar uma consulta que precisa de índice composto | Sandbox | Definição do índice decodificada; Create index roda; a consulta funciona depois |
| **T-14** | Explain com Analyze nessa consulta | Sandbox | Índice usado, leituras e tempo mostrados |
| **T-15** | Criar um banco nomeado, ligar a recuperação pontual, cloná-lo, excluir o clone | Sandbox | Cada passo acompanhado; a exclusão exige o id digitado |
| **T-16** | Definir uma política de TTL em `expiresAt` e desligá-la | Sandbox | Estado mostrado durante e depois |
| **T-17** | Exportar duas coleções para um bucket e importá-las em outro banco | Sandbox | Operações acompanhadas; dados presentes |
| **T-18** | Criar um agendamento de backup diário; restaurar um backup num banco novo | Sandbox | Agendamento listado; restauração acompanhada |
| **T-19** | Publicar rules com erro de sintaxe, depois rules válidas; fazer rollback | Sandbox | Marcadores primeiro; diff antes de publicar; o rollback restaura o ruleset antigo |
| **T-20** | Playground: leitura não autenticada de `users/u1` contra rules que exigem auth | Sandbox | Negado, com detalhes da avaliação |
| **T-21** | Modo Datastore: listar kinds, rodar uma consulta GQL, editar uma propriedade de entidade com "exclude from indexes" | Emulador (modo Datastore) | Resultados tipados; flag salva |
| **T-22** | Abrir um documento que contém `<img src=x onerror=alert(1)>` numa string | Emulador | Mostrado como texto; nada executa (SPEC-0001 CA-72) |
| **T-23** | Com um perfil somente leitura, tentar todas as escritas acima pela API | Emulador | Todas rejeitadas com `READ_ONLY` |

---

## 10. Plano de entrega

| Passo | Entregável | Depende de |
|---|---|---|
| M2.1 | Codec, JSON tipado, navegação (todas as visões), escrita com precondições | M0 |
| M2.2 | Construtor de consultas, agregações, Explain, índice faltante, copiar como código | M2.1 |
| M2.3 | Modo ao vivo, import e export no navegador, exclusões recursivas | M2.1 |
| M2.4 | Administração (D-11), aba de uso | M2.1 |
| M2.5 | Editor e playground de rules | M2.1 |
| M2.6 | Modo Datastore | M2.1 |

**Estado no fim do M2.** Todos os passos implementados. Automatizados contra o emulador (`pnpm --filter @nephoscope/api test:emulator`): T-02 a T-09, T-11, T-12 e T-21. T-01 roda nos testes unitários. T-22 e o fluxo da interface (navegar, editar com diff, tabela, consulta, agregação, ao vivo e axe nos dois temas) rodam em `apps/web/scripts/firestore-smoke.mjs` contra o emulador. T-10 (tempo oculto) e T-23 (somente leitura) ficam para verificação manual. T-13 a T-20 dependem da SPEC-0001 Q-02.

---

## 11. Riscos e questões em aberto

### Riscos

| Id | Risco | Mitigação |
|---|---|---|
| **R-01** | Exclusões recursivas e em massa destroem dados de forma irreversível | Contagens digitadas, progresso, cancelamento; a exclusão em massa apresentada como a ação mais perigosa; recomendar a recuperação pontual na confirmação quando ela estiver desligada |
| **R-02** | O modo ao vivo e "carregar tudo" custam dinheiro | Travas da D-10 e da D-15 |
| **R-03** | O formato do link `create_composite` não é uma API documentada | Recorrer à derivação do índice a partir da consulta (D-09) |
| **R-04** | Os testes de rules leem dados de produção por `get()` e `exists()` | Aviso no playground (D-12) |

### Questões em aberto

Nenhuma.

---

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-09-28 | 0.1 | | Versão inicial, exportada do plano aprovado e da verificação das APIs: D-01 a D-18, CA-01 a CA-22, NFR-01 a NFR-04, T-01 a T-23, R-01 a R-04 |
| 2026-09-28 | 0.2 | | **Tradução para o português** (SPEC-0001 D-26) |
| 2026-09-28 | 0.3 | | **Implementação do M2.**<br>• D-01: documentos do listener lidos dos campos de protocolo do snapshot com o mesmo codec; no emulador, `Bearer owner` por chamada.<br>• D-03: campos como propriedades próprias (`__proto__`), `$id` em import e export, inteiros acima de 2^53 com `$int`.<br>• D-05: exclusão recursiva como operação local cancelável (consulta sem tipo e `batchWrite`).<br>• D-06: ordem explícita com `__name__` sempre por último; agregações sem essa ordem; palavras soltas nos filtros como strings.<br>• D-10: aviso e botão para retomar depois de 60 s oculta; linhas atuais sem custo para assinantes novos.<br>• D-13: chaves como literais GQL; páginas de GQL pela consulta interpretada, guardada por 10 minutos.<br>• D-16: lotes de 500 enviados pela página, validação no navegador.<br>• D-18: lista de bancos do emulador e `DATASTORE_EMULATOR_HOST`.<br>• Estado dos cenários no plano de entrega. |

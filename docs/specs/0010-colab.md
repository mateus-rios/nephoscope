# SPEC-0010 — Colab Enterprise

| | |
|---|---|
| **Status** | Implementada |
| **Autor(es)** | |
| **Revisores** | |
| **Sistemas** | `apps/api/src/modules/colab` · `apps/web/src/products/colab` · `packages/contracts/src/colab.ts` |
| **SDKs** | `@googleapis/aiplatform` (REST v1) · `@googleapis/dataform` (REST v1) · `@google-cloud/storage` (saída das execuções, pelo módulo do Cloud Storage) |
| **Spec relacionada** | [SPEC-0001](./0001-platform.md) (SDKs D-03, fan-out D-17, renderização D-22, memória NFR-03, somente leitura D-12, confirmações D-13, operações D-09) · [SPEC-0002](./0002-design-system.md) · [SPEC-0006](./0006-messaging-storage.md) (navegador de objetos, para a saída das execuções) · [SPEC-0009](./0009-long-tail.md) (Vertex AI no L1, que continua lá) |
| **Última atualização** | 2026-10-02 |
| **Versão** | 0.2 |

---

## 1. Resumo

O Colab Enterprise é o ambiente de notebooks gerenciado do Google Cloud, parte do Vertex AI. Esta spec entrega, a pedido do dono e fora da ordem dos marcos, uma visão completa dele no nível **L2 com visualizador de notebooks**:
- **notebooks**: listar, criar, ver as células e saídas, histórico de versões, baixar, enviar uma versão nova, renomear, excluir;
- **runtimes**: criar a partir de um template, iniciar, parar, atualizar, excluir;
- **templates de runtime**: criar, editar o que o Google deixa editar, excluir;
- **execuções**: rodar um notebook, acompanhar, ver o notebook executado que a execução gravou no Cloud Storage;
- **agendamentos**: criar, editar, pausar, retomar com ou sem as execuções perdidas, rodar agora, ver as execuções.

O Nephoscope **não executa kernels nem edita células**. Editar e rodar interativamente continua sendo no Colab Enterprise, que exige uma sessão de conta Google. Tudo que o Colab faz por API, sem kernel, está aqui.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Notebook** | Um arquivo Jupyter (`.ipynb`). No Colab Enterprise, cada notebook é guardado num repositório do Dataform com um único arquivo (D-04). |
| **Versão** | Um commit do repositório do notebook. Cada salvamento no Colab ou no Nephoscope cria uma. |
| **Runtime** | A máquina virtual em que um notebook roda. Pertence a uma identidade, o *runtime user*. |
| **Template de runtime** | A receita de um runtime: máquina, GPU, disco, rede e software. |
| **Execução** | Uma rodada não interativa de um notebook, num runtime criado a partir de um template, que grava o notebook executado no Cloud Storage. |
| **Agendamento** | Um cron que cria uma execução a cada disparo. |
| **Catch-up** | Ao retomar um agendamento pausado, rodar as execuções que foram puladas durante a pausa. |

---

## 3. Problema

Quem tem só uma chave de conta de serviço não abre o Colab Enterprise no console do Google. Ver se o relatório agendado da noite rodou, o que ele imprimiu, qual versão do notebook rodou, se há runtimes esquecidos ligados custando dinheiro, ou trocar o notebook que um agendamento usa, hoje exige `gcloud`, chamadas REST e o Cloud Storage em separado.

---

## 4. Objetivos

- Uma página do produto com todos os recursos do Colab Enterprise do projeto, de todas as regiões ou de uma.
- Ler um notebook, suas versões e o resultado de cada execução sem sair do Nephoscope.
- Operar o ciclo de vida de runtimes, templates, execuções e agendamentos com as proteções da SPEC-0001.

### Não-objetivos

- Executar código, conectar a um runtime ou abrir o proxy do runtime (exige sessão Google).
- Editar células no navegador. Uma versão nova é um arquivo `.ipynb` inteiro (D-05).
- Compartilhar notebooks (IAM do repositório do Dataform) e os notebooks do Vertex AI Workbench.

---

## 5. Decisões tomadas

### D-01 — Produto próprio, no L2, antes do M7

*Decisão do dono em 2026-10-02 ("add a whole colab view").*

- O Colab Enterprise é um produto do grupo Dados e IA (`colab`, atalho `g c`), separado do Vertex AI L1 da SPEC-0009, que continua como está.
- O marco no registro é o M7, como o resto de Dados e IA da cauda longa, mas a entrega vem antes, como foi com o Pub/Sub e o Cloud Storage.
- O serviço declarado é `aiplatform.googleapis.com`. Os notebooks dependem também de `dataform.googleapis.com`; quando ele está desligado, a aba de notebooks mostra o problema com a ação de habilitar (SPEC-0002 CA-23).

**Racional:** o Colab tem recursos e fluxos próprios (notebooks guardados no Dataform, runtimes por usuário, execuções com saída no Cloud Storage) que não cabem numa linha do L1 do Vertex AI.

### D-02 — Clientes REST, uma exceção medida à SPEC-0001 D-03

- Vertex AI pelo `@googleapis/aiplatform` v1 e Dataform pelo `@googleapis/dataform` v1, não pelos clientes gRPC `@google-cloud/aiplatform` e `@google-cloud/dataform`.
- Medição em 2026-10-02, Node 24, criando os clientes de notebooks e de agendamentos:
  - `@google-cloud/aiplatform` 7.4.1: **+241 MB de RSS** (115 MB de heap) ao carregar, porque o cliente gerado lê as definições de protocolo de todo o Vertex AI; o pacote ocupa 80 MB;
  - `@googleapis/aiplatform`: +24 MB, 1,4 s;
  - `@google-cloud/dataform` 3.4: +57 MB; `@googleapis/dataform`: +21 MB.
- O Vertex AI atende cada região no seu endpoint (`https://{região}-aiplatform.googleapis.com/`). Há um cliente por perfil, e o endpoint vai em cada chamada (`rootUrl`). O Dataform usa o endpoint global.
- Discovery comparado (D-03 da SPEC-0001): todos os métodos usados existem em REST, inclusive `notebookRuntimes.assign`, `start`, `stop` e `upgrade`, `schedules.pause` e `resume`, e os métodos de arquivo do Dataform (`commit`, `readFile`, `queryDirectoryContents`, `fetchHistory`).

**Racional:** só o gRPC do Vertex AI já estoura o orçamento de 350 MB da SPEC-0001 NFR-03 e a medição de carga da D-23. Nenhum recurso do Colab precisa de streaming, que é o motivo do gRPC primeiro.

### D-03 — Regiões: uma lista conhecida, todas ou uma

- A lista é a da documentação do Colab Enterprise em 2026-10-02: 35 regiões, em `COLAB_REGIONS` nos contratos. Uma região fora da lista ainda abre quando vem na URL.
- Toda lista tem um seletor de região guardado na URL (`?region=`). O padrão é **All regions**: fan-out com concorrência 8 e as regiões que falham num aviso de resultado parcial (SPEC-0001 D-17). O Vertex AI atende cada região no seu endpoint (D-02), sem uma listagem de todas. O Dataform não documenta o curinga, e uma recusa com um erro inesperado derrubaria a aba inteira, então ele também faz fan-out.
- Só a aba aberta carrega, mais os nomes que ela mostra (notebooks nas abas de execuções e de agendamentos, templates na de runtimes).
- **Execuções:** com todas as regiões, a página mais recente de cada uma (100), juntas e ordenadas pela criação, com um aviso das regiões que têm mais. Com uma região, a lista pagina até o fim.
- **Execuções de um notebook ou de um agendamento:** o servidor varre as 500 execuções mais recentes da região e filtra pelo recurso, comparando sem o projeto (o Google responde com o número do projeto). A página avisa quando há mais execuções do que as varridas. O filtro `schedule` da API não documenta o formato do valor, por isso não é usado.

**Racional:** uma visão por produto, como no console, sem uma chamada por região a cada aba. Execuções de notebooks agendados se acumulam aos milhares, então "todas" precisa de um limite honesto.

### D-04 — Notebooks são repositórios do Dataform

- Um notebook do Colab Enterprise (e do BigQuery Studio) é um repositório do Dataform com a label `single-file-asset-type=notebook`, documentada na página "Manage a repository" do Dataform. A lista filtra essa label; consultas salvas, data canvases e preparações de dados, que vivem na mesma coleção, ficam de fora.
- O arquivo do notebook é o `.ipynb` da raiz do repositório: `content.ipynb` quando existe, senão o primeiro `.ipynb`. Ele é achado por `queryDirectoryContents` e lido por `readFile`, na versão mais recente ou num commit.
- **Criar:** um repositório com id UUID, nome de exibição, a label e `setAuthenticatedUserAdmin: true`, seguido de um commit de `content.ipynb` com o arquivo enviado ou um notebook de uma célula vazia. Se o commit falha, o repositório é excluído, para não deixar um notebook vazio que não abre.
- **Renomear** muda o `displayName`. **Excluir** usa `force: true` e exige digitar o nome de exibição (SPEC-0001 D-13).
- Um repositório sem a label responde `NOT_FOUND` na página de notebook.

### D-05 — Versões e envio de uma versão nova

- O histórico é o `fetchHistory` do repositório. Toda versão pode ser vista (`?commit=` na URL da página) e baixada.
- **Upload version** envia o `.ipynb` inteiro como um commit, com `requiredHeadCommitSha` igual à versão que a página carregou. Se alguém salvou depois, o Nephoscope recusa com `CONFLICT` e diz quem salvou; nunca sobrescreve.
- O autor do commit é a identidade do perfil (o e-mail da conta de serviço ou do usuário); sem e-mail, `nephoscope@localhost`. A mensagem padrão diz que a versão veio do Nephoscope.
- Antes de enviar, o servidor e o navegador conferem que o texto é JSON com `cells` (nbformat 4) e tem até 10 MiB.

**Racional:** sem kernel, editar célula por célula seria um editor de texto de JSON; o arquivo inteiro com proteção de conflito cobre o caso real (trocar o notebook que um agendamento roda) sem risco de apagar o trabalho de outra pessoa.

### D-06 — O visualizador nunca executa nem renderiza markup

- O servidor normaliza o notebook: células de código, markdown e raw; saídas de stream, de resultado (texto, imagem, markdown, JSON) e de erro, com o traceback sem códigos ANSI.
- **HTML nunca é renderizado.** Uma saída HTML aparece como "HTML output, not rendered", com a fonte como texto a um clique (SPEC-0001 D-22). Markdown aparece como texto, com peso nas linhas de título.
- Imagens PNG, JPEG, GIF, WebP e SVG aparecem só por `<img>` com data URI, que não executa scripts; a CSP já permite `data:` em `img-src`.
- Texto acima de 512 KiB por célula ou saída é cortado com um marcador. Widgets e outros tipos MIME são listados como não mostrados. Notebooks acima de 30 MiB não são mostrados, só baixados.

### D-07 — Templates de runtime

- **Criar:** nome, id opcional, descrição, tipo de máquina, GPU e quantidade, tipo e tamanho do disco, rede, sub-rede, acesso à internet, tags de rede, desligamento por inatividade (10 a 1440 minutos, ou desligado), credenciais do usuário final (EUC), Secure Boot, chave do KMS, labels, release da imagem do Colab, script pós-início (texto, URL `gs://` e comportamento) e variáveis de ambiente. É uma operação no tray.
- **Editar:** só o que o patch do Google aceita: nome, script pós-início e seu comportamento, variáveis de ambiente e release da imagem. A máscara leva apenas os campos que mudaram. O resto exige um template novo, e o formulário diz isso.
- `eucConfig.eucDisabled` é só de entrada; quando a leitura não o traz, a página mostra "Not reported".
- **Excluir** exige digitar o nome de exibição.

### D-08 — Execuções e agendamentos compartilham a especificação da execução

- Uma execução é descrita por `ColabJobSpecSchema`: nome, fonte (um notebook, na versão mais recente ou fixada num commit, ou um `.ipynb` no Cloud Storage), template, pasta de saída `gs://`, identidade (conta de serviço ou usuário), timeout (padrão 24 horas, até 7 dias) e kernel.
- O corpo `NotebookExecutionJob` é montado por `toNotebookExecutionJob` nos contratos, usado pela API e pelo "Equivalent command" dos formulários.
- A identidade sugerida é a do perfil: conta de serviço para chaves de conta de serviço, usuário para credenciais do gcloud.
- **Agendamentos:** cron com prefixo `TZ=` do fuso escolhido e as próximas execuções mostradas enquanto se digita, execuções simultâneas (1 a 100), limite de execuções, fim e enfileirar o que passar do limite. A lista mostra só agendamentos de notebook (filtro `create_notebook_execution_job_request:*`; os de pipeline vivem na mesma coleção).
- **Editar um agendamento** envia só os campos que mudaram; a especificação da execução vai inteira quando qualquer parte dela muda.
- **Pausar**; **retomar** pergunta se as execuções puladas devem rodar (catch-up).
- **Run now** num agendamento cria uma execução com a mesma especificação; a API não tem "rodar o agendamento agora". Fica desligado quando o Google não informou alguma parte da especificação.
- **Excluir:** uma execução exige digitar o id, porque execuções repetem o nome; um agendamento, o nome de exibição. Excluir uma execução não apaga a saída dela no Cloud Storage.

### D-09 — Runtimes

- **Criar** é o `assign` a partir de um template. O dono do runtime (`runtimeUser`) é a identidade do perfil, que precisa ter e-mail; sem ela o botão fica desligado e diz o motivo.
- **Start**, **Stop**, **Upgrade** (só quando o Google diz que há atualização) e **Delete** (digitar o nome de exibição) são operações no tray.
- A página avisa quando o runtime pertence a outra identidade (só ela conecta notebooks) e diz que o Nephoscope não conecta kernels.

### D-10 — A saída de uma execução

- A execução grava em `gcsOutputUri`. O Nephoscope lista até 200 objetos com o prefixo `{pasta}/{id da execução}` e mostra o primeiro `.ipynb` com o visualizador da D-06, lido pelo cliente do Cloud Storage do perfil.
- A rota de leitura só abre `.ipynb` sob esse prefixo.
- Quando nada é achado, a página dá o link da pasta de saída no navegador de objetos (SPEC-0006 D-11).

### D-11 — Comando equivalente só em REST

Os formulários do Colab mostram a requisição REST equivalente, montada pelo mesmo código que a API envia. O comando `gcloud colab` não é mostrado porque os flags não foram verificados (R-04).

**Racional:** um comando com flags errados é pior que nenhum (princípio "Truth over decoration"). Diverge da SPEC-0001 CA-65 até a verificação.

---

## 6. Escopo

### Dentro

Notebooks, versões, runtimes, templates de runtime, execuções e sua saída, agendamentos de notebook, em todas as regiões do Colab Enterprise, com as rotas `/api/projects/{p}/colab/...` e as páginas `/p/{p}/colab/...`.

### Fora

Os não-objetivos da §4; agendamentos de pipeline do Vertex AI; uma aba de logs das execuções enquanto o tipo de recurso do Cloud Logging não for verificado (R-07).

---

## 7. Requisitos

**CA-01** — A página `/p/{p}/colab` tem as abas Notebooks, Executions, Schedules, Runtimes e Runtime templates, o seletor de região da D-03, filtro de texto, atualização manual e automática (SPEC-0001 CA-62) e o aviso de resultado parcial. `g c` abre a página.

**CA-02** — Notebooks seguem a D-04 e a D-05: listar, criar vazio ou de um arquivo, ver células e saídas (D-06), ver e baixar qualquer versão, enviar uma versão nova com proteção de conflito, renomear, excluir com o nome digitado, ver as execuções e os agendamentos do notebook, e o recurso bruto em YAML ou JSON.

**CA-03** — Templates de runtime seguem a D-07, com criar runtime a partir do template e o recurso bruto.

**CA-04** — Runtimes seguem a D-09, com estado, saúde, máquina, template, dono e expiração na lista e no detalhe, e o recurso bruto.

**CA-05** — Execuções seguem a D-03, a D-08 e a D-10: lista, detalhe com estado, erro, duração, fonte, template, saída e identidade, aba Output com os arquivos e o notebook executado, rodar de novo, excluir e o recurso bruto.

**CA-06** — Agendamentos seguem a D-08: lista, detalhe com as próximas execuções, criar e editar, pausar, retomar com catch-up opcional, rodar agora, execuções do agendamento, excluir e o recurso bruto.

**CA-07** — Toda mudança é bloqueada em modo somente leitura e auditada (SPEC-0001 D-12, CA-48). Criar template, criar, iniciar, parar, atualizar e excluir runtime, criar e excluir execução, excluir template e agendamento são operações acompanhadas no tray (SPEC-0001 D-09).

**CA-08** — Conteúdo de notebooks e saídas é mostrado apenas como texto e como imagens por `<img>` (D-06).

---

## 8. Requisitos não-funcionais

| Id | Requisito |
|---|---|
| **NFR-01** | Carregar os clientes do Colab acrescenta no máximo 60 MB de RSS (medido na D-02: cerca de 45 MB). |
| **NFR-02** | Com "All regions", uma aba faz no máximo uma chamada de listagem por região (mais as páginas seguintes dela), com concorrência 8. |

---

## 9. Cenários de teste

| Id | Cenário | Onde | Esperado |
|---|---|---|---|
| **T-01** | Mapeamento de execuções, templates e agendamentos; máscaras de patch; corpo da execução; links; leitura de páginas | Unitário (`apps/api/src/modules/colab/colab.spec.ts`) | Passa |
| **T-02** | Notebook com markdown, stream, resultado com HTML, PNG e widget, erro com ANSI, SVG; texto longo; JSON inválido; nbformat 3 | Unitário (`colab.spec.ts`) | HTML só como texto, SVG só como imagem, ANSI removido, corte com marcador, mensagens claras |
| **T-03** | Todo produto do registro aponta para um arquivo de spec existente | Unitário (`packages/contracts`) | Passa |
| **T-04** | Criar um template com GPU, editar o script pós-início, criar um runtime a partir dele, parar, iniciar, excluir | Sandbox | Operações no tray; a edição envia só os campos mudados |
| **T-05** | Criar um notebook a partir de um arquivo e abri-lo no Colab Enterprise do console | Sandbox | O console abre o notebook (verifica R-02) |
| **T-06** | Enviar uma versão; salvar no Colab; enviar outra a partir da página antiga | Sandbox | A segunda é recusada com `CONFLICT` e o autor |
| **T-07** | Rodar um notebook com conta de serviço e ver a aba Output | Sandbox | O notebook executado aparece (verifica R-03) |
| **T-08** | Agendar com `TZ=America/Sao_Paulo`, pausar, deixar passar um disparo, retomar com catch-up | Sandbox | A execução perdida roda |
| **T-09** | Com um perfil somente leitura, tentar criar, rodar, pausar e excluir | Sandbox | Todos recusados com `READ_ONLY` |
| **T-10** | "All regions" com uma região inacessível | Sandbox | Lista mostrada com o aviso de resultado parcial |

---

## 10. Plano de entrega

| Passo | Entregável | Depende de |
|---|---|---|
| C.1 | Contratos, registro, módulo da API com os dois clientes REST | M0 |
| C.2 | Página do produto e detalhes de notebook, runtime, template, execução e agendamento | C.1 |
| C.3 | Formulários: notebook, versão, template, runtime, execução, agendamento | C.2 |

**Estado.** C.1 a C.3 entregues em 2026-10-02. T-01 a T-03 passam. T-04 a T-10 dependem da SPEC-0001 Q-02.

---

## 11. Riscos e questões em aberto

### Riscos

| Id | Risco | Mitigação |
|---|---|---|
| **R-01** | "All regions" custa uma chamada por região a cada aba; medido em 2026-10-02, de 5 a 9 s por aba num projeto real, contra 0,4 a 1,6 s com uma região | Só a aba aberta carrega; a região escolhida fica na URL; atualização automática desligada por padrão |
| **R-02** | O nome `content.ipynb` dos notebooks criados pelo Nephoscope não está na documentação | Notebooks existentes mantêm o arquivo que têm (D-04); T-05 verifica no console |
| **R-03** | O layout da saída das execuções no Cloud Storage não está documentado | Busca pelo prefixo com o id da execução e link para a pasta quando nada aparece (D-10); T-07 verifica |
| **R-04** | Flags do `gcloud colab` não verificados | Só REST no comando equivalente (D-11) |
| **R-05** | A lista de regiões do Colab muda | Lista nos contratos com a data da fonte; qualquer região abre pela URL |
| **R-07** | O tipo de recurso das execuções no Cloud Logging não foi verificado | Sem aba de logs até a verificação no sandbox |

### Questões em aberto

| Id | Questão | Necessária até |
|---|---|---|
| **Q-01** | O envio de um `.ipynb` inteiro basta para mudar notebooks pelo Nephoscope, ou você quer edição de células no navegador (sem executar)? | Antes de qualquer trabalho de edição |

---

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-10-02 | 0.1 | | Versão inicial com a implementação: D-01 a D-11, CA-01 a CA-08, NFR-01 e NFR-02, T-01 a T-10, R-01 a R-07, Q-01. Clientes REST por medição de memória (D-02); notebooks como repositórios do Dataform (D-04) |
| 2026-10-02 | 0.2 | | Verificação ao vivo, só leitura, num projeto real: as cinco listas respondem nas 35 regiões sem erro; os 22 nomes de permissão da sondagem são válidos (R-06 removido); tempo de "All regions" medido em R-01 |

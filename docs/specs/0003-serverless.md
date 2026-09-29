# SPEC-0003 — Serverless

| | |
|---|---|
| **Status** | Rascunho |
| **Autor(es)** | |
| **Revisores** | |
| **Sistemas** | `apps/api/src/products/{run,functions,workflows,scheduler,tasks,eventarc,appengine,apigateway}` · os `apps/web/src/products/*` correspondentes |
| **SDKs** | `@google-cloud/run` (v2) e `@googleapis/run` (lista global v1) · `@google-cloud/functions` (v2, mais o cliente v1 para mudanças em gen1) e `@googleapis/cloudfunctions` (upgrade e detach) · `@google-cloud/workflows` (Workflows e Executions) e `@googleapis/workflowexecutions` (step entries) · `@google-cloud/scheduler` · `@google-cloud/tasks` · `@google-cloud/eventarc` · `@google-cloud/appengine-admin` · `@google-cloud/api-gateway` |
| **Spec relacionada** | [SPEC-0001](./0001-platform.md) (convenções, operações, kit de recursos) · [SPEC-0002](./0002-design-system.md) · [SPEC-0005](./0005-observability.md) (abas de logs e métricas) · [SPEC-0007](./0007-security-delivery.md) (seletor de imagem, segredos, IAM) |
| **Última atualização** | 2026-09-28 |
| **Versão** | 0.4 |

---

## 1. Resumo

O grupo serverless é o núcleo do Nephoscope e o primeiro marco de produto (M1). Cobre Cloud Run services e jobs, Cloud Run functions (incluindo Cloud Functions gen1 e gen2), Workflows, Cloud Scheduler, Cloud Tasks e Eventarc, mais App Engine (M6) e API Gateway (M7).

Cloud Run, functions e Workflows chegam ao **L3**: além de listar e editar, o Nephoscope faz deploy de revisões, divide tráfego, faz rollback, executa jobs com overrides, testa functions, mostra o código-fonte das functions, edita e desenha workflows, e acompanha execuções ao vivo. Todo recurso ganha as abas compartilhadas Logs e Metrics (SPEC-0005), com filtros e gráficos predefinidos para o seu tipo.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Service** | Um Cloud Run service: uma URL que atende requisições a partir de uma ou mais revisões. |
| **Revisão** | Um retrato imutável do template de um service (contêineres, configuração). Todo deploy cria uma. |
| **Alvo de tráfego** | Uma fatia do tráfego de um service (percentual inteiro) enviada a uma revisão ou à última revisão pronta. Pode ter uma tag. |
| **Tag** | Um nome num alvo de tráfego que dá àquela revisão uma URL própria. |
| **Job** | Um Cloud Run job: um contêiner que roda até terminar, como uma ou mais tasks. |
| **Execução** | Uma rodada de um job (Cloud Run) ou de um workflow (Workflows). |
| **Task** | Uma instância de uma execução de Cloud Run job. Também é uma unidade de trabalho no Cloud Tasks; o contexto do produto desfaz a ambiguidade. |
| **Function** | Uma Cloud Run function. Ou um recurso do Cloud Functions (gen1 ou gen2), ou um Cloud Run service implantado a partir de código de function. |
| **Revisão de workflow** | Uma versão imutável do código de um workflow, criada a cada deploy. |
| **Step entry** | O registro de um passo de uma execução de workflow: nome do passo, estado, tempos. |
| **Job do Scheduler** | Um disparo agendado por cron (alvo HTTP, Pub/Sub ou App Engine). |
| **Fila** | Uma fila do Cloud Tasks, com os seus limites de taxa e política de retry. |
| **Gatilho** | Um gatilho do Eventarc: filtros de evento, um destino e um transporte. |

---

## 3. Problema

Os produtos serverless são onde quem trabalha a partir de chaves passa a maior parte do tempo, e onde o console do Google é mais difícil de trocar pelo `gcloud`. Várias tarefas exigem muitos comandos ou simplesmente não são possíveis pela CLI:
- comparar revisões;
- ajustar tráfego;
- rodar um job com outros argumentos;
- testar uma function privada;
- ler um workflow como grafo;
- acompanhar uma execução passo a passo.

---

## 4. Objetivos

1. Tudo que um desenvolvedor faz no dia a dia com Cloud Run, functions e Workflows, a partir do Nephoscope, com os logs e métricas certos a um clique.
2. Deploys seguros: ver exatamente o que muda, manter o tráfego sob controle, fazer rollback numa ação.
3. Fechar o ciclo entre produtos: um job do Scheduler que roda um Cloud Run job ou um workflow pode ser criado a partir de qualquer um dos dois lados.

### Não-objetivos

- **Deploy a partir de código-fonte para Cloud Run services** (builds pelo Cloud Build). Adiado para a SPEC-0007 (Cloud Build) como extensão.
- **Editar o YAML do Knative diretamente.** O YAML é mostrado somente leitura; as edições passam por formulários.
- **Criar functions gen1 novas.** Functions gen1 podem ser vistas, invocadas e excluídas.
- **Domain mappings do Cloud Run** além de uma lista somente leitura.
- **Emulação local** de qualquer um desses produtos.

---

## 5. Decisões tomadas

### D-01 — Cloud Run pela Admin API v2, com a lista global da v1

As leituras e mutações do Cloud Run usam a Admin API v2 (`@google-cloud/run`), **exceto as listas entre regiões**:
- Os métodos `list` da v2 rejeitam o curinga `locations/-`.
- A **API v1 no endpoint global** lista todas as regiões numa chamada e informa em `unreachable` as regiões que não conseguiu alcançar:
  - `GET https://run.googleapis.com/apis/serving.knative.dev/v1/namespaces/{project}/services`
  - `GET https://run.googleapis.com/apis/run.googleapis.com/v1/namespaces/{project}/jobs`
- Essas chamadas passam pelo `@googleapis/run`, já que o `@google-cloud/run` cobre só a v2. Elas suportam `labelSelector`, `limit` e `continue`.
- Cada item da v1 (formato Knative: `metadata`, `spec`, `status`) é mapeado para o DTO da lista e para o seu nome v2, `projects/{project}/locations/{region}/services/{name}`. Toda página de detalhe e toda mutação usam a v2 a partir daí.

Services e jobs aparecem numa só visão, com a location como coluna e como faceta.

**Racional:** a v2 é a API atual e expõe o template inteiro do service num só recurso. Uma lista só entre regiões é o que o usuário espera do console do Google, e uma chamada global v1 é muito mais barata que cerca de 40 chamadas regionais a cada carregamento de página.

### D-02 — Um deploy é uma atualização do template do service

"Deploy revision" edita o template do service e cria uma revisão nova como operação. Editáveis no M1:
- **Contêiner:** imagem, porta, comando e argumentos, variáveis de ambiente (valores simples e referências ao Secret Manager), limites de CPU e memória, CPU sempre alocada ou só durante requisições, boost de CPU na inicialização.
- **Escala e requisições:** concorrência, timeout de requisição, mínimo e máximo de instâncias.
- **Runtime:** ambiente de execução, conta de serviço.
- **Rede:** ingress, saída para VPC (Direct VPC ou connector).
- **Metadados:** labels, sufixo da revisão.
- **"Serve this revision immediately":** ligado, a última revisão recebe 100%; desligado, a divisão de tráfego atual é mantida.

Contêineres sidecar, volumes e probes aparecem somente leitura no M1. Um deploy mantém exatamente como estava tudo o que não edita.

**Racional:** esses campos cobrem quase todos os deploys do dia a dia. Preservar os campos não tocados garante que o Nephoscope nunca descarte em silêncio uma configuração para a qual não tem formulário.

### D-03 — Edição de tráfego e rollback

- O editor de tráfego define percentuais inteiros, por revisão ou "latest", que precisam somar 100, e gerencia as tags.
- **Rollback** manda 100% para uma revisão anterior escolhida, numa ação confirmada.
- Os dois rodam como operações e mostram o comando equivalente.

**Racional:** a divisão de tráfego é a principal ferramenta de segurança do Cloud Run. Passos inteiros batem com a API.

### D-04 — Acesso público

"Allow public access" é oferecido de duas formas, e a página mostra qual está em vigor:
1. um binding de IAM de `roles/run.invoker` para `allUsers` no service;
2. desligar a checagem de IAM de invoker no service (`invokerIamDisabled`), para organizações cuja política proíbe `allUsers`.

As duas mostram um aviso e pedem confirmação. Erros de política da organização aparecem como o Google os devolve.

**Racional:** o console do Google oferece as duas. Algumas organizações bloqueiam bindings de `allUsers` por política, e a segunda forma é como elas tornam services públicos.

### D-05 — Revisões: comparar antes de confiar

- A aba de revisões lista cada revisão com a sua fatia de tráfego, data de criação, o principal que fez o deploy, o digest da imagem e um resumo da configuração.
- Duas revisões podem ser **comparadas**: um diff dos templates normalizados, no editor de diff.
- Uma revisão que não recebe tráfego pode ser excluída (confirmação digitada).

**Racional:** "o que mudou entre a revisão que funcionava e a que não funciona" é a primeira pergunta durante um incidente.

### D-06 — Jobs rodam com overrides

"Execute" inicia uma execução, opcionalmente com overrides de argumentos do contêiner, variáveis de ambiente, quantidade de tasks e timeout. A execução aparece na hora e se atualiza ao vivo. Execuções podem ser canceladas ou excluídas. A configuração do job é editada com o mesmo formulário do template de service, onde os campos se aplicam.

**Racional:** rodar o mesmo job com outros argumentos é a operação de job mais comum, e o Cloud Run suporta overrides por execução.

### D-07 — Uma lista de functions, duas fontes

A lista de functions junta:
1. **A API v2 do Cloud Functions**, listada com `locations/-` (que devolve resultados parciais e `unreachable`). Desde dezembro de 2022 essa lista também devolve functions **gen1** (`environment: GEN_1`), somente leitura pela v2.
2. **Cloud Run services com `buildConfig.functionTarget`.** Functions criadas pela Cloud Run Admin API (o console do Cloud Run, `gcloud run deploy --function`) são gerenciadas só pelo Cloud Run e não aparecem na API do Functions. O mesmo vale para functions movidas para o Cloud Run com `detachFunction`.

Uma function gen2 da API do Functions é sustentada por um Cloud Run service (`serviceConfig.service`). A junção remove essa duplicata, mostra a function uma vez e a liga às duas visões.

**Racional:** desde que as functions viraram "Cloud Run functions", as functions novas são criadas por padrão pelo lado do Cloud Run. Os usuários pensam nelas como uma lista só, e sem a segunda fonte as functions criadas do jeito padrão sumiriam.

### D-08 — O teste só chama a URL do próprio recurso

- A aba Testing de uma function HTTP ou de um service envia uma requisição (método, caminho, query, cabeçalhos, corpo de até 1 MiB) para **a URL do próprio recurso**, ou para a URL de uma revisão com tag, e mostra status, cabeçalhos, tempos e corpo (JSON formatado, truncado depois de 5 MiB).
- Para recursos privados, o Nephoscope gera um ID token para a URL com o perfil ativo. Quando o tipo de credencial não consegue gerar ID tokens (por exemplo `authorized_user`), a aba explica o motivo e o que usar no lugar.
- Functions acionadas por evento são testadas publicando no tópico delas (SPEC-0006) ou mostrando o comando `gcloud` equivalente.

**Racional:** testar uma function privada sem montar tokens à mão é uma das coisas mais úteis que um console pode fazer. Restringir as chamadas à URL do próprio recurso impede que o Nephoscope vire um proxy aberto (SPEC-0001 D-05).

### D-09 — Código das functions: ver em todas, editar e reimplantar na gen2

- **Ver.** A aba Source obtém uma URL assinada com `generateDownloadUrl` (válida por 30 minutos; exige `cloudfunctions.functions.sourceCodeGet`), baixa o arquivo no servidor (no máximo 100 MiB), lista os arquivos e os mostra somente leitura com destaque de sintaxe. O arquivo pode ser baixado. O código de gen1 vem do método equivalente da API v1.
- **Editar e reimplantar, só na gen2.** Os arquivos podem ser editados e reimplantados:
  1. o Nephoscope monta um novo arquivo zip;
  2. chama `generateUploadUrl` e faz PUT do arquivo na URL devolvida, com `content-type: application/zip` e **sem** cabeçalho `Authorization`;
  3. atualiza a function com o `storageSource` devolvido como `buildConfig.source.storageSource`, como operação.
- **Gen1 é somente leitura**, exceto invocar e excluir (a exclusão usa o cliente v1, já que a API v2 só lê gen1).
- **Functions criadas pelo Cloud Run** (D-07, fonte 2) são reimplantadas por deploy de código-fonte do Cloud Run, que está fora do escopo (§4).

**Racional:** o editor embutido do console do Google é muito usado em functions pequenas. A gen1 é legada e somente leitura basta.

### D-10 — Workflows: editor, revisões, grafo

- O editor abre o workflow no formato em que está guardado (YAML ou JSON), com validação a partir de um **schema de sintaxe do Workflows escrito pelo Nephoscope** a partir da referência oficial de sintaxe (não existe schema público).
- O deploy atualiza o workflow como operação, criando uma revisão nova. Erros de deploy viram marcadores na linha e coluna informadas, quando o erro as traz.
- As revisões podem ser listadas e comparadas no editor de diff.
- Um **grafo somente leitura** dos passos (sequência, saltos, ramos de `switch`, laços, ramos paralelos, try, retry e except, subworkflows) é diagramado com o elkjs. Selecionar um nó seleciona as linhas dele no editor.

**Racional:** o grafo é o principal motivo para abrir o console do Google para o Workflows. Escrever o nosso próprio schema dá completação e validação, que o console do Google não tem.

### D-11 — Execuções de workflow, acompanhadas ao vivo

- **Execute** recebe:
  - um argumento JSON, validado antes do envio;
  - um nível de log de chamadas;
  - o nível do histórico de execução: básico (o padrão) ou **detalhado**, que também registra os valores das variáveis em escopo a cada passo.
  Os 20 últimos argumentos por workflow ficam guardados (SPEC-0001 CA-53) e podem ser reutilizados.
- A lista de execuções mostra estado, início, duração e a revisão do workflow.
- **Página de uma execução:**
  - argumento e resultado, ou erro com o stack trace;
  - os **step entries** numa linha do tempo, com os valores das variáveis quando o histórico é detalhado;
  - o caminho percorrido destacado no grafo;
  - a aba Logs.
  Execuções em andamento se atualizam ao vivo e podem ser canceladas.
- **Os step entries vêm da API REST**, pelo `@googleapis/workflowexecutions`:
  - `GET https://workflowexecutions.googleapis.com/v1/{execution}/stepEntries`, com `pageSize`, `pageToken`, `filter`, `orderBy` e `skip`;
  - `stepEntries.get`.
  O `ExecutionsClient` gRPC do `@google-cloud/workflows` (6.1.0) só cria, obtém, lista e cancela execuções (SPEC-0001 D-03).
- Os workflows são listados com `locations/-` quando a API aceita, senão por fan-out (SPEC-0001 D-17).

**Racional:** acompanhar uma execução passo a passo é o ciclo central de depuração do Workflows.

### D-12 — Scheduler com prévia do cron e atalhos entre produtos

- As expressões cron são validadas e pré-visualizadas enquanto se digita: uma descrição em inglês simples (`cronstrue`) e as próximas 5 execuções (`cron-parser`), no fuso do job e no local.
- Alvos: HTTP (método, URL, cabeçalhos, corpo, token OIDC ou OAuth com uma conta de serviço), Pub/Sub (tópico, dados, atributos) e App Engine HTTP. A configuração de retry é editável.
- Ações: pausar, retomar, **executar agora**, excluir.
- **Atalhos:** "Schedule this job" num Cloud Run job e "Schedule this workflow" num workflow abrem o formulário do Scheduler preenchido com a URL de API, o método, o escopo OAuth e o corpo certos.
- Os jobs são listados com `locations/-` quando a API aceita, senão por fan-out nas locations do Scheduler (SPEC-0001 D-17).

**Racional:** agendar um job ou um workflow exige saber a URL de API e o tipo de token exatos; preencher isso elimina o erro mais comum.

### D-13 — Cloud Tasks no L2

- Filas: criar, atualizar limites de taxa e configuração de retry, pausar, retomar, purgar (confirmação digitada), excluir.
- Tasks: listar com horário agendado, quantidade de despachos e última tentativa; criar tasks HTTP (URL, método, cabeçalhos, corpo, token OIDC); executar agora; excluir.

### D-14 — Eventarc no L2

Os gatilhos são listados entre locations e podem ser criados e excluídos. O formulário de criação cobre filtros de evento (tipo e atributos, escolhidos no catálogo do provedor), o destino (Cloud Run service e caminho, ou um workflow), a conta de serviço e o tópico de transporte.

### D-15 — App Engine no L2 (M6)

Configurações da aplicação; services; versões com estado de atendimento, divisão de tráfego e instâncias; migrar ou dividir tráfego; iniciar e parar versões com escala manual ou básica; excluir versões. Regras de firewall, cron e regras de dispatch ficam no L1.

### D-16 — API Gateway no L1 (M7)

APIs, configurações de API e gateways: lista, detalhe e recurso bruto.

### D-17 — Seletor de imagem mínimo no M1

O formulário de deploy escolhe uma imagem nos repositórios do Artifact Registry do projeto (repositório, imagem, tag ou digest) ou aceita uma referência de imagem digitada. "Pin by digest" troca a tag pelo digest. O produto Artifact Registry completo chega no M5 (SPEC-0007).

**Racional:** escolher uma imagem faz parte de todo deploy, e um seletor evita erros de digitação em caminhos de imagem longos.

### D-18 — Upgrade e detach de gen1 (M7)

Os fluxos que fazem upgrade de uma function gen1 para Cloud Run function (preparar, redirecionar tráfego, reverter, confirmar, abortar) e o `detachFunction` só existem na API REST. Eles são oferecidos no M7 pelo `@googleapis/cloudfunctions`, como uma sequência guiada com o estado do tráfego visível a cada passo.

**Racional:** úteis para migrar functions legadas, mas não necessários no dia a dia, então esperam o marco da cauda longa.

---

## 6. Escopo

### Dentro
Cloud Run services, revisões e jobs; Cloud Run functions e Cloud Functions gen1 e gen2; Workflows e execuções; Cloud Scheduler; Cloud Tasks; Eventarc; App Engine (M6); API Gateway (M7); o seletor de imagem mínimo; as predefinições das abas Logs e Metrics de todo tipo de recurso daqui.

### Fora
Deploy a partir de código-fonte para services, domain mappings além de uma lista, edição do YAML do Knative, criação de gen1. Cloud Run worker pools e instâncias ficam no L1 pela SPEC-0009 D-06.

---

## 7. Requisitos

### 7.1 Cloud Run services

**CA-01** — A lista de services mostra:
- nome, estado, location e URL;
- horário e principal do último deploy;
- resumo do tráfego ("100% latest", "2 revisions");
- ingress, autenticação (pública ou exige auth), e se é uma function.

Facetas: location, estado, ingress, autenticação.

**CA-02** — A página do service mostra as abas:
- Overview: URL com copiar, condições de estado, tráfego atual e resumo da configuração;
- Revisions, Metrics, Logs;
- Testing: chamar a URL do service com um ID token (D-08), como na aba Testing das functions;
- Triggers: gatilhos do Eventarc e jobs do Scheduler que miram o service;
- Security: conta de serviço, invokers e acesso público;
- Networking: ingress e saída para VPC;
- YAML.

**CA-03** — "Deploy revision" abre um painel deslizante com os campos da D-02, preenchidos a partir do template atual, com validação inline, o comando equivalente e um resumo do que muda em relação à revisão atual antes de confirmar. Inicia uma operação (SPEC-0001 CA-27).

**CA-04** — O editor de tráfego (D-03) só permite salvar quando o total é 100, e mostra o efeito numa frase ("Revision abc-00012 will get 50%, abc-00011 will get 50%").

**CA-05** — "Roll back" numa revisão manda 100% do tráfego para ela após confirmação.

**CA-06** — Duas revisões podem ser selecionadas e comparadas (D-05).

**CA-07** — O acesso público (D-04) mostra qual forma está ativa e alterna entre nenhuma, invoker `allUsers` e checagem de invoker desligada, com aviso e confirmação.

**CA-08** — Excluir um service exige digitar o nome dele (SPEC-0001 D-13).

### 7.2 Cloud Run jobs

**CA-09** — A lista de jobs mostra nome, location, estado e horário da última execução, quantidade de tasks e agendamento (a partir dos jobs do Scheduler ativos cujo alvo HTTP é a URL `...:run` do job; a dica mostra a descrição em inglês simples e o fuso).

**CA-10** — "Execute" (D-06) oferece overrides de argumentos, variáveis de ambiente, quantidade de tasks e timeout, e depois leva à execução nova.

**CA-11** — A página da execução mostra:
- estado, início e fim, duração;
- contagem de tasks (sucesso, falha, em andamento, canceladas);
- cada task com tentativas, código de saída e link para os logs.

Ela se atualiza ao vivo pelo canal `run.execution` até a execução terminar.

**CA-12** — Execuções em andamento podem ser canceladas; as terminadas, excluídas.

**CA-13** — "Schedule this job" abre o formulário do Scheduler preenchido (D-12).

### 7.3 Functions

**CA-14** — A lista de functions (D-07) mostra nome, geração, runtime, gatilho (HTTP, tipo de evento), location, estado, último deploy e URL.

**CA-15** — A página da function mostra:
- Overview: gatilho, runtime, ponto de entrada, memória, timeout, conta de serviço, ambiente e informações de build;
- Source (D-09) e Testing (D-08);
- Metrics, Logs e YAML.

As functions gen2 ligam ao seu Cloud Run service. As functions que existem só no Cloud Run (a segunda fonte da D-07) aparecem na lista com a geração "Cloud Run" e abrem a página do Cloud Run service, que é onde elas são gerenciadas.

**CA-16** — O teste segue a D-08 e não registra nada além da entrada de auditoria da chamada (SPEC-0001 CA-51).

**CA-17** — Reimplantar código editado de gen2 (D-09) mostra a lista de arquivos alterados antes de confirmar e roda como operação.

### 7.4 Workflows

**CA-18** — A lista de workflows mostra nome, location, estado, revisão, estado e horário da última execução, e nível de log de chamadas.

**CA-19** — A página do workflow mostra as abas Source (editor), Graph, Executions, Revisions, Triggers (Scheduler, Eventarc), Logs e YAML.

**CA-20** — O editor (D-10) valida contra o schema do Workflows enquanto se digita, faz o deploy como operação e mostra os erros de deploy como marcadores.

**CA-21** — Execute (D-11) valida o argumento como JSON antes do envio e oferece os argumentos recentes.

**CA-22** — A página da execução (D-11) mostra argumento, resultado ou erro, step entries numa linha do tempo e no grafo, e logs; ela se atualiza ao vivo pelo canal `workflows.execution` enquanto a execução roda e pode ser cancelada.

**CA-23** — "Schedule this workflow" abre o formulário do Scheduler preenchido (D-12).

### 7.5 Cloud Scheduler

**CA-24** — A lista de jobs mostra nome, location, agendamento (com a descrição em inglês simples), fuso horário, alvo, estado, resultado e horário da última tentativa, e a próxima execução.

**CA-25** — O formulário de criação e edição valida a expressão cron e mostra a prévia da D-12 enquanto se digita.

**CA-26** — Pausar, retomar, executar agora e excluir estão disponíveis por job e em massa (a exclusão em massa exige a quantidade digitada).

### 7.6 Cloud Tasks

**CA-27** — Filas e tasks seguem a D-13. Purgar uma fila exige digitar o nome dela e avisa que as tasks não podem ser recuperadas. Excluir uma task exige digitar o id dela (SPEC-0001 D-13).

### 7.7 Eventarc

**CA-28** — Os gatilhos seguem a D-14. O formulário de criação lista os tipos de evento do catálogo de provedores da location escolhida.

### 7.8 App Engine e API Gateway

**CA-29** — O App Engine segue a D-15 (M6). O API Gateway segue a D-16 (M7).

### 7.9 Predefinições de Logs e Metrics

**CA-30** — Cada tipo de recurso abre a aba Logs (SPEC-0005) com este filtro:

| Recurso | Filtro de log |
|---|---|
| Cloud Run service | `resource.type="cloud_run_revision" resource.labels.service_name="{service}" resource.labels.location="{location}"` |
| Revisão de Cloud Run | Filtro do service mais `resource.labels.revision_name="{revision}"` |
| Cloud Run job | `resource.type="cloud_run_job" resource.labels.job_name="{job}" resource.labels.location="{location}"` |
| Execução de job | Filtro do job mais `labels."run.googleapis.com/execution_name"="{execution}"` |
| Function gen2 ou do Cloud Run | O filtro do seu Cloud Run service |
| Function gen1 | `resource.type="cloud_function" resource.labels.function_name="{function}" resource.labels.region="{location}"` |
| Workflow | `resource.type="workflows.googleapis.com/Workflow" resource.labels.workflow_id="{workflow}" resource.labels.location="{location}"` |
| Job do Scheduler | `resource.type="cloud_scheduler_job" resource.labels.job_id="{job}" resource.labels.location="{location}"` |
| Fila do Tasks | `resource.type="cloud_tasks_queue" resource.labels.queue_id="{queue}"` |

**CA-31** — As abas Metrics (SPEC-0005) mostram estas predefinições:

| Recurso | Gráficos |
|---|---|
| Cloud Run service ou function | Requisições por segundo por classe de resposta; latência p50, p95, p99; instâncias (ativas, ociosas); utilização de CPU e memória; tempo de instância faturável; latência de inicialização |
| Cloud Run job | Execuções e tasks por resultado; duração das tasks; utilização de CPU e memória |
| Workflow | Execuções iniciadas, bem-sucedidas e com falha; duração das execuções; passos por execução |
| Fila do Tasks | Tasks despachadas, profundidade da fila, resultados das tentativas |

Os tipos de métrica e as agregações exatos estão na SPEC-0005.

---

## 8. Requisitos não-funcionais

| Id | Requisito |
|---|---|
| **NFR-01** | A lista de services de um projeto com 200 services em 10 regiões renderiza em menos de 2 s depois que a API responde. |
| **NFR-02** | As páginas de execução ao vivo (jobs e workflows) refletem uma mudança de estado em até 5 s. |
| **NFR-03** | O grafo de workflow diagrama um workflow de 300 passos em menos de 1 s. |

---

## 9. Cenários de teste

Rodam contra um projeto sandbox (SPEC-0001 Q-02). São os cenários de conclusão do M1.

| Id | Cenário | Esperado |
|---|---|---|
| **T-01** | Implantar `us-docker.pkg.dev/cloudrun/container/hello` como service novo em duas regiões | Os dois aparecem numa lista só, com a location |
| **T-02** | Implantar uma revisão nova mudando uma variável de ambiente, com "serve immediately" desligado | A revisão nova existe com 0% de tráfego; a divisão antiga não muda |
| **T-03** | Dividir o tráfego 50/50 entre as duas revisões | O tráfego mostra 50/50; o comando equivalente confere |
| **T-04** | Fazer rollback para a primeira revisão | 100% na primeira revisão |
| **T-05** | Comparar as duas revisões | O diff mostra só a mudança da variável de ambiente |
| **T-06** | Ligar e desligar o acesso público | Uma requisição não autenticada funciona e depois recebe 403 |
| **T-07** | Executar um job com override de argumento e quantidade de tasks 3 | A execução mostra 3 tasks, se atualiza ao vivo até o sucesso, logs de cada task acessíveis |
| **T-08** | Cancelar uma execução de job longa | A execução termina como cancelada |
| **T-09** | Testar uma function HTTP gen2 privada com corpo JSON | Status e corpo da resposta mostrados; entrada de auditoria gravada |
| **T-10** | Abrir a aba Source de uma function gen2, editar um arquivo, reimplantar | Arquivo alterado listado antes da confirmação; a versão nova atende com a mudança |
| **T-11** | Implantar um workflow com erro de sintaxe | Marcador na linha informada; nada implantado |
| **T-12** | Implantar um workflow válido e ver o grafo | O grafo mostra todos os passos e ramos; selecionar um nó seleciona as linhas dele |
| **T-13** | Executar o workflow com um argumento e acompanhá-lo | Step entries e caminho no grafo se atualizam até o sucesso; resultado mostrado |
| **T-14** | Criar um job do Scheduler com "Schedule this workflow" e executá-lo agora | Aparece uma execução nova do workflow |
| **T-15** | Digitar `0 */2 * * 1-5` com o fuso `America/Sao_Paulo` | Descrição "On the hour, every 2 hours, Monday through Friday" (texto do `cronstrue` 3, verificado no M1); próximas 5 execuções listadas |
| **T-16** | Criar uma fila do Tasks e uma task HTTP; executá-la agora | Task despachada; tentativa visível nos logs |
| **T-17** | Criar um gatilho do Eventarc de um bucket do Cloud Storage para um service | Gatilho listado; enviar um objeto gera uma requisição nos logs do service |
| **T-18** | Abrir a lista de functions num projeto com functions gen1, gen2 e do Cloud Run | Cada function listada uma vez, com a sua geração |
| **T-19** | Com um perfil somente leitura, abrir todas as páginas acima | Todo controle de mutação desabilitado; os testes T-02 a T-17 rejeitados com `READ_ONLY` pela API |
| **T-20** | Tail de logs ao vivo num service enquanto roda o T-09 | As linhas de log da requisição aparecem no tail |

---

## 10. Plano de entrega

| Marco | Entregável | Depende de |
|---|---|---|
| **M1** | Cloud Run services e jobs, functions, Workflows, Scheduler, Tasks, Eventarc, seletor de imagem, predefinições de Logs e Metrics | SPEC-0001 M0; painéis compartilhados da SPEC-0005; Q-02 para T-01 a T-20 |
| **M6** | App Engine | M1 |
| **M7** | API Gateway; fluxos de upgrade e detach de gen1 (D-18) | M1 |

---

## 11. Riscos e questões em aberto

### Riscos

| Id | Risco | Mitigação |
|---|---|---|
| **R-01** | Um formulário de deploy descarta uma configuração que não conhece | D-02: campos não tocados são mantidos como estão; T-02 e T-05 conferem o diff |
| **R-02** | Não é possível gerar ID tokens com todo tipo de credencial | D-08: explicar e recorrer ao comando equivalente |
| **R-03** | O schema do Workflows se afasta da linguagem | O schema é versionado em `packages/contracts`; os erros de deploy da API continuam sendo a checagem final |

### Questões em aberto

Nenhuma além da SPEC-0001 Q-02 (projeto sandbox para T-01 a T-20).

---

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-09-28 | 0.1 | | Versão inicial, exportada do plano aprovado: D-01 a D-17, CA-01 a CA-31, NFR-01 a NFR-03, T-01 a T-20, R-01 a R-03 |
| 2026-09-28 | 0.2 | | **Verificação das APIs incorporada.**<br>• D-01: as listas do Cloud Run vêm do endpoint global v1 (`@googleapis/run`), porque a v2 rejeita `locations/-`; detalhes e mutações ficam na v2.<br>• D-07: a lista de functions é a união da API v2 do Functions (`locations/-`, gen1 somente leitura) com os Cloud Run services que têm `buildConfig.functionTarget`, removendo duplicatas por `serviceConfig.service`.<br>• D-09: regras da URL de download (30 minutos, `sourceCodeGet`); upload por PUT com `application/zip` e sem `Authorization`; mudanças em gen1 pelo cliente v1.<br>• D-11: step entries pelo `@googleapis/workflowexecutions`, já que o cliente gRPC não tem nenhum; opção de histórico detalhado; a lista do Workflows tenta `locations/-` e depois faz fan-out.<br>• D-12: a lista do Scheduler tenta `locations/-` e depois faz fan-out.<br>• Nova D-18: fluxos de upgrade e detach de gen1 (só REST), no M7.<br>• Linha de SDKs atualizada.<br>• §6: worker pools e instâncias remetem à SPEC-0009.<br>• Conferido contra os pacotes mais recentes (`@google-cloud/workflows` 6.1.0 não tem step entries; `@google-cloud/run` 4.1.0 é só v2; `@google-cloud/functions` 5.1.0 não tem métodos de upgrade ou detach). |
| 2026-09-28 | 0.3 | | **Tradução para o português** (SPEC-0001 D-26) |
| 2026-09-28 | 0.4 | | **Implementação do M1.**<br>• CA-02: aba Testing nos Cloud Run services, com o mesmo painel de chamada das functions.<br>• CA-09: a coluna de agendamento vem dos jobs do Scheduler ativos cujo alvo é a URL `:run` do job.<br>• CA-15: functions só do Cloud Run aparecem como geração "Cloud Run" e abrem a página do service.<br>• CA-27: excluir uma task exige digitar o id.<br>• CA-13 e CA-23: "Schedule this job" e "Schedule this workflow" ficam no menu de ações da página; as abas Triggers do service, do job e do workflow listam os jobs do Scheduler e os gatilhos do Eventarc que miram o recurso.<br>• T-15: texto real do `cronstrue` para `0 */2 * * 1-5`.<br>• Rotas da API precedidas pelo produto (SPEC-0001 D-07).<br>• Verificado só com a API simulada (Vitest e Playwright); T-01 a T-20 dependem da SPEC-0001 Q-02. |

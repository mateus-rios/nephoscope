# SPEC-0005 — Observabilidade

| | |
|---|---|
| **Status** | Rascunho |
| **Autor(es)** | |
| **Revisores** | |
| **Sistemas** | `apps/api/src/products/{logging,monitoring,errorreporting,trace}` · `apps/web/src/products/{logging,monitoring,errorreporting,trace}` · `LogsPanel` e `MetricsTab` compartilhados em `apps/web/src/kit` |
| **SDKs** | `@google-cloud/logging` (entradas, tail, configuração) · `@google-cloud/monitoring` (séries temporais, descritores de métrica, alertas, uptime, canais de notificação) · `@google-cloud/monitoring-dashboards` · `@googleapis/monitoring` (PromQL pela API Prometheus) · `@googleapis/clouderrorreporting` (v1beta1) · `@googleapis/cloudtrace` (leituras v1) |
| **Spec relacionada** | [SPEC-0001](./0001-platform.md) (canal ao vivo, regra de renderização D-22) · [SPEC-0002](./0002-design-system.md) (gráficos D-14, linhas ao vivo D-10) · [SPEC-0003](./0003-serverless.md) e todas as specs de produto (filtros de log e predefinições de métricas) · [SPEC-0008](./0008-data-compute.md) (BigQuery, para SQL sobre logs) |
| **Última atualização** | 2026-09-28 |
| **Versão** | 0.5 |

---

## 1. Resumo

A observabilidade chega em duas ondas:
- **O M1 constrói as peças compartilhadas** que toda página de recurso usa: o **painel de logs**, com tail ao vivo, e a **aba Metrics**, com gráficos predefinidos.
- **O M3 constrói os produtos completos:** Logs Explorer, Log Router (sinks, buckets, views, exclusões, métricas baseadas em log), Cloud Monitoring (Metrics Explorer com PromQL, dashboards, alertas, uptime checks, canais de notificação), Error Reporting e Cloud Trace.

O Logging tem cotas apertadas e compartilhadas. Elas são a principal restrição de desenho aqui.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **LQL** | A linguagem de consulta do Logging, usada nos filtros. |
| **Painel de logs** | O componente compartilhado que mostra os logs de um recurso, pré-filtrados, com tail ao vivo. |
| **Tail ao vivo** | Uma sessão de streaming (`tailLogEntries`) que envia entradas novas conforme são escritas. |
| **Sink** | Uma regra do Log Router que encaminha as entradas que casam para um destino. |
| **Bucket de log** | Armazenamento de entradas de log, com retenção; pode ser atualizado para análise com SQL. |
| **View de log** | Um subconjunto de um bucket de log que pode ser concedido separadamente. |
| **Métrica baseada em log** | Uma métrica do Cloud Monitoring calculada a partir das entradas de log que casam. |
| **Alinhamento** | A redução de uma série a um ponto por período, feita pelo Cloud Monitoring; usada para manter os gráficos pequenos. |
| **PromQL** | A linguagem de consulta do Prometheus, que o Cloud Monitoring aceita para todas as suas métricas. |
| **Grupo de erro** | O agrupamento de erros semelhantes feito pelo Error Reporting. |
| **Trace** | Uma árvore de spans de uma requisição, do Cloud Trace. |

---

## 3. Problema

Logs e métricas são o que as pessoas mais abrem ao operar um serviço, e o lugar deles é junto do recurso. Duas restrições moldam como o Nephoscope os oferece:
- **As cotas do Logging são pequenas e compartilhadas.** O `entries.list` permite 60 requisições por minuto por projeto, e no máximo 10 sessões de tail ao vivo podem ficar abertas por projeto. O `gcloud`, o console do Google e outras ferramentas usam o mesmo orçamento.
- **Não existe API pública que rode SQL sobre logs.** O Log Analytics, agora chamado Observability Analytics, só pode ser consultado programaticamente por um dataset vinculado do BigQuery.

---

## 4. Objetivos

1. Logs e métricas em toda página de recurso, pré-filtrados, a um clique.
2. Um Logs Explorer bom o bastante para substituir o do console do Google no dia a dia.
3. Nunca esgotar a cota de Logging de um projeto por causa do Nephoscope.
4. Métricas que continuam rápidas e legíveis, com predefinições que dispensam escrever consultas.

### Não-objetivos

- **Gestão de incidentes** do Monitoring além de listar o que a API expõe.
- Visões de **Profiler**, **Service Health** e **Active Assist**.
- **Construir ou editar dashboards visualmente.** Dashboards são visualizados e editados como JSON.

---

## 5. Decisões tomadas

### D-01 — Um painel de logs, em todo lugar

O painel de logs (M1) recebe um filtro base do recurso (SPEC-0003 CA-30 e cada spec de produto) e oferece:
- um intervalo de tempo (SPEC-0002 CA-27) e filtros de severidade;
- um filtro LQL extra opcional;
- as entradas mais recentes primeiro, virtualizadas, com "Load older";
- uma linha por entrada: timestamp, glifo de severidade e um resumo. Em entradas HTTP, o resumo é método, status, latência e URL; nas demais, é o payload de texto ou o `jsonPayload.message`;
- uma árvore JSON expansível por entrada, em que **"Show matching"** sobre qualquer valor acrescenta `campo="valor"` ao filtro;
- um botão de tail ao vivo (D-03), um link para a entrada e "Open in Logs Explorer". Até o Logs Explorer do Nephoscope chegar (M3), o link é "Open in Google Cloud console" e abre a mesma consulta no console do Google.

Tudo numa entrada de log é renderizado como texto (SPEC-0001 D-22).

### D-02 — O Nephoscope nunca esgota a cota do `entries.list`

- Um limitador no servidor permite no máximo **40 chamadas de `entries.list` por minuto por projeto**, deixando um terço das 60 por minuto do Google para as outras ferramentas.
- As chamadas além disso não esperam no servidor: a API responde na hora com `RESOURCE_EXHAUSTED` e `retryAfterSeconds` (SPEC-0001 D-08). O painel mostra "Waiting for Logging quota, about {n} s", conta o tempo e repete a mesma requisição; a espera é cancelada se o usuário sair. Assim nenhuma requisição fica presa no servidor.
- As listas usam o `entries.list` REST (`logging.googleapis.com/v2/entries:list`) com o token do perfil; o tail usa o `tailLogEntries` gRPC do `@google-cloud/logging-api`.
- Um `RESOURCE_EXHAUSTED` do Google dispara um backoff para aquele projeto, começando em 10 s.
- **Listas de log nunca se atualizam sozinhas.** As entradas novas chegam pelo tail ao vivo (D-03), as antigas por "Load older".
- Cada requisição pede o tamanho de página de que a visão precisa (padrão 100) e só os campos que ela mostra, onde a API permite.

**Racional:** sem essas regras, algumas abas abertas trancariam para fora da leitura de logs o usuário, os colegas dele e a automação.

### D-03 — O tail ao vivo é compartilhado e limitado

- O tail ao vivo usa `tailLogEntries` no canal `logging.tail` (SPEC-0001 §8.6).
- **Uma sessão de tail atende todos os assinantes com o mesmo (perfil, projeto, filtro).** Um assinante novo recebe as entradas daquele ponto em diante.
- O Google permite **10 sessões de tail por projeto** e 60.000 entradas por minuto no tail, compartilhadas com outras ferramentas. Quando o Google recusa uma sessão nova, o painel diz isso: "Live tail limit reached in this project (10 sessions, shared with other tools)". Ele oferece tentar de novo e fechar os outros tails do Nephoscope naquele projeto.
- Payloads proto (logs de auditoria) chegam no tail sem as definições para decodificá-los. O tail mostra o tipo do payload e uma nota; a lista, recarregada, mostra o payload completo.
- Quando o Google informa entradas suprimidas (limitação de taxa), uma linha de lacuna mostra quantas foram puladas. Entradas descartadas pelo limite de buffer do próprio Nephoscope (SPEC-0001 CA-41) aparecem do mesmo jeito.
- O tail para quando o último assinante sai e pausa junto com a aba (SPEC-0001 CA-39); ao retomar, um marcador de lacuna mostra o tempo em que ficou pausado.

**Racional:** o limite de 10 sessões é fácil de atingir com algumas abas. Compartilhar tails idênticos mantém o Nephoscope com uma sessão por visão distinta.

### D-04 — Logs Explorer (M3, L3)

Uma página completa construída sobre o painel de logs, que acrescenta:
- um editor de consultas (Monaco) com gramática LQL e completação de tipos de recurso, nomes de log (da lista de logs do projeto), campos comuns, severidades e operadores;
- uma barra lateral de facetas por tipo de recurso, nome de log e severidade, contadas sobre as entradas carregadas;
- um **histograma** das entradas carregadas por tempo e severidade, com o rótulo "Based on the {n} entries loaded", já que o Logging não tem API de contagem;
- consultas salvas e recentes (SPEC-0001 CA-53) e links compartilháveis;
- download de até 10.000 entradas como JSON ou CSV;
- uma visão de **Cloud Audit Logs** com filtros predefinidos (atividade administrativa, acesso a dados, eventos de sistema, política negada) e colunas de principal, método e recurso;
- links do campo `trace` de uma entrada para o trace (D-12).

### D-05 — Log Router e armazenamento (M3, L2)

| Área | Operações |
|---|---|
| **Sinks** | Listar, criar, atualizar, excluir. Destinos: bucket do Cloud Storage, dataset do BigQuery, tópico do Pub/Sub, bucket de log, outro projeto. Filtro de inclusão e filtros de exclusão. A identidade de escrita do sink aparece com o papel de IAM de que ela precisa no destino. Os sinks `_Default` e `_Required` aparecem, e o `_Required` é somente leitura. |
| **Buckets de log** | Listar por location; criar com retenção, atualização para análise e bloqueio; atualizar a retenção; excluir e desfazer a exclusão |
| **Views de log** | Listar, criar, excluir |
| **Métricas baseadas em log** | Listar, criar (contador ou distribuição, filtro, extratores de label, extrator de valor, buckets), atualizar, excluir |

### D-06 — SQL sobre logs passa pelo BigQuery (complemento do M6)

Quando um bucket de log tem um dataset vinculado do BigQuery, o Logs Explorer oferece um modo **SQL** que roda por jobs do BigQuery com o editor da SPEC-0008. A estimativa de bytes aparece antes de rodar, e o usuário é avisado de que o BigQuery cobra. Sem dataset vinculado, o modo explica como criar um. Não existe outro caminho programático de SQL.

**Racional:** as APIs do Logging e do Observability só gerenciam os recursos de análise; não rodam consultas.

### D-07 — Abas Metrics: predefinições, alinhadas no servidor (M1)

- Cada tipo de recurso declara gráficos predefinidos (§7.4).
- **Alinhamento:**
  - o servidor consulta `listTimeSeries` com um **período de alinhamento escolhido para que cada série tenha no máximo cerca de 300 pontos**: o intervalo dividido por 300, arredondado para cima em 60 s, 5 min, 10 min, 1 h, 6 h ou 1 dia;
  - contadores são alinhados como taxas, distribuições com deltas reduzidos a percentis (50, 95, 99), e medidores com média ou máximo.
- **Exibição:** os gráficos usam Recharts (SPEC-0002 D-14), compartilham um intervalo de tempo por aba e mostram miras sincronizadas entre os gráficos.

**Racional:** o alinhamento no servidor mantém pequenos o payload e o SVG, qualquer que seja o intervalo.

### D-08 — Metrics Explorer sobre PromQL (M3, L2)

- **Linguagem:** as consultas são **PromQL**, pelo endpoint Prometheus do Cloud Monitoring (`query_range`, via `@googleapis/monitoring`). A MQL deixou de ser oferecida para gráficos novos do console em 2025-07-22.
- **Seletor de métrica:** construído a partir dos descritores de métrica e dos descritores de recurso monitorado, ele gera PromQL para métricas do Google Cloud:
  - o nome da métrica tem os pontos e a barra do domínio substituídos (por exemplo, `run.googleapis.com/request_count` vira `run_googleapis_com:request_count`);
  - o recurso é selecionado com a label `monitored_resource`.
- **Controles:** agrupar por, agregação e taxa.
- **Exibição:** os gráficos usam uPlot (SPEC-0002 D-14). Uma visão em tabela mostra o último valor de cada série.
- **Salvar:** os gráficos podem ser salvos localmente (SPEC-0001 CA-53).

### D-09 — Dashboards (M3, L2)

Os dashboards (`@google-cloud/monitoring-dashboards`) são listados e renderizados:
- **Widgets renderizados:** gráficos XY, scorecards, texto e grupos recolhíveis. A consulta de cada widget é traduzida:
  - filtros de série temporal pelo `listTimeSeries`;
  - PromQL pelo endpoint Prometheus;
  - MQL pela API de consulta de séries temporais, que ainda a aceita.
- **Demais widgets:** aparecem como a sua definição JSON.
- **Edição:** os dashboards são editados como JSON no Monaco e salvos com um update.

### D-10 — Alertas, uptime checks e canais de notificação (M3, L2)

| Área | Operações |
|---|---|
| **Políticas de alerta** | Listar e detalhar (condições, canais, documentação); habilitar, desabilitar, excluir; criar a partir de um formulário de limiar (métrica ou PromQL, comparação, limiar, duração) ou de JSON |
| **Alertas abertos** | Listados onde a API do Monitoring os expõe; senão, a página liga as políticas aos gráficos das suas condições |
| **Uptime checks** | Listar com a taxa de aprovação atual (pela métrica de uptime check); criar (HTTP, HTTPS ou TCP, para uma URL ou um recurso); excluir |
| **Canais de notificação** | Listar, criar (a partir dos descritores de canal disponíveis), enviar verificação, excluir |
| **Serviços e SLOs** | L1: lista e detalhe |

### D-11 — Error Reporting (M3, L2)

Pelo `@googleapis/clouderrorreporting` (v1beta1, incluindo as variantes por location):
- **Grupos de erro:** lista com contagem, primeira e última ocorrência, serviços e versões afetados, num intervalo de tempo.
- **Página do grupo:** um stack trace de amostra, um gráfico de ocorrências, eventos recentes, link para os logs, e um estado de resolução (aberto, reconhecido, resolvido, silenciado) que pode ser alterado.
- **Excluir todos os eventos** do projeto, com confirmação digitada.

### D-12 — Cloud Trace (M3, L2)

Pelo `@googleapis/cloudtrace` (leituras só existem na v1):
- **Lista de traces:** filtro, intervalo de tempo, ordenação por latência ou início; colunas de span raiz, latência e início; um histograma de latência dos traces listados.
- **Página do trace:** uma **cascata** de spans com barras de tempo e labels.
- **Links:** a partir de entradas de log com campo `trace` e de eventos do Error Reporting.

---

## 6. Escopo

### Dentro
D-01 a D-12.

### Fora
Os não-objetivos de §4. Monitoramento de outras nuvens, configuração do Managed Service for Prometheus, configuração do Ops Agent.

---

## 7. Requisitos

### 7.1 Painel de logs e tail ao vivo (M1)

**CA-01** — O painel de logs segue a D-01 em toda página de recurso que declara um filtro de log.

**CA-02** — O limitador da D-02 vale para toda chamada de `entries.list` feita pelo Nephoscope, por projeto, com o estado de espera visível e cancelável.

**CA-03** — O tail ao vivo segue a D-03: sessões compartilhadas, mensagem clara no limite de 10 sessões do Google e linhas de lacuna para entradas suprimidas ou descartadas.

**CA-04** — Um tail sem assinantes é fechado em até 2 s (SPEC-0001 CA-38).

### 7.2 Logs Explorer e Log Router (M3)

**CA-05** — O Logs Explorer segue a D-04: editor com completação, facetas, histograma, consultas salvas e recentes, download, visão de audit logs e links para traces.

**CA-06** — As páginas do Log Router seguem a D-05 e mostram o grant de IAM de que a identidade de escrita de um sink novo precisa.

**CA-07** — O modo SQL segue a D-06 e só aparece quando o BigQuery (SPEC-0008) está disponível.

### 7.3 Monitoring, Error Reporting e Trace (M3)

**CA-08** — O Metrics Explorer, os dashboards, os alertas, os uptime checks e os canais seguem a D-08 a D-10.

**CA-09** — Error Reporting e Trace seguem a D-11 e a D-12.

### 7.4 Predefinições de métricas (M1 em diante)

**CA-10** — As abas Metrics mostram estas predefinições. Os tipos de métrica são validados contra os descritores de métrica do projeto (T-10). Uma predefinição cuja métrica não existe no projeto fica oculta, com uma nota.

| Recurso | Tipo de recurso monitorado | Gráficos (tipo de métrica, agregação) |
|---|---|---|
| Cloud Run service ou function | `cloud_run_revision` | Requisições por segundo por `response_code_class` (`run.googleapis.com/request_count`, taxa, soma) · latência p50, p95, p99 (`run.googleapis.com/request_latencies`) · instâncias por estado (`run.googleapis.com/container/instance_count`, máximo) · utilização de CPU p50 e p99 (`run.googleapis.com/container/cpu/utilizations`) · utilização de memória p50 e p99 (`run.googleapis.com/container/memory/utilizations`) · tempo de instância faturável (`run.googleapis.com/container/billable_instance_time`, taxa) · latência de inicialização p50 e p99 (`run.googleapis.com/container/startup_latencies`) |
| Cloud Run job | `cloud_run_job` | Execuções concluídas por resultado (`run.googleapis.com/job/completed_execution_count`) · tentativas de task concluídas por resultado (`run.googleapis.com/job/completed_task_attempt_count`) · utilização de CPU e memória |
| Function gen1 | `cloud_function` | Execuções por status (`cloudfunctions.googleapis.com/function/execution_count`) · tempo de execução p50, p95, p99 (`cloudfunctions.googleapis.com/function/execution_times`) · memória (`cloudfunctions.googleapis.com/function/user_memory_bytes`) · instâncias ativas (`cloudfunctions.googleapis.com/function/active_instances`) |
| Workflow | `workflows.googleapis.com/Workflow` | Execuções concluídas por estado · tempo de execução p50, p95, p99 · passos concluídos (`workflows.googleapis.com/finished_execution_count`, `execution_times`, `completed_steps_count`; nomes implementados no M1 e ainda não conferidos contra um projeto real, T-10 com a SPEC-0001 Q-02) |
| Fila do Cloud Tasks | `cloud_tasks_queue` | Profundidade da fila (`cloudtasks.googleapis.com/queue/depth`) · tentativas por código de resposta (`cloudtasks.googleapis.com/queue/task_attempt_count`) |
| Banco do Firestore | `firestore.googleapis.com/Database` | Leituras por tipo, escritas por operação, exclusões (`firestore.googleapis.com/document/read_count`, `write_count`, `delete_count`) · requisições por método e código (`firestore.googleapis.com/api/request_count`) · snapshot listeners (`firestore.googleapis.com/network/snapshot_listeners`) · conexões ativas (`firestore.googleapis.com/network/active_connections`) |
| Tópico do Pub/Sub | `pubsub_topic` | Requisições de publicação (`pubsub.googleapis.com/topic/send_message_operation_count`) · bytes publicados (`pubsub.googleapis.com/topic/byte_cost`) |
| Assinatura do Pub/Sub | `pubsub_subscription` | Mensagens sem ack (`pubsub.googleapis.com/subscription/num_undelivered_messages`) · idade da mais antiga sem ack (`pubsub.googleapis.com/subscription/oldest_unacked_message_age`) · acks (`pubsub.googleapis.com/subscription/ack_message_count`) · enviadas ao dead letter (`pubsub.googleapis.com/subscription/dead_letter_message_count`) |
| Bucket do Cloud Storage | `gcs_bucket` | Total de bytes (`storage.googleapis.com/storage/total_bytes`) · quantidade de objetos (`storage.googleapis.com/storage/object_count`) · requisições por método (`storage.googleapis.com/api/request_count`) · saída e entrada (`storage.googleapis.com/network/sent_bytes_count`, `received_bytes_count`) |
| Instância do Compute Engine | `gce_instance` | Utilização de CPU (`compute.googleapis.com/instance/cpu/utilization`) · rede de entrada e saída (`compute.googleapis.com/instance/network/received_bytes_count`, `sent_bytes_count`) · bytes lidos e escritos em disco (`compute.googleapis.com/instance/disk/read_bytes_count`, `write_bytes_count`) |
| Instância do Cloud SQL | `cloudsql_database` | Utilização de CPU, memória e disco (`cloudsql.googleapis.com/database/cpu/utilization`, `memory/utilization`, `disk/utilization`) · conexões (métrica específica do motor) |

As demais specs de produto acrescentam as suas predefinições a esta tabela quando chegam ao M3 ou depois.

---

## 8. Requisitos não-funcionais

| Id | Requisito |
|---|---|
| **NFR-01** | A taxa de `entries.list` do Nephoscope por projeto nunca passa de 40 por minuto (D-02). |
| **NFR-02** | Uma entrada do tail ao vivo chega ao navegador em até 3 s depois que o Google a entrega. |
| **NFR-03** | Uma aba Metrics com 7 gráficos predefinidos sobre 7 dias carrega em menos de 2 s depois que a API responde, com no máximo cerca de 300 pontos por série. |
| **NFR-04** | O painel de logs rola 50.000 entradas carregadas a 60 fps. |

---

## 9. Cenários de teste

| Id | Cenário | Esperado |
|---|---|---|
| **T-01** | Abrir a aba Logs de um Cloud Run service | Só as entradas daquele service; resumos HTTP |
| **T-02** | Clicar em "Show matching" sobre `httpRequest.status` 500 | O filtro ganha `httpRequest.status=500`; os resultados se atualizam |
| **T-03** | Abrir 8 abas nos logs do mesmo service com tail ao vivo | Uma sessão de tail no servidor; todas as abas recebem as entradas |
| **T-04** | Abrir tails ao vivo em 11 filtros diferentes num projeto | O décimo primeiro mostra a mensagem de limite; fechar um permite tentar de novo |
| **T-05** | Simular 100 chamadas de `entries.list` em um minuto | No máximo 40 chegam ao Google; o resto espera com contagem regressiva visível |
| **T-06** | Forçar `RESOURCE_EXHAUSTED` no Logging | Backoff para aquele projeto; mensagem mostrada; outros projetos não são afetados |
| **T-07** | Criar um sink para um tópico do Pub/Sub | Sink criado; identidade de escrita e o papel necessário mostrados |
| **T-08** | Criar uma métrica baseada em log do tipo contador e vê-la no Metrics Explorer | A métrica aparece com dados depois que entradas casam |
| **T-09** | Aba Metrics sobre 30 dias | No máximo cerca de 300 pontos por série; percentis mostrados para latências |
| **T-10** | Validar todo tipo de métrica predefinido da CA-10 contra os descritores de métrica do projeto sandbox | Toda predefinição resolve, ou fica marcada como oculta com nota; a tabela é corrigida nesta spec |
| **T-11** | Consulta PromQL `sum by (response_code_class) (rate(run_googleapis_com:request_count{monitored_resource="cloud_run_revision"}[5m]))` | Séries renderizadas com uPlot |
| **T-12** | Abrir um dashboard com XY, scorecard, texto e um widget não suportado | Os suportados renderizados; o não suportado mostrado como JSON |
| **T-13** | Criar uma política de alerta de limiar pelo formulário, desabilitá-la, excluí-la | Cada passo refletido; a exclusão exige o nome digitado |
| **T-14** | Marcar um grupo de erro como resolvido | Estado salvo; grupo mostrado como resolvido |
| **T-15** | Abrir um trace a partir do campo `trace` de uma entrada de log | Cascata do trace |
| **T-16** | Entrada de log contendo `<script>` no payload | Mostrada como texto (SPEC-0001 CA-72) |

---

## 10. Plano de entrega

| Marco | Entregável | Depende de |
|---|---|---|
| **M1** | Painel de logs, limitador, tail ao vivo compartilhado, aba Metrics com as predefinições do M1 | SPEC-0001 M0 |
| **M3** | Logs Explorer, Log Router, buckets, views, métricas baseadas em log, Metrics Explorer, dashboards, alertas, uptime checks, canais, Error Reporting, Trace | M1 |
| **M6** | SQL sobre logs pelo BigQuery (D-06) | SPEC-0008 BigQuery |

---

## 11. Riscos e questões em aberto

### Riscos

| Id | Risco | Mitigação |
|---|---|---|
| **R-01** | As cotas do Logging são compartilhadas com outras ferramentas, então o Nephoscope ainda pode ser recusado | A D-02 e a D-03 mantêm o Nephoscope dentro da sua parte; mensagens claras quando o Google recusa |
| **R-02** | Nomes de métrica predefinidos mudam com a versão do produto | O T-10 os valida contra descritores reais; os que faltam ficam ocultos em vez de falhar |
| **R-03** | Uma opção futura: muitas abas abrindo cada uma o seu socket | O compartilhamento de tail no servidor já limita as sessões; um SharedWorker segurando um socket para todas as abas pode ser acrescentado depois, sem mudar o protocolo |

### Questões em aberto

Nenhuma.

---

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-09-28 | 0.1 | | Versão inicial, exportada do plano aprovado e da verificação das APIs (cotas do Logging, ausência de API de SQL, PromQL no lugar da MQL): D-01 a D-12, CA-01 a CA-10, NFR-01 a NFR-04, T-01 a T-16, R-01 a R-03 |
| 2026-09-28 | 0.2 | | **Tradução para o português** (SPEC-0001 D-26) |
| 2026-09-28 | 0.3 | | **Implementação do M1.**<br>• D-01: "Open in Google Cloud console" no lugar de "Open in Logs Explorer" até o M3.<br>• D-02: a espera de cota é devolvida ao cliente (`RESOURCE_EXHAUSTED` com `retryAfterSeconds`), que conta o tempo e repete; listas pelo `entries.list` REST, tail pelo `@google-cloud/logging-api`.<br>• D-03: payloads proto não são decodificados no tail.<br>• CA-10: nomes das métricas do Workflows implementados, pendentes de conferência com a Q-02. |
| 2026-09-28 | 0.4 | | CA-10: predefinição `firestore-database` implementada (a linha do Firestore), filtrada pelo rótulo `database_id` do recurso monitorado; aba Usage da SPEC-0004 D-17. Os nomes das métricas seguem pendentes de conferência com a SPEC-0001 Q-02. |
| 2026-09-28 | 0.5 | | CA-10: predefinições `pubsub-topic` (rótulo `topic_id`) e `pubsub-subscription` (rótulo `subscription_id`) implementadas, com as métricas das linhas do Pub/Sub; nomes pendentes de conferência com a SPEC-0001 Q-02. |

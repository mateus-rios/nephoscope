# SPEC-0008 — Dados e computação

| | |
|---|---|
| **Status** | Rascunho |
| **Autor(es)** | |
| **Revisores** | |
| **Sistemas** | `apps/api/src/products/{bigquery,cloudsql,memorystore,compute,vpc,loadbalancing,dns,gke}` · os `apps/web/src/products/*` correspondentes |
| **SDKs** | `@google-cloud/bigquery` (e `@google-cloud/bigquery-data-transfer` para consultas agendadas) · `@google-cloud/sql` · `@google-cloud/redis`, `@google-cloud/redis-cluster`, `@google-cloud/memorystore` (Valkey), `@google-cloud/memcache` · `@google-cloud/compute` · `@google-cloud/vpc-access` · `@googleapis/dns` · `@google-cloud/container` |
| **Spec relacionada** | [SPEC-0001](./0001-platform.md) (famílias de operação D-09, confirmações D-13, fan-out D-17) · [SPEC-0005](./0005-observability.md) (predefinições de métricas, SQL sobre logs D-06) · [SPEC-0007](./0007-security-delivery.md) (Cloud Armor, certificados) · [SPEC-0003](./0003-serverless.md) (NEGs serverless apontam para Cloud Run services) |
| **Última atualização** | 2026-09-28 |
| **Versão** | 0.2 |

---

## 1. Resumo

O M6 entrega:
- **BigQuery** no L3: um explorador, um editor SQL que **estima o custo antes de cada execução**, uma grade de resultados que preserva os tipos, e o histórico de jobs;
- **Cloud SQL** no L2;
- **Memorystore** do L1 ao L2;
- **Compute Engine** no L2;
- **rede VPC** no L2, incluindo regras de firewall;
- um grafo somente leitura da **topologia de balanceamento de carga** (L1);
- **Cloud DNS** no L2;
- clusters e node pools do **GKE** no L2.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Dry run** | Uma consulta do BigQuery validada e precificada sem rodar. Devolve os bytes que processaria. |
| **Maximum bytes billed** | Um teto por consulta; o BigQuery faz a consulta falhar em vez de cobrar mais. |
| **Job** | Uma unidade de trabalho do BigQuery (consulta, carga, extração, cópia). |
| **Activation policy** | Se uma instância do Cloud SQL roda (`ALWAYS`) ou fica parada (`NEVER`). |
| **Lista agregada** | Uma lista do Compute Engine através de todas as zonas ou regiões, numa chamada. |
| **NEG** | Network endpoint group. Um NEG serverless aponta para um Cloud Run service, uma function ou um app do App Engine. |
| **Change set** | Uma transação do Cloud DNS com adições e remoções de registros. |

---

## 3. Problema

Consultas do BigQuery podem custar dinheiro de verdade, e o custo só é conhecido se alguém perguntar. Recursos de computação e de rede ficam espalhados por zonas e regiões e ligados de formas que o console do Google mostra em páginas separadas. A cadeia do balanceador de carga em especial (regra de encaminhamento, proxy, URL map, backend, endpoints, políticas) é difícil de visualizar. Cloud SQL e GKE são sobretudo ações de ciclo de vida que deveriam estar a um clique.

---

## 4. Objetivos

1. Nunca rodar uma consulta do BigQuery sem ver o que ela vai processar, e limitar o que ela pode cobrar.
2. Manter exatos os valores do BigQuery nos resultados (inteiros de 64 bits, numéricos, timestamps, bytes).
3. Uma lista por tipo de recurso através de zonas e regiões, com as ações de ciclo de vida comuns.
4. Mostrar como um balanceador de carga está ligado, de ponta a ponta, incluindo as suas políticas do Cloud Armor.

### Não-objetivos

- **Um cliente SQL para os bancos do Cloud SQL** (conectar ao banco em si). O Nephoscope gerencia instâncias, não os dados delas.
- **Workloads do Kubernetes.** O GKE é coberto apenas no nível de cluster e node pool.
- **Shells de VM** (SSH, entrada no console serial) (não-objetivos da SPEC-0001).
- **Treino de modelos do BigQuery ML, BI Engine, reservas e Data Canvas.** A SPEC-0009 pode acrescentar alguns no L1.

---

## 5. Decisões tomadas

### D-01 — Explorador do BigQuery

- **Projetos:** o projeto ativo, mais projetos fixados (por exemplo `bigquery-public-data`).
- **Árvore:** datasets e, dentro deles, tabelas, views, views materializadas, tabelas externas, rotinas e modelos.
- **Detalhes do dataset:** location, expiração padrão, labels, descrição.
- **Página da tabela:**
  - **schema** como árvore, incluindo campos aninhados e repetidos e policy tags;
  - **detalhes:** linhas, tamanho lógico e físico, particionamento, clustering, expiração, horários de criação e modificação;
  - **prévia** pelo `tabledata.list`, que não cobra consulta, paginada.
- **Views:** mostram o seu SQL e podem ser editadas, o que atualiza a view.
- **Gestão (L2):** criar datasets (location) e tabelas (um editor de schema com visão JSON); copiar tabelas; atualizar expiração, labels e descrição.
- **Exclusões (digitadas):** excluir um dataset não vazio também exige a quantidade de tabelas digitada.
- **Consultas agendadas** (Data Transfer): L1, com executar agora.

### D-02 — Toda consulta é precificada antes de rodar

- O editor SQL (Monaco, gramática GoogleSQL, completação a partir dos datasets, tabelas e colunas do explorador) roda um **dry run** 800 ms depois da última edição. Ele mostra:
  - erros de sintaxe e semânticos como marcadores;
  - os **bytes que a consulta vai processar**, no botão Run ("Run · 1.23 GiB").
- Toda consulta roda com **maximum bytes billed**:
  - o teto padrão é **10 GiB**, definido nas preferências;
  - uma consulta cujo dry run passa do teto pede que o usuário eleve o teto para aquela execução, dizendo o valor.
- Parâmetros de consulta nomeados têm um editor. A tabela de destino e o modo de escrita são opcionais.

**Racional:** o BigQuery cobra por bytes processados, e uma consulta digitada errado numa tabela grande pode custar caro. Um dry run é grátis, e o teto transforma uma surpresa num erro.

### D-03 — Os resultados mantêm os tipos do BigQuery

- `INT64`, `NUMERIC` e `BIGNUMERIC` chegam como strings (sem arredondamento).
- `TIMESTAMP`, `DATETIME`, `DATE` e `TIME` chegam como strings ISO; `BYTES` como base64; `GEOGRAPHY` como WKT; `JSON` como árvore JSON.
- Valores `STRUCT` e `ARRAY` são expansíveis.
- Os resultados são paginados com `getQueryResults` numa grade virtualizada.
- **Detalhes da execução:** bytes processados e cobrados, tempo de slot, acerto de cache e um resumo dos estágios.
- **Download:** CSV ou JSON, em streaming, até 100.000 linhas. Acima disso, um **job de export** para o Cloud Storage.

### D-04 — Jobs são operações

Um job de consulta é acompanhado pelo rastreador de operações (SPEC-0001 D-09, família de jobs do BigQuery), então uma consulta longa sobrevive ao fechamento da aba e pode ser cancelada pela bandeja.

O histórico de jobs (os jobs do projeto, filtráveis por principal e estado) abre o SQL, os detalhes e os resultados de qualquer job enquanto estiverem em cache. Consultas salvas e o histórico de consultas são locais (SPEC-0001 CA-53).

### D-05 — Cloud SQL no L2

- **Instâncias:** motor e versão, tier, location, estado, IPs público e privado, nome de conexão, alta disponibilidade, armazenamento, configuração de backup, janela de manutenção.
- **Ações da instância:**
  - iniciar e parar (activation policy), reiniciar;
  - failover (alta disponibilidade);
  - exportar para o Cloud Storage e importar dele (SQL ou CSV);
  - excluir (digitado; bloqueado enquanto a proteção contra exclusão estiver ligada).
- **Abas:**

| Aba | Conteúdo |
|---|---|
| Databases | Listar, criar, excluir (digitado) |
| Users | Listar, criar, excluir (digitado), trocar senha. Uma senha nunca é mostrada depois de definida. |
| Backups | Listar, criar sob demanda, restaurar nesta ou em outra instância (digitado, dizendo o que é sobrescrito), excluir |
| Connections | Redes autorizadas (edição), modo SSL |
| Flags | Ver e editar, dizendo quando uma mudança reinicia a instância |
| Replicas | Listar; promover (L1) |
| Maintenance | Janela e períodos de bloqueio |
| Operations | As operações da instância |
| Metrics e Logs | Predefinições da SPEC-0005; logs filtrados por `resource.type="cloudsql_database"` |

- As operações do Cloud SQL têm tipo próprio e são acompanhadas pelo seu adaptador (SPEC-0001 D-09).

### D-06 — Memorystore

| Produto | Nível | Operações |
|---|---|---|
| Redis | L2 | Lista e detalhe (tier, versão, memória, host e porta, AUTH, TLS, réplicas de leitura, persistência); criar; escalar memória; failover (tier standard); exportar e importar arquivos RDB do Cloud Storage; excluir (digitado) |
| Redis Cluster | L1 | Lista e detalhe |
| Valkey | L1 | Lista e detalhe |
| Memcached | L1 | Lista e detalhe |

### D-07 — Compute Engine no L2

- **Instâncias** (lista agregada sobre todas as zonas):
  - colunas: nome, zona, estado, tipo de máquina, IPs interno e externo, network tags, labels, criação, proteção contra exclusão;
  - ações: iniciar, parar, suspender, retomar, resetar, excluir (digitado; a proteção contra exclusão é respeitada), trocar o tipo de máquina (quando parada), labels, tags, metadados;
  - **saída da porta serial**, acompanhada ao vivo no canal `compute.serial`, consultando a partir do último offset a cada 2 s;
  - captura de tela quando o dispositivo de display estiver habilitado (L1).
- **Discos:** lista agregada, snapshot de um disco.
- **Snapshots:** listar, excluir.
- **Imagens:** listar imagens customizadas, criar a partir de um disco, excluir.
- **Templates de instância:** listar, ver, excluir.
- **Grupos gerenciados de instâncias:** lista agregada, instâncias, **redimensionar**; rolling updates no L1.
- As operações do Compute (zonais, regionais, globais) usam o seu adaptador (SPEC-0001 D-09).

### D-08 — Rede VPC

| Área | Nível | Operações |
|---|---|---|
| Redes | L2 | Listar (modo de sub-rede, MTU, modo de roteamento, peerings), criar, excluir |
| Sub-redes | L2 | Lista agregada (faixas, faixas secundárias, Private Google Access, flow logs), criar, editar, excluir |
| **Regras de firewall** | L2 | Listar (prioridade, direção, ação, alvos, origens ou destinos, protocolos e portas, logging, estado), criar, editar, desabilitar, excluir (digitado); regras de firewall efetivas de uma instância (L1) |
| Políticas de firewall | L1 | Listar e ver |
| Rotas | L2 | Listar; criar e excluir rotas estáticas |
| Cloud Router e Cloud NAT | L1 | Listar e ver |
| Endereços IP externos | L2 | Listar; reservar, liberar (digitado) |
| VPC peering, Private Service Connect, conectores de Serverless VPC Access | L1 | Listar e ver |

### D-09 — Topologia de balanceamento de carga (L1)

- **O grafo.** Para cada balanceador de carga, o Nephoscope desenha a cadeia, da esquerda para a direita, com o elkjs (o mesmo motor de layout do grafo do Workflows, SPEC-0003 D-10):
  - regra de encaminhamento (IP, porta, esquema);
  - proxy de destino;
  - URL map (regras de host e path matchers);
  - backend services e backend buckets;
  - backends: grupos de instâncias, NEGs, buckets.
- **Anotações:** health checks, certificados SSL (SPEC-0007 D-10) e **políticas do Cloud Armor anexadas** (SPEC-0007 D-09).
- **Links:** todo nó abre o seu recurso. Um NEG serverless leva ao seu Cloud Run service, function ou app do App Engine.

### D-10 — Cloud DNS no L2

- **Zonas gerenciadas:** listar zonas públicas e privadas (nome DNS, estado do DNSSEC, redes de visibilidade); criar; excluir (digitado; precisa estar vazia).
- **Conjuntos de registros:** listar; adicionar, editar e excluir por **change sets**, mostrando a mudança antes de aplicar. Tipos: A, AAAA, CNAME, MX, TXT, SRV, CAA, NS, PTR. SOA é somente leitura.
- **L1:** políticas de roteamento (geolocalização, com peso), response policies, políticas de servidor DNS.

### D-11 — GKE no L2 (sem workloads)

- **Clusters:** listar entre locations com `locations/-`; detalhe com versão, modo (Autopilot ou Standard), canal de release, rede, endpoint, política de manutenção e upgrades disponíveis.
- **Node pools:** listar; **redimensionar**; configurações de autoscaling; versão (L1).
- **Operações:** as operações do cluster, acompanhadas pelo seu adaptador (SPEC-0001 D-09).
- Workloads, services e demais objetos do Kubernetes ficam fora do escopo (§4).

---

## 6. Escopo

### Dentro
D-01 a D-11.

### Fora
Os não-objetivos de §4.

---

## 7. Requisitos

### 7.1 BigQuery

**CA-01** — O explorador segue a D-01, incluindo a prévia pelo `tabledata.list`.

**CA-02** — O editor segue a D-02: dry run com debounce, com marcadores e os bytes no botão Run; maximum bytes billed em toda execução, com elevação explícita acima do teto.

**CA-03** — Os resultados seguem a D-03, com tipos exatos e o job de export para resultados grandes.

**CA-04** — Os jobs de consulta seguem a D-04: acompanhados, canceláveis, com histórico, consultas salvas e histórico de consultas.

### 7.2 Cloud SQL e Memorystore

**CA-05** — O Cloud SQL segue a D-05. Senhas são somente escrita.

**CA-06** — O Memorystore segue a D-06.

### 7.3 Computação, rede, DNS e GKE

**CA-07** — O Compute Engine segue a D-07, incluindo a saída serial ao vivo.

**CA-08** — A VPC segue a D-08, incluindo a edição de regras de firewall.

**CA-09** — A topologia de balanceamento de carga segue a D-09, com os anexos do Cloud Armor à mostra.

**CA-10** — O Cloud DNS segue a D-10, com os change sets mostrados antes de aplicar.

**CA-11** — O GKE segue a D-11.

---

## 8. Requisitos não-funcionais

| Id | Requisito |
|---|---|
| **NFR-01** | O resultado do dry run aparece em até 1,5 s depois que o usuário para de digitar, numa conexão normal. |
| **NFR-02** | A grade de resultados rola 100.000 linhas carregadas a 60 fps. |
| **NFR-03** | Um grafo de balanceador com 50 nós é diagramado em menos de 500 ms. |
| **NFR-04** | A lista de instâncias de um projeto com 1.000 VMs em 20 zonas renderiza em menos de 2 s depois que a API responde. |

---

## 9. Cenários de teste

Todos rodam contra o projeto sandbox da SPEC-0001 Q-02.

| Id | Cenário | Esperado |
|---|---|---|
| **T-01** | Digitar uma consulta em `bigquery-public-data.samples.shakespeare` | Bytes mostrados no Run antes de rodar; marcadores num erro de digitação |
| **T-02** | Rodar uma consulta cujo dry run passa do teto de 10 GiB | Pede para elevar o teto nesta execução, com o valor |
| **T-03** | Consultar `SELECT 9007199254740993 AS big, NUMERIC '1.1' AS n, b'abc' AS b` | Valores mostrados exatos: `9007199254740993`, `1.1`, bytes em base64 |
| **T-04** | Iniciar uma consulta longa, fechar a aba, reabrir | Job na bandeja; cancelável; resultados disponíveis quando terminar |
| **T-05** | Pré-visualizar uma tabela | Linhas mostradas; nenhum job de consulta criado |
| **T-06** | Parar e iniciar uma instância do Cloud SQL; criar um usuário; trocar a senha | Mudanças de estado acompanhadas; a senha nunca aparece |
| **T-07** | Restaurar um backup do Cloud SQL em outra instância | Confirmação digitada dizendo o que é sobrescrito; operação acompanhada |
| **T-08** | Parar uma VM; trocar o tipo de máquina; iniciá-la | Cada passo acompanhado como operação zonal |
| **T-09** | Acompanhar a saída da porta serial de uma VM iniciando | Saída nova aparece a cada poucos segundos |
| **T-10** | Criar uma regra de firewall permitindo TCP 8080 de uma faixa; desabilitá-la; excluí-la | Cada mudança refletida; exclusão digitada |
| **T-11** | Abrir a topologia de um balanceador HTTPS com um NEG serverless e uma política do Cloud Armor | Cadeia completa desenhada; o NEG leva ao Cloud Run service; política mostrada |
| **T-12** | Adicionar um registro TXT por um change set | Mudança mostrada antes de aplicar; registro listado depois |
| **T-13** | Redimensionar um node pool do GKE | Operação acompanhada; tamanho novo mostrado |
| **T-14** | Com um perfil somente leitura, tentar todas as mutações acima pela API | Todas rejeitadas com `READ_ONLY`; dry runs continuam funcionando |

---

## 10. Plano de entrega

| Passo | Entregável | Depende de |
|---|---|---|
| M6.1 | BigQuery | M0 |
| M6.2 | Cloud SQL, Memorystore | M0 |
| M6.3 | Compute Engine, VPC | M0 |
| M6.4 | Topologia de balanceamento de carga, Cloud DNS | M6.3; SPEC-0007 M5.3 para os links do Armor |
| M6.5 | GKE | M0 |
| M6.6 | SQL sobre logs (SPEC-0005 D-06) | M6.1 |

---

## 11. Riscos e questões em aberto

### Riscos

| Id | Risco | Mitigação |
|---|---|---|
| **R-01** | Consultas caras no BigQuery | Dry run e maximum bytes billed em toda execução (D-02) |
| **R-02** | Ações de ciclo de vida em bancos e VMs de produção | Confirmações digitadas; proteção contra exclusão respeitada; perfis somente leitura |
| **R-03** | Várias famílias de operação (Compute, Cloud SQL, GKE, jobs do BigQuery) | Um adaptador para cada (SPEC-0001 D-09), testado por família |

### Questões em aberto

Nenhuma.

---

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-09-28 | 0.1 | | Versão inicial, exportada do plano aprovado: D-01 a D-11, CA-01 a CA-11, NFR-01 a NFR-04, T-01 a T-14, R-01 a R-03 |
| 2026-09-28 | 0.2 | | **Tradução para o português** (SPEC-0001 D-26) |

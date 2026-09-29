# SPEC-0009 — Cauda longa

| | |
|---|---|
| **Status** | Rascunho |
| **Autor(es)** | |
| **Revisores** | |
| **Sistemas** | `apps/api/src/products/{rawapi,billing,quotas,recommender,orgpolicy,...}` · os `apps/web/src/products/*` correspondentes |
| **SDKs** | `@googleapis/discovery` e `google-auth-library` (console de API bruto) · `@google-cloud/billing` · `@google-cloud/billing-budgets` · `@google-cloud/cloudquotas` · `@google-cloud/recommender` · `@google-cloud/org-policy` · `@google-cloud/security-center` · `@google-cloud/iap` · `@google-cloud/spanner` · `@google-cloud/bigtable` · `@google-cloud/alloydb` · `@google-cloud/batch` · `@google-cloud/aiplatform` · `@google-cloud/dataflow` · `@google-cloud/dataproc` · `@google-cloud/orchestration-airflow` · `@google-cloud/storage-transfer` · `@google-cloud/network-management` · `@google-cloud/run` (worker pools, instâncias) |
| **Spec relacionada** | [SPEC-0001](./0001-platform.md) (segurança D-05, somente leitura D-12, confirmações D-13, auditoria D-14, kit de recursos) · [SPEC-0008](./0008-data-compute.md) (BigQuery, para dados de custo) · [SPEC-0003](./0003-serverless.md) (Cloud Run) |
| **Última atualização** | 2026-09-28 |
| **Versão** | 0.2 |

---

## 1. Resumo

O M7 fecha o "e assim por diante" do pedido.
- **O coringa:** um **console de API bruto**, que chama qualquer método de API do Google Cloud com o perfil ativo. Tudo que não tiver página dedicada continua alcançável pelo Nephoscope.
- **Visões de plataforma:** faturamento, cotas, recomendações e políticas da organização.
- **Produtos L1:** um conjunto amplo, construído quase todo com o kit de recursos (SPEC-0001 D-16).

O M7 também traz a auditoria de design do app inteiro (SPEC-0002 §10) e a **sincronização final das specs**.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Documento de discovery** | A descrição legível por máquina de uma API REST do Google: recursos, métodos, parâmetros e schemas. |
| **Console de API bruto** | A página do Nephoscope que monta e envia uma requisição para qualquer método descrito por um documento de discovery. |
| **Export de faturamento** | Um dataset do BigQuery para onde o Cloud Billing exporta os dados de custo. A única fonte programática de custos. |
| **Quota info** | A descrição que o Cloud Quotas dá de uma cota e dos seus limites atuais. |
| **Política efetiva** | A política da organização que vale para um projeto depois da herança. |

---

## 3. Problema

Nenhum console consegue dar uma página dedicada a cada produto do Google Cloud, e a falta aparece justamente quando se precisa de um produto ou método incomum. Algumas perguntas transversais ("quanto este projeto custa?", "qual cota está me bloqueando?", "qual política da organização nega isto?") também são respondidas em lugares que a maioria das ferramentas ignora.

---

## 4. Objetivos

1. Qualquer método de API do Google Cloud é alcançável pelo Nephoscope com o perfil ativo, com as mesmas regras de segurança do resto do app.
2. Responder às perguntas transversais comuns: custo, cotas, recomendações, políticas da organização.
3. Navegar pelos produtos restantes no L1 sem trabalho sob medida.

### Não-objetivos

- **Dados de custo sem export de faturamento.** As APIs de faturamento não fornecem custos; o Nephoscope diz isso.
- **Recursos avançados dos produtos L1** (por exemplo SQL do Spanner ou treino no Vertex AI). Eles podem subir para L2 ou L3 em revisões futuras da spec.

---

## 5. Decisões tomadas

### D-01 — Console de API bruto

- **Seletor de API e de método:** o diretório de APIs do Google, pelo Discovery Service, pesquisável, com uma árvore de recursos e métodos montada a partir do documento de discovery de cada API. Os documentos são buscados uma vez e guardados em cache durante a sessão.
- **Parâmetros:** um formulário gerado a partir dos parâmetros de caminho e de query do método, com descrições e marcação de obrigatórios.
- **Corpo da requisição:** um editor Monaco validado contra um **JSON Schema gerado a partir dos schemas do discovery**.
- **Envio:** a requisição passa pelo servidor com as credenciais do perfil ativo.
  - Só hosts `https://*.googleapis.com` são permitidos (SPEC-0001 D-05).
  - `POST`, `PUT`, `PATCH` e `DELETE` contam como mutações: bloqueados em modo somente leitura e auditados (SPEC-0001 D-12, D-14).
  - `DELETE` exige digitar o último segmento do caminho (SPEC-0001 D-13).
- **Resposta:** status, cabeçalhos e o corpo como árvore JSON, renderizados como texto (SPEC-0001 D-22).
- **Histórico e cópia:** as 50 últimas requisições ficam guardadas (sem os corpos de APIs ligadas a segredos). "Copy as curl" gera um comando que obtém o token com `gcloud auth print-access-token`.

**Racional:** os documentos de discovery descrevem toda API pública do Google, então uma única página genérica cobre tudo o que o Nephoscope não tem página dedicada, com as mesmas travas.

### D-02 — Faturamento (L1, com visão de custos opcional)

- **As informações de faturamento do projeto:** conta de faturamento vinculada e se o faturamento está habilitado.
- **A conta de faturamento e os seus orçamentos**, quando o perfil consegue lê-los: valores, limiares, base de gasto.
- **Custos** não estão disponíveis pelas APIs de faturamento.
  - Quando o usuário configura um **dataset de export de faturamento** nas preferências, uma página Costs roda consultas prontas pelo BigQuery (SPEC-0008, com o mesmo dry run e teto de bytes): custo por serviço, por SKU e por dia no projeto.
  - Sem essa configuração, a página explica como configurar o export.

### D-03 — Cotas (L1)

- As quota infos por serviço (Cloud Quotas), com os limites atuais e as dimensões (por exemplo, região).
- Uso e percentual onde o Cloud Monitoring os informa, destacados acima de 80%.
- As quota preferences pendentes (pedidos de aumento) são listadas.

### D-04 — Recomendações (L1)

Recomendações e insights do projeto, dos recomendadores que se aplicam aos seus produtos (IAM, dimensionamento do Compute, recursos ociosos, Cloud Run e outros): lista e detalhe, com o impacto estimado.

### D-05 — Políticas da organização (L1)

As políticas da organização **efetivas** do projeto, e as definidas no próprio projeto. As restrições que costumam explicar erros (compartilhamento restrito a domínio, locations permitidas, prevenção de acesso público, criação de chave de conta de serviço) aparecem primeiro.

**Racional:** negações por política da organização aparecem como erros confusos em outros produtos (por exemplo, ao tornar público um Cloud Run service, SPEC-0003 D-04). Mostrar a política efetiva explica esses erros.

### D-06 — Produtos L1

Cada um é um descritor do kit de recursos (lista, detalhe, JSON bruto, links para logs e métricas):

| Produto | Recursos |
|---|---|
| Cloud Run worker pools e instâncias | Worker pools; instâncias |
| Spanner | Instâncias, bancos (DDL mostrada), backups |
| Bigtable | Instâncias, clusters, tabelas (column families), app profiles, backups |
| AlloyDB | Clusters, instâncias, backups |
| Batch | Jobs, task groups, tasks |
| Vertex AI | Modelos, endpoints e modelos implantados, pipeline jobs, custom jobs |
| Dataflow | Jobs (estado, tipo, link para métricas) |
| Dataproc | Clusters, jobs, batches |
| Cloud Composer | Ambientes |
| Storage Transfer Service | Jobs de transferência e operações |
| Security Command Center | Achados do projeto, onde o perfil conseguir lê-los |
| Identity-Aware Proxy | Configurações de IAP dos recursos do projeto |
| Network Intelligence (testes de conectividade) | Testes de conectividade e os seus resultados |
| Upgrade e detach de Cloud Run functions gen1 | Ver SPEC-0003 D-18 |

### D-07 — Sincronização final das specs

Antes de o M7 fechar, toda spec desta pasta é conciliada com a implementação:
- decisões e requisitos batem com o código;
- toda `Q-xx` está resolvida ou explicitamente levada adiante;
- todo status está atualizado;
- cada histórico de revisões registra a sincronização.

É o "exportar todas as decisões e requisitos para as specs" que o usuário pediu para o final.

---

## 6. Escopo

### Dentro
D-01 a D-07.

### Fora
Os não-objetivos de §4.

---

## 7. Requisitos

**CA-01** — O console de API bruto segue a D-01, incluindo a restrição de host, o bloqueio em somente leitura, a auditoria e a confirmação digitada para `DELETE`.

**CA-02** — O faturamento segue a D-02. A página Costs só aparece quando há um dataset de export de faturamento configurado, e usa as travas do BigQuery.

**CA-03** — Cotas, recomendações e políticas da organização seguem a D-03 a D-05.

**CA-04** — Cada produto da D-06 tem páginas de lista, detalhe e JSON bruto pelo kit de recursos, com links para logs e métricas onde existirem.

**CA-05** — A sincronização final das specs da D-07 fica registrada no histórico de revisões de cada spec.

---

## 8. Requisitos não-funcionais

| Id | Requisito |
|---|---|
| **NFR-01** | O seletor de API abre a árvore de métodos de qualquer API em menos de 2 s, na primeira vez, numa conexão normal; as aberturas seguintes são instantâneas. |
| **NFR-02** | Os produtos L1 não acrescentam custo mensurável à inicialização (módulos lazy, SPEC-0001 D-23). |

---

## 9. Cenários de teste

| Id | Cenário | Esperado |
|---|---|---|
| **T-01** | No console de API bruto, chamar `serviceusage.services.list` do projeto | Resposta mostrada; requisição no histórico |
| **T-02** | Enviar um corpo que viola o schema do método | O editor marca o erro antes do envio |
| **T-03** | Tentar enviar uma requisição para um host que não é do Google pela API do servidor | Recusada |
| **T-04** | Com um perfil somente leitura, enviar um método `POST` | Rejeitado com `READ_ONLY` |
| **T-05** | Enviar um método `DELETE` | Confirmação digitada do último segmento do caminho; entrada de auditoria |
| **T-06** | Configurar um dataset de export de faturamento e abrir Costs | Custos por serviço e por dia; dry run mostrado antes de rodar |
| **T-07** | Abrir Quotas do Compute Engine numa região | Limites listados; uso onde houver |
| **T-08** | Abrir as políticas da organização efetivas de um projeto com compartilhamento restrito a domínio | A restrição aparece primeiro |
| **T-09** | Abrir cada produto L1 num projeto que o usa | Lista, detalhe e JSON bruto funcionam |

---

## 10. Plano de entrega

| Passo | Entregável | Depende de |
|---|---|---|
| M7.1 | Console de API bruto | M0 |
| M7.2 | Faturamento, custos, cotas, recomendações, políticas da organização | M0; SPEC-0008 para custos |
| M7.3 | Produtos L1 | M0 |
| M7.4 | Auditoria de design do app inteiro (SPEC-0002), passada de desempenho e de acessibilidade | M1 a M6 |
| M7.5 | Sincronização final das specs (D-07) | Tudo |

---

## 11. Riscos e questões em aberto

### Riscos

| Id | Risco | Mitigação |
|---|---|---|
| **R-01** | O console de API bruto contorna as travas de cada produto | As mesmas regras de somente leitura, confirmação, auditoria e host do resto do app (D-01) |
| **R-02** | Os documentos de discovery de algumas APIs são grandes | Buscados uma vez por sessão, interpretados sob demanda por recurso |

### Questões em aberto

Nenhuma.

---

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-09-28 | 0.1 | | Versão inicial, exportada do plano aprovado e do escopo "e assim por diante": D-01 a D-07, CA-01 a CA-05, NFR-01 e NFR-02, T-01 a T-09, R-01 e R-02 |
| 2026-09-28 | 0.2 | | **Tradução para o português** (SPEC-0001 D-26) |

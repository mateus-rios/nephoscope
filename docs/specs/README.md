# Specs do Nephoscope

O Nephoscope é um console web self-hosted para o Google Cloud. Você monta uma chave `GOOGLE_APPLICATION_CREDENTIALS` (e, se quiser, outras chaves como perfis), abre `http://localhost:8080` e opera seus projetos como faria em console.cloud.google.com.

As specs desta pasta são a **fonte da verdade** do comportamento do Nephoscope.

## Regras

1. **A spec é a fonte da verdade.** Toda mudança de comportamento atualiza a spec afetada e o seu histórico de revisões na mesma mudança.
2. **Itens em aberto são perguntados, não decididos.** Tudo que estiver marcado `Q-xx` (ou `T-Qxx` para questões de teste) está em aberto: pergunte ao dono, não decida sozinho. Quando um item em aberto é resolvido, ele vira uma decisão `D-xx` que cita a questão que resolve, e a questão sai da lista de abertas.
3. **Decisões guardam o racional.** Uma `D-xx` registra o que foi decidido e por quê, para que o motivo sobreviva quando o código mudar.
4. **IDs são por spec.** Para citar um item de outra spec, prefixe o número da spec: `SPEC-0003 CA-12`.
5. **Idioma.** As specs são escritas em português (SPEC-0001 D-26). Textos da interface, que é em inglês, aparecem entre aspas no idioma original.

## Convenções de ID

| Prefixo | Significado |
|---|---|
| `D-xx` | Decisão fechada, com racional |
| `CA-xx` | Critério de aceite (requisito funcional testável) |
| `NFR-xx` | Requisito não-funcional |
| `T-xx` | Cenário de teste |
| `Q-xx` | Questão em aberto: pergunte, nunca decida sozinho |
| `R-xx` | Risco aceito ou acompanhado |

**Status possíveis:** Rascunho → Em revisão → Aprovada → Implementada → Substituída.

## Níveis de cobertura

Cada produto declara o nível que almeja e o seu marco.

| Nível | Nome | O que significa |
|---|---|---|
| **L1** | Navegar | Páginas de lista e de detalhe, o recurso bruto em JSON/YAML e links para os logs e métricas dele |
| **L2** | Operar | L1 mais criar, editar e excluir, e as ações de ciclo de vida do produto (iniciar, parar, pausar, executar, fazer deploy e afins) |
| **L3** | Profundo | L2 mais ferramentas sob medida que tornam o Nephoscope melhor que voltar ao console do Google para aquele produto |

## Índice

| Spec | Título | Status | Versão | Marcos |
|---|---|---|---|---|
| [SPEC-0001](./0001-platform.md) | Plataforma: credenciais, segurança, API, operações, canal ao vivo, runtime | Rascunho | 0.9 | M0 (todos os marcos seguintes dependem dela) |
| [SPEC-0002](./0002-design-system.md) | Design system: as três skills de design, o mundo visual da folha de desenho, tokens, movimento, componentes, portões de qualidade | Rascunho | 0.9 | M0, portões em todo marco |
| [SPEC-0003](./0003-serverless.md) | Serverless: Cloud Run, functions, Workflows, Scheduler, Tasks, Eventarc, App Engine, API Gateway | Rascunho | 0.4 | M1, M6, M7 |
| [SPEC-0004](./0004-firestore.md) | Firestore (completo) e modo Datastore | Rascunho | 0.3 | M2 |
| [SPEC-0005](./0005-observability.md) | Observabilidade: Logging, Monitoring, Error Reporting, Trace | Rascunho | 0.5 | M1 (painéis compartilhados), M3 |
| [SPEC-0006](./0006-messaging-storage.md) | Mensageria e armazenamento: Pub/Sub, Cloud Storage, Filestore | Rascunho | 0.4 | M4 |
| [SPEC-0007](./0007-security-delivery.md) | Segurança e entrega: IAM, Secret Manager, KMS, Cloud Armor, Certificate Manager, Artifact Registry, Cloud Build, Cloud Deploy | Rascunho | 0.2 | M1 (seletor de imagem), M5 |
| [SPEC-0008](./0008-data-compute.md) | Dados e computação: BigQuery, Cloud SQL, Memorystore, Compute Engine, VPC, balanceamento de carga, Cloud DNS, GKE | Rascunho | 0.2 | M6 |
| [SPEC-0009](./0009-long-tail.md) | Cauda longa: console de API bruto, faturamento, cotas, recomendações e produtos L1 | Rascunho | 0.2 | M7 |

## Matriz de cobertura

| Grupo | Produto | Spec | Nível | Marco |
|---|---|---|---|---|
| Plataforma | Projetos e seletor de projeto | 0001 | L2 | M0 |
| Plataforma | APIs & Services | 0001 | L2 | M0 |
| Plataforma | Connections (perfis de credencial) | 0001 | L2 | M0 |
| Plataforma | Activity (log de auditoria do Nephoscope) | 0001 | L1 | M0 |
| Plataforma | Busca global de recursos (Cloud Asset Inventory) | 0001 | L1 | M0 |
| Serverless | Cloud Run services | 0003 | L3 | M1 |
| Serverless | Cloud Run jobs | 0003 | L3 | M1 |
| Serverless | Cloud Run functions (Cloud Functions gen1 e gen2) | 0003 | L3 | M1 |
| Serverless | Workflows | 0003 | L3 | M1 |
| Serverless | Cloud Scheduler | 0003 | L2 | M1 |
| Serverless | Cloud Tasks | 0003 | L2 | M1 |
| Serverless | Eventarc | 0003 | L2 | M1 |
| Serverless | App Engine | 0003 | L2 | M6 |
| Serverless | API Gateway | 0003 | L1 | M7 |
| Bancos de dados | Firestore (modo nativo) | 0004 | L3 | M2 |
| Bancos de dados | Firestore em modo Datastore | 0004 | L2 | M2 |
| Observabilidade | Painel de logs em todo recurso (compartilhado) | 0005 | L3 | M1 |
| Observabilidade | Aba de métricas em todo recurso (compartilhada) | 0005 | L2 | M1 |
| Observabilidade | Logs Explorer | 0005 | L3 | M3 |
| Observabilidade | Log Router, buckets e views de log, métricas baseadas em log, exclusões | 0005 | L2 | M3 |
| Observabilidade | Cloud Monitoring (Metrics Explorer, dashboards, alertas, uptime checks) | 0005 | L2 | M3 |
| Observabilidade | Error Reporting | 0005 | L2 | M3 |
| Observabilidade | Cloud Trace | 0005 | L2 | M3 |
| Mensageria | Pub/Sub | 0006 | L3 | M4 |
| Armazenamento | Cloud Storage | 0006 | L3 | M4 |
| Armazenamento | Filestore | 0006 | L1 | M4 |
| Segurança | IAM (políticas, contas de serviço, papéis, matriz de capacidades) | 0007 | L3 | M5 |
| Segurança | Secret Manager | 0007 | L3 | M5 |
| Segurança | Cloud KMS | 0007 | L2 | M5 |
| Segurança | Cloud Armor | 0007 | L2+ | M5 |
| Segurança | Certificate Manager | 0007 | L1 | M5 |
| Entrega | Artifact Registry | 0007 | L2 (seletor de imagem mínimo no M1) | M1, M5 |
| Entrega | Cloud Build | 0007 | L2+ | M5 |
| Entrega | Cloud Deploy | 0007 | L2 | M5 |
| Dados | BigQuery | 0008 | L3 | M6 |
| Dados | Cloud SQL | 0008 | L2 | M6 |
| Dados | Memorystore (Redis, Valkey, Memcached) | 0008 | L1 a L2 | M6 |
| Computação | Compute Engine | 0008 | L2 | M6 |
| Rede | Redes VPC, sub-redes, regras de firewall, rotas, Cloud NAT, endereços IP | 0008 | L2 | M6 |
| Rede | Topologia de balanceamento de carga | 0008 | L1 | M6 |
| Rede | Cloud DNS | 0008 | L2 | M6 |
| Computação | Google Kubernetes Engine (clusters e node pools) | 0008 | L2 | M6 |
| Cauda longa | Console de API bruto (qualquer método `*.googleapis.com`) | 0009 | L2 | M7 |
| Cauda longa | Faturamento (somente leitura), orçamentos e custos a partir de um export de faturamento no BigQuery | 0009 | L1 | M7 |
| Cauda longa | Cotas | 0009 | L1 | M7 |
| Cauda longa | Recomendações | 0009 | L1 | M7 |
| Cauda longa | Políticas da organização (efetivas) | 0009 | L1 | M7 |
| Cauda longa | Cloud Run worker pools e instâncias | 0009 | L1 | M7 |
| Cauda longa | Spanner, Bigtable, AlloyDB, Batch, Vertex AI, Dataflow, Dataproc, Cloud Composer, Storage Transfer Service | 0009 | L1 | M7 |
| Cauda longa | Achados do Security Command Center, configurações do Identity-Aware Proxy, testes de conectividade | 0009 | L1 | M7 |
| Cauda longa | Upgrade e detach de Cloud Run functions gen1 | 0003 | L2 | M7 |

## Marcos

| Marco | Conteúdo | Specs |
|---|---|---|
| **M0** Fundação | Monorepo, núcleo da plataforma, design system e shell, Docker, specs | 0001, 0002 |
| **M1** Serverless | Cloud Run, functions, Workflows, Scheduler, Tasks, Eventarc; painéis compartilhados de logs e métricas; seletor mínimo do Artifact Registry | 0003, 0005, 0007 |
| **M2** Firestore | Firestore completo, modo Datastore | 0004 |
| **M3** Observabilidade | Logs Explorer, Log Router, Monitoring, Error Reporting, Trace | 0005 |
| **M4** Mensageria e armazenamento | Pub/Sub, Cloud Storage, Filestore | 0006 |
| **M5** Segurança e entrega | IAM, Secret Manager, KMS, Cloud Armor, Certificate Manager, Artifact Registry, Cloud Build, Cloud Deploy | 0007 |
| **M6** Dados e computação | BigQuery, Cloud SQL, Memorystore, Compute Engine, VPC, balanceamento de carga, Cloud DNS, GKE, App Engine | 0008, 0003 |
| **M7** Cauda longa e endurecimento | Console de API bruto, faturamento, cotas, recomendações, produtos L1, auditoria de design do app inteiro, sincronização final das specs | 0009, todas |

Cada marco é construído em fatias verticais (contratos, módulo da API, UI, testes, atualização da spec, portões de design) e só fecha quando os seus cenários de teste passam e os portões de design da SPEC-0002 estão verdes.

## Questões em aberto entre specs

As questões em aberto que afetam o projeto inteiro ficam em [SPEC-0001 §12](./0001-platform.md#12-riscos-e-questões-em-aberto). Cada spec lista as suas.

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-09-28 | 0.1 | | Índice inicial, regras, convenções de ID, níveis de cobertura, matriz de cobertura e marcos, exportados do plano aprovado |
| 2026-09-28 | 0.2 | | Versões da SPEC-0001, 0002 e 0003 elevadas para 0.2 após a verificação das APIs; matriz de cobertura completada com os produtos de cauda longa da SPEC-0009 (políticas da organização, worker pools e instâncias, Dataflow, Dataproc, Composer, Storage Transfer, Security Command Center, IAP, testes de conectividade, upgrade e detach de gen1) |
| 2026-09-28 | 0.3 | | **Tradução para o português** (resolve SPEC-0001 Q-03, ver SPEC-0001 D-26); regra 5 sobre idioma; versões do índice atualizadas |
| 2026-09-28 | 0.4 | | Versões do índice: SPEC-0001 0.4 e SPEC-0002 0.5, após a implementação da web, do Docker e dos portões do M0 |
| 2026-09-28 | 0.5 | | Versões do índice após a implementação do M1: SPEC-0001 0.5, SPEC-0002 0.6, SPEC-0003 0.4 e SPEC-0005 0.3 |
| 2026-09-28 | 0.6 | | Versões do índice após a implementação do M2: SPEC-0001 0.6, SPEC-0002 0.7, SPEC-0004 0.3 e SPEC-0005 0.4 |
| 2026-09-28 | 0.7 | | Pub/Sub (SPEC-0006 M4.1 e M4.2) entregue antes do M3, a pedido do dono; versões: SPEC-0005 0.5 e SPEC-0006 0.3 |
| 2026-09-28 | 0.8 | | O produto passa a se chamar Nephoscope, com licença Apache-2.0 e imagem pública (SPEC-0001 D-25, D-27, D-28); SPEC-0001 0.7. Os históricos de revisão mantêm o nome da época |
| 2026-09-29 | 0.9 | | Cloud Storage (SPEC-0006 M4.3 e M4.4) entregue antes do M3; versões: SPEC-0001 0.8 e SPEC-0006 0.4 |
| 2026-09-29 | 0.10 | | As skills de design de terceiros não são versionadas no repositório público; SPEC-0002 0.9 |
| 2026-09-29 | 0.11 | | Imagem publicada no Docker Hub como `masanrios/nephoscope`; SPEC-0001 0.9 |

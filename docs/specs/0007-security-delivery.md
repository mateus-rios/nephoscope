# SPEC-0007 — Segurança e entrega

| | |
|---|---|
| **Status** | Rascunho |
| **Autor(es)** | |
| **Revisores** | |
| **Sistemas** | `apps/api/src/products/{iam,secretmanager,kms,armor,certmanager,artifactregistry,cloudbuild,clouddeploy}` · os `apps/web/src/products/*` correspondentes |
| **SDKs** | `@google-cloud/resource-manager` (política de IAM do projeto, ancestralidade) · `@googleapis/iam` (contas de serviço, chaves, papéis, permissões) · `@google-cloud/iam` (políticas de negação) · `@google-cloud/policy-troubleshooter` · `@google-cloud/secret-manager` · `@google-cloud/kms` · `@google-cloud/compute` (políticas de segurança, backend services) · `@google-cloud/certificate-manager` · `@google-cloud/artifact-registry` · `@google-cloud/containeranalysis` · `@google-cloud/cloudbuild` · `@google-cloud/deploy` |
| **Spec relacionada** | [SPEC-0001](./0001-platform.md) (sondagem de capacidades D-11, operações D-09, auditoria D-14, perfis D-04) · [SPEC-0003](./0003-serverless.md) (seletor de imagem D-17, segredos nos deploys) · [SPEC-0005](./0005-observability.md) (logs, tail ao vivo) · [SPEC-0008](./0008-data-compute.md) (os balanceadores de carga que o Cloud Armor protege) |
| **Última atualização** | 2026-09-28 |
| **Versão** | 0.2 |

---

## 1. Resumo

O M5 entrega os produtos que controlam **quem pode fazer o quê** e **como o código chega à produção**:
- **IAM** (L3): edição de política por principal e por papel, contas de serviço e chaves, papéis, uma matriz "o que esta chave pode fazer" e o Policy Troubleshooter;
- **Secret Manager** (L3), com revelação segura;
- **Cloud KMS** (L2);
- **Cloud Armor** (L2+): editor de regras com reordenação de prioridade, conjuntos de regras WAF e anexos;
- **Certificate Manager** (L1);
- **Artifact Registry** (L2; o seletor de imagem dele já existe desde o M1);
- **Cloud Build** (L2+), com logs ao vivo;
- **Cloud Deploy** (L2).

Toda ação aqui pode trancar alguém para fora, vazar um segredo ou mudar a produção. As regras recorrentes: mostrar o diff, dizer a consequência e auditar.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Binding** | Um papel concedido a membros numa política de IAM, opcionalmente com uma condição. |
| **Condição** | Uma expressão CEL que limita quando um binding vale. Exige política versão 3. |
| **etag** | O marcador de versão de uma política de IAM. Uma escrita com etag desatualizado é rejeitada. |
| **Acesso herdado** | Bindings numa pasta ou organização que também valem para o projeto. |
| **Chave de conta de serviço** | Uma credencial de uma conta de serviço. As gerenciadas pelo usuário são o que os perfis do Nephoscope costumam ser. |
| **Revelar** | Mostrar na UI o valor de uma versão de segredo (D-07). |
| **Política de segurança** | Uma política do Cloud Armor: regras ordenadas avaliadas por prioridade, do menor número para o maior. |
| **Modo preview** | Uma regra do Cloud Armor que é avaliada e registrada em log, mas não imposta. |
| **Regras WAF pré-configuradas** | Conjuntos de expressões mantidos pelo Google (injeção de SQL, XSS e outros) usados dentro das expressões de regra. |
| **Release / rollout** | No Cloud Deploy, um pacote versionado de manifestos, e a implantação dele num alvo. |

---

## 3. Problema

O IAM é o motivo mais comum para algo não funcionar quando se usa uma chave, e o console do Google dificulta responder às duas perguntas básicas: "o que este principal pode fazer?" e "por que isto foi negado?".

Segredos vazam fácil por uma UI: respostas em cache, logs, compartilhamento de tela. As prioridades de regra do Cloud Armor são frágeis de editar à mão. O estado de builds e deploys fica espalhado por várias páginas.

---

## 4. Objetivos

1. Responder "quem tem acesso a quê, e por quê" em poucos cliques, e mudar o acesso com segurança.
2. Lidar com segredos com a menor exposição possível.
3. Editar políticas do Cloud Armor sem quebrar a ordem das regras, e ver o que elas bloqueiam.
4. Acompanhar builds e deploys ao vivo, e agir sobre eles (tentar de novo, cancelar, aprovar, promover).

### Não-objetivos

- **Administração de organização e de pastas**, além de ler os bindings herdados.
- **Security Command Center** (a SPEC-0009 pode acrescentá-lo no L1).
- **Deploys a partir de código-fonte** (build a partir do código e depois deploy no Cloud Run). Uma revisão futura da spec pode acrescentá-los.
- **Inspeção de camadas de imagem de contêiner.**

---

## 5. Decisões tomadas

### D-01 — Edição de política de IAM com diff, versão e consciência de si

- **Duas visões da política do projeto:**
  - por **principal:** cada principal com os seus papéis;
  - por **papel:** cada papel com os seus membros.
- **Bindings herdados** aparecem numa seção própria, rotulados com a pasta ou organização de origem, quando o perfil consegue ler a ancestralidade do projeto e as políticas dos ancestrais.
- **Edições:**
  - adicionar um principal com papéis, por um seletor que busca papéis predefinidos e customizados e mostra a descrição e a quantidade de permissões de cada papel;
  - remover um binding;
  - adicionar uma condição, com um editor CEL e modelos (expiração, prefixo de nome de recurso).
- **Salvar:**
  - primeiro vem um **diff** da política;
  - o salvamento é um ler-modificar-escrever com o **etag**; se a política mudou desde o carregamento, o salvamento falha e oferece recarregar;
  - políticas com condições usam a versão 3.
- **Confirmação extra:**
  - remover o último Owner;
  - **remover o acesso do próprio principal do perfil ativo** ("You are removing your own access to this project").

**Racional:** escritas de política substituem a política inteira. Sem o etag, dois editores se sobrescrevem em silêncio; sem a checagem de si mesmo, um usuário pode trancar o Nephoscope para fora no meio da sessão.

### D-02 — Contas de serviço e chaves, com caminho para um perfil novo

| Área | Operações |
|---|---|
| **Contas de serviço** | Listar (e-mail, nome de exibição, estado, quantidade de chaves, criação); criar; editar; desabilitar e habilitar; excluir (digitado, com a janela de 30 dias para desfazer explicada); desfazer exclusão |
| **Chaves** | Listar (id, tipo, criação, expiração, estado); criar uma chave JSON; enviar uma chave pública; desabilitar e habilitar; excluir (digitado) |
| **IAM da conta de serviço** | Quem pode agir como a conta (`roles/iam.serviceAccountUser`, `roles/iam.serviceAccountTokenCreator`) |

Quando uma chave JSON é criada:
- ela é mostrada para download **uma única vez**, com um aviso sobre a segurança de chaves;
- o Nephoscope oferece **"Add as a Nephoscope profile"**, que a guarda criptografada (SPEC-0001 CA-05) sem que a chave passe pelo navegador.

**Racional:** criar uma chave de escopo estreito para o próprio Nephoscope é uma necessidade comum, e fazer isso num passo evita baixar arquivos de chave.

### D-03 — Papéis

- **Papéis predefinidos:** navegar e buscar, inclusive por permissão ("quais papéis concedem `run.services.update`?"), mostrar as permissões de um papel e comparar dois papéis.
- **Papéis customizados** no nível do projeto: criar, editar, desabilitar, excluir e desfazer exclusão. O seletor de permissões lista só as permissões que podem ser usadas em papéis customizados naquele nível.

### D-04 — "O que esta chave pode fazer" e o Policy Troubleshooter

- Uma **matriz** por produto e ação, montada a partir da sondagem de capacidades (SPEC-0001 D-11), mostra o que o perfil ativo pode fazer no projeto.
- Uma caixa **"Test permissions"** roda `testIamPermissions` para qualquer lista de permissões.
- Quando a API do Policy Troubleshooter está disponível, a página explica **por que** um principal tem ou não tem uma permissão num recurso, com os bindings que a concedem ou concederiam.

### D-05 — Políticas de negação, configuração de auditoria e identidade de workload

| Área | Nível |
|---|---|
| Políticas de negação anexadas ao projeto | L1: listar e ver |
| Configuração de auditoria (logs de acesso a dados por serviço: leitura administrativa, leitura de dados, escrita de dados, membros isentos) | L2, editada pela política do projeto com as mesmas regras de diff e etag da D-01 |
| Pools e provedores de identidade de workload | L1 |

### D-06 — Secret Manager: segredos globais e regionais

- **Onde os segredos ficam:** segredos globais e segredos regionais, estes atendidos por **endpoints regionais**. A fábrica de clientes cria um cliente por endpoint (SPEC-0001 D-23).
- **Segredos:**
  - listar com replicação, labels, expiração, agenda de rotação, tópicos de notificação, quantidade de versões e última versão habilitada;
  - criar com replicação (automática, ou gerenciada pelo usuário com locations e chaves KMS), labels, anotações, expiração, rotação (período, próxima vez, tópicos) e destruição adiada de versões;
  - atualizar; excluir (digitado).
- **Versões:**
  - listar com estado, criação e horário de destruição;
  - adicionar uma versão a partir de texto ou de um arquivo (no máximo 64 KiB);
  - habilitar, desabilitar;
  - destruir (digitado; a confirmação diz se a destruição é imediata ou adiada).
- **"Used by":** lista os Cloud Run services, jobs e functions que referenciam o segredo, encontrados nos templates deles.

### D-07 — Valores de segredo são revelados de propósito e nunca guardados

- **Quando:** um valor só é buscado quando o usuário clica em **Reveal** numa versão.
- **Por quanto tempo:** fica visível por **30 segundos** e depois é escondido de novo. Copiar fica disponível enquanto está visível.
- **Sem cache:** a resposta **nunca fica em cache** em lugar nenhum: nem no cache de consultas do navegador, nem no servidor, com `Cache-Control: no-store`.
- **Integridade:** o checksum do payload devolvido pelo Google é conferido antes de mostrar. Payloads binários aparecem em base64 ou hexadecimal.
- **Auditoria:** cada revelação é **auditada** (SPEC-0001 D-14). Revelações são leituras, então são permitidas em perfis somente leitura, e continuam auditadas.

**Racional:** compartilhamento de tela, olhares por cima do ombro e dumps de memória são os vazamentos realistas. Visibilidade curta e ausência de cache reduzem os três; a auditoria torna toda revelação atribuível.

### D-08 — Cloud KMS no L2

- **Key rings:** listar por location, criar.
- **Chaves:**
  - criar com propósito (criptografia simétrica, assinatura ou decriptação assimétrica, MAC), nível de proteção (software, HSM, externo), algoritmo, período de rotação e labels;
  - atualizar rotação e labels.
- **Versões de chave:** listar com estado; criar uma versão (rotacionar); definir a primária; habilitar, desabilitar; agendar destruição (digitado); restaurar.
- **IAM** nas chaves.
- **Ferramentas:** criptografar e decriptar (simétrica), assinar e verificar (assimétrica), para entradas de no máximo 64 KiB. Todo uso é auditado.
- **L1:** jobs de importação, key handles e Autokey.

### D-09 — Editor de regras do Cloud Armor

Políticas globais usam `SecurityPoliciesClient`, e as regionais `RegionSecurityPoliciesClient`. Toda mudança é uma operação do Compute, acompanhada pelo adaptador dela (SPEC-0001 D-09).

- **Lista de políticas:** nome, tipo (backend, edge, network), escopo (global ou região), quantidade de regras, alvos anexados, adaptive protection, labels.
- **Tabela de regras,** ordenada por prioridade: prioridade, ação (permitir, negar com status, banimento por taxa, throttle, redirecionar), condição (faixas de IP ou expressão CEL), modo preview, descrição.
  - A **regra padrão** (prioridade 2147483647) é sempre a última e não pode ser excluída; só a ação dela pode mudar.
- **Editor de regra:**
  - modo básico para faixas de IP, modo avançado para CEL;
  - os **conjuntos WAF pré-configurados** (de `listPreconfiguredExpressionSets`, só em políticas globais) entram como `evaluatePreconfiguredWaf(...)` com uma sensibilidade escolhida;
  - configurações de limitação de taxa (limiar, intervalo, ações de conformidade e de excesso, chave, duração do banimento), de redirecionamento e ações de cabeçalho;
  - um botão de preview.
- **Reordenação** por arrastar e soltar (dnd kit):
  - as prioridades são únicas, então o Nephoscope calcula um plano de mudanças de prioridade (mantendo intervalos de 10 e passando por prioridades temporárias livres quando necessário);
  - **mostra o plano antes de aplicá-lo** e depois o aplica regra a regra.
- **Anexos:**
  - anexar ou desanexar políticas de backend e de edge a backend services globais e regionais (e políticas de edge a backend buckets);
  - uma visão de "políticas efetivas" por backend service.
- **Adaptive protection:** ligar ou desligar a defesa contra DDoS de camada 7. As configurações de implantação automática ficam no L1.
- **Logs:** a aba Logs da política abre com as requisições negadas ou em preview por esta política:

```
resource.type="http_load_balancer"
jsonPayload.enforcedSecurityPolicy.name="{política}"
```

  A variante de preview filtra por `jsonPayload.previewSecurityPolicy.name`.

**Racional:** a ordem de prioridade é a semântica do Cloud Armor. Um arrastar que renumerasse regras em silêncio poderia abrir ou fechar tráfego, por isso o plano aparece antes.

### D-10 — Certificate Manager no L1

Certificados, mapas de certificado e as suas entradas, autorizações de DNS e configurações de emissão; mais os certificados SSL clássicos do Compute. Lista, detalhe e recurso bruto, com as datas de expiração destacadas quando faltam menos de 30 dias.

### D-11 — Artifact Registry no L2

- **Repositórios:** listar entre locations (com `locations/-` quando aceito, senão por fan-out, SPEC-0001 D-17), com formato, modo (padrão, remoto, virtual), tamanho e políticas de limpeza.
- **Políticas de limpeza:** editadas como JSON, com a flag de dry-run.
- **Pacotes e versões:** listar; listar, adicionar e excluir tags.
- **Imagens Docker:** URI, tags, tamanho, horários de upload e de build.
- **Excluir** uma versão ou tag (digitado).
- **Vulnerabilidades** de um digest de imagem, quando o Container Analysis está habilitado: contagem por severidade e a lista de achados (L1).
- **"Deploy to Cloud Run"** a partir de uma imagem, que abre o formulário de deploy da SPEC-0003 com o digest.
- **IAM** nos repositórios.

### D-12 — Cloud Build no L2+, com logs ao vivo

- **Builds:**
  - listar entre locations globais e regionais, com filtro por estado, gatilho e tag;
  - página do build: passos com estado e tempos, substituições, origem, imagens, artefatos, opções, conta de serviço e logs.
- **Logs ao vivo** de builds em andamento vêm:
  - do Cloud Logging, por um tail ao vivo compartilhado (SPEC-0005 D-03), quando o build registra lá;
  - senão, do objeto de log do build no Cloud Storage, lido de forma incremental no canal `build.logs`.
- **Ações do build:** tentar de novo; cancelar; aprovar ou rejeitar builds que esperam aprovação.
- **Gatilhos:**
  - listar com evento, repositório, filtro de branch ou tag, arquivo de configuração e estado;
  - **executar** com uma branch, tag ou commit e substituições;
  - habilitar e desabilitar; criar e editar para eventos de push, pull request, manual, Pub/Sub e webhook.
- **L1:** conexões de repositório (2ª geração) e worker pools.

### D-13 — Cloud Deploy no L2

- **Pipelines de entrega:** os estágios e alvos de cada pipeline desenhados como uma sequência.
- **Alvos:** lista.
- **Releases:** lista com estado de renderização (criar releases é L1: exige configuração skaffold e código).
- **Rollouts:** estado por alvo; aprovar e rejeitar; avançar; tentar de novo um job que falhou; cancelar; **promover** um release para o próximo alvo.
- **Execuções de automação:** L1.

---

## 6. Escopo

### Dentro
D-01 a D-13.

### Fora
Os não-objetivos de §4.

---

## 7. Requisitos

### 7.1 IAM

**CA-01** — As visões de política, a edição, o diff, o etag e a checagem de acesso próprio seguem a D-01.

**CA-02** — Contas de serviço e chaves seguem a D-02. "Add as a Nephoscope profile" guarda uma chave nova sem enviá-la ao navegador.

**CA-03** — Os papéis seguem a D-03, incluindo a busca por permissão e a comparação de dois papéis.

**CA-04** — A matriz, a caixa de teste e o troubleshooter seguem a D-04.

**CA-05** — Políticas de negação, configuração de auditoria e identidade de workload seguem a D-05.

### 7.2 Segredos e chaves

**CA-06** — O Secret Manager segue a D-06, incluindo segredos regionais pelos endpoints regionais e a lista "Used by".

**CA-07** — Revelar segue a D-07: clique explícito, 30 segundos, sem cache (`Cache-Control: no-store`, tempo de cache de consulta 0), checksum conferido, auditado.

**CA-08** — O Cloud KMS segue a D-08, com todo uso de ferramenta criptográfica auditado.

### 7.3 Cloud Armor e certificados

**CA-09** — O Cloud Armor segue a D-09: tabela de regras, editor com conjuntos WAF, plano de reordenação mostrado antes de aplicar, anexos, políticas efetivas, adaptive protection, logs.

**CA-10** — O Certificate Manager segue a D-10.

### 7.4 Entrega

**CA-11** — O Artifact Registry segue a D-11, incluindo "Deploy to Cloud Run".

**CA-12** — O Cloud Build segue a D-12, com logs ao vivo para builds em andamento.

**CA-13** — O Cloud Deploy segue a D-13, incluindo promover e aprovações.

---

## 8. Requisitos não-funcionais

| Id | Requisito |
|---|---|
| **NFR-01** | Nenhum payload de segredo aparece em logs do servidor, armazenamento do navegador, cache de consultas ou log de auditoria (só o fato da revelação). |
| **NFR-02** | Os logs de um build em andamento chegam ao navegador em até 3 s depois de escritos. |
| **NFR-03** | Uma política com 500 bindings renderiza as duas visões de IAM em menos de 500 ms. |

---

## 9. Cenários de teste

Todos rodam contra o projeto sandbox da SPEC-0001 Q-02.

| Id | Cenário | Esperado |
|---|---|---|
| **T-01** | Conceder `roles/run.viewer` a uma conta de serviço com condição de expiração | Diff mostrado; política salva com versão 3; condição visível |
| **T-02** | Mudar a política por outro cliente e depois salvar pelo Nephoscope | Salvamento recusado por causa do etag; recarregar mostra a outra mudança |
| **T-03** | Remover o `roles/owner` do próprio perfil ativo | Confirmação extra nomeando o risco de se trancar para fora |
| **T-04** | Criar uma conta de serviço e uma chave JSON, depois "Add as a Nephoscope profile" | Perfil adicionado; a chave nunca aparece numa resposta ao navegador (checagem no estilo do SPEC-0001 T-07) |
| **T-05** | Buscar os papéis que concedem `secretmanager.versions.access` | Papéis correspondentes listados |
| **T-06** | Investigar por que um principal não tem `run.services.update` | Explicação com os bindings relevantes, ou uma nota se a API estiver indisponível |
| **T-07** | Criar um segredo com rotação, adicionar uma versão, revelá-la | Valor visível por 30 s e depois escondido; entrada de auditoria; sem cache |
| **T-08** | Criar um segredo regional e revelá-lo | Atendido pelo endpoint regional |
| **T-09** | Destruir uma versão com destruição adiada | A confirmação diz o adiamento; o estado mostra destruição agendada |
| **T-10** | Criar um key ring e uma chave simétrica; criptografar e decriptar um texto | Ida e volta correta; duas entradas de auditoria |
| **T-11** | Criar uma política do Cloud Armor com uma regra de negação por IP e uma regra WAF de injeção de SQL em preview; anexá-la a um backend service | Regras ordenadas; preview sinalizado; anexo visível nas políticas efetivas |
| **T-12** | Arrastar a última regra para cima da primeira | Plano de prioridades mostrado antes de aplicar; a ordem final confere |
| **T-13** | Enviar uma requisição que casa com a regra de negação | Requisição negada visível na aba Logs da política |
| **T-14** | Criar um repositório Docker, enviar uma imagem, "Deploy to Cloud Run" | Formulário de deploy preenchido com o digest |
| **T-15** | Executar um gatilho de build e acompanhar o build | Logs ao vivo; estado final; tentar de novo disponível |
| **T-16** | Promover um release do Cloud Deploy para o próximo alvo e aprová-lo | O rollout avança até o sucesso |
| **T-17** | Com um perfil somente leitura, tentar todas as mutações acima pela API | Todas rejeitadas com `READ_ONLY`; revelar continua permitido e auditado |

---

## 10. Plano de entrega

| Passo | Entregável | Depende de |
|---|---|---|
| M5.1 | IAM (D-01 a D-05) | M0 |
| M5.2 | Secret Manager e KMS | M0 |
| M5.3 | Cloud Armor e Certificate Manager | M0 (a topologia de balanceamento da SPEC-0008 liga a ele depois) |
| M5.4 | Artifact Registry (completo), Cloud Build, Cloud Deploy | Seletor de imagem do M1 |

---

## 11. Riscos e questões em aberto

### Riscos

| Id | Risco | Mitigação |
|---|---|---|
| **R-01** | Uma edição de política tranca usuários ou o Nephoscope para fora | Diff, etag, confirmação de acesso próprio (D-01) |
| **R-02** | Exposição de segredos pela UI | D-07 |
| **R-03** | Reordenar regras muda o tráfego que passa | Plano mostrado antes de aplicar (D-09) |
| **R-04** | Chaves criadas vazam por downloads | Mostradas uma vez, com aviso; caminho direto "Add as a Nephoscope profile" (D-02) |

### Questões em aberto

Nenhuma.

---

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-09-28 | 0.1 | | Versão inicial, exportada do plano aprovado e da verificação das APIs (clientes do Cloud Armor e operações do Compute): D-01 a D-13, CA-01 a CA-13, NFR-01 a NFR-03, T-01 a T-17, R-01 a R-04 |
| 2026-09-28 | 0.2 | | **Tradução para o português** (SPEC-0001 D-26) |

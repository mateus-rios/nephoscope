# SPEC-0006 — Mensageria e armazenamento

| | |
|---|---|
| **Status** | Rascunho |
| **Autor(es)** | |
| **Revisores** | |
| **Sistemas** | `apps/api/src/modules/{pubsub,storage,filestore}` · `apps/web/src/products/{pubsub,storage,filestore}` |
| **SDKs** | `@google-cloud/pubsub` (cliente de alto nível e os clientes `v1` de baixo nível Publisher, Subscriber e Schema) · `@google-cloud/storage` · `@google-cloud/storage-control` · `@google-cloud/filestore` |
| **Spec relacionada** | [SPEC-0001](./0001-platform.md) (canal ao vivo, confirmações, regra de renderização D-22, CA-73, emuladores D-18) · [SPEC-0002](./0002-design-system.md) · [SPEC-0005](./0005-observability.md) (predefinições de métricas) · [SPEC-0004](./0004-firestore.md) (buckets de export e import) |
| **Última atualização** | 2026-09-29 |
| **Versão** | 0.4 |

---

## 1. Resumo

O M4 entrega:
- **Pub/Sub no L3:** tópicos, todos os tipos de assinatura, publicação, espiar com segurança, observar um tópico ao vivo, inspeção e reenvio de dead letter, seek e snapshots, schemas;
- **Cloud Storage no L3:** configurações de bucket e um navegador de objetos em streaming, com upload, download, pré-visualização, versões, objetos em exclusão reversível e pastas;
- **Filestore no L1.**

A preocupação recorrente é **não perturbar a produção**. Olhar mensagens não pode roubá-las dos consumidores nem empurrá-las para uma fila de dead letter, e olhar objetos não pode executar o conteúdo deles.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Tópico** | Um canal nomeado onde mensagens são publicadas. |
| **Assinatura** | Um fluxo nomeado das mensagens de um tópico. Tipos de entrega: pull, push, BigQuery, Cloud Storage. |
| **Prazo de ack** | Tempo que um assinante tem para confirmar uma mensagem antes que o Pub/Sub a reentregue. |
| **Nack** | Definir o prazo de ack de uma mensagem como 0, para que ela seja reentregue na hora. |
| **Tentativa de entrega** | Contador de entregas de uma mensagem numa assinatura com política de dead letter. |
| **Tópico de dead letter (DLQ)** | Para onde uma assinatura encaminha mensagens depois de tentativas de entrega demais. |
| **Espiar (peek)** | O pull pontual do Nephoscope que mostra mensagens e as libera (D-04). |
| **Observar (watch)** | A visão ao vivo de um tópico feita pelo Nephoscope, por uma assinatura temporária (D-05). |
| **Seek** | Mover o estado de confirmação de uma assinatura para um snapshot ou um horário. |
| **Prefixo / pasta** | Uma "pasta" num bucket plano é um prefixo de nome de objeto. Buckets com namespace hierárquico têm pastas de verdade. |
| **Objeto em exclusão reversível** | Um objeto excluído que ainda pode ser restaurado durante a retenção de exclusão reversível do bucket. |
| **Versão não atual** | Uma geração mais antiga de um objeto num bucket com versionamento. |

---

## 3. Problema

É difícil inspecionar o Pub/Sub com segurança. Fazer pull de mensagens de uma assinatura de produção as tira do consumidor real até que sejam liberadas. Liberá-las conta como tentativa de entrega, o que pode mandar mensagens para dead letter em assinaturas com limite baixo de tentativas.

Buckets do Cloud Storage podem guardar milhões de objetos e arquivos muito grandes. Um console que lista tudo, ou que guarda downloads em memória, falha exatamente quando é necessário. E pré-visualizar embutido um arquivo HTML ou SVG guardado executaria o que quer que ele contenha.

---

## 4. Objetivos

1. Ver o que passa por um tópico ou espera numa assinatura sem afetar os consumidores, ou com o efeito dito de antemão quando houver.
2. Recuperar-se de falhas: inspecionar mensagens em dead letter, reenviá-las, fazer seek de uma assinatura para trás no tempo.
3. Navegar e transferir objetos de qualquer tamanho e quantidade, sempre em streaming.
4. Gerenciar por completo as configurações de bucket e de assinatura, inclusive as difíceis de achar no console do Google.

### Não-objetivos

- **Pub/Sub Lite** (descontinuado pelo Google).
- **Storage Transfer Service** e **Storage Insights** (a SPEC-0009 pode acrescentá-los no L1).
- **Sincronizar pastas** entre o disco local e um bucket.

---

## 5. Decisões tomadas

### D-01 — Clientes do Pub/Sub

- A gestão de tópicos, assinaturas, snapshots e schemas usa os clientes do `@google-cloud/pubsub`.
- **Espiar usa o `SubscriberClient` de baixo nível** (`pull` síncrono, `modifyAckDeadline`, `acknowledge`), para controle exato de cada mensagem.
- **Observar usa streaming pull** na sua própria assinatura temporária.
- O suporte a emulador segue a SPEC-0001 D-18. O cliente de alto nível resolve o endereço do emulador (`PUBSUB_EMULATOR_HOST`) e os clientes de baixo nível reutilizam as opções dele, sem credenciais. O emulador atual (0.8) atende também snapshots, seek e schemas, que funcionam nele; só as métricas (Cloud Monitoring) ficam indisponíveis.
- O streaming pull da observação usa um cliente de alto nível por projeto, porque ele exige o id do projeto.

### D-02 — Tópicos no L2

- **Listar:** schema, retenção de mensagens, chave KMS, política de armazenamento de mensagens, origem de ingestão, labels.
- **Criar e atualizar:** essas configurações; origens de ingestão aparecem somente leitura.
- **Excluir:** confirmação digitada. O diálogo avisa que as assinaturas do tópico ficarão desanexadas.
- **Publicar:**
  - os dados como texto, JSON (validado) ou base64, mais atributos e uma chave de ordenação;
  - ou várias mensagens a partir de um arquivo NDJSON, em que cada linha traz `data` e `attributes`; acima de 100 mensagens, pede confirmação.
- A página do tópico lista as suas assinaturas e snapshots.

### D-03 — Assinaturas no L2, com todos os tipos de entrega

- **Tipos de entrega e as suas configurações:**
  - **pull**;
  - **push:** endpoint, conta de serviço e audiência do OIDC, desembrulhar payload;
  - **BigQuery:** tabela, usar o schema do tópico ou da tabela, gravar metadados, descartar campos desconhecidos;
  - **Cloud Storage:** bucket, prefixo e sufixo de nome de arquivo, duração e bytes máximos, saída em texto ou Avro.
- **Configurações comuns:** prazo de ack, retenção (e "retain acknowledged messages"), expiração, política de retry (backoff mínimo e máximo), tópico de dead letter e máximo de tentativas de entrega, filtro, entrega exatamente uma vez, ordenação de mensagens.
- **Configurações que o Google não permite mudar depois de criadas** (filtro, ordenação de mensagens) ficam travadas no formulário de edição, com o motivo.
- **A configuração de dead letter** mostra os grants de IAM de que ela precisa: o agente de serviço do Pub/Sub tem de poder publicar no tópico de dead letter e assinar esta assinatura. Quando a sondagem de capacidades permite, o Nephoscope oferece adicioná-los.
- **Excluir e desanexar** exigem confirmação digitada.
- **Os grants do dead letter** são adicionados pela própria página (`roles/pubsub.publisher` no tópico de dead letter e `roles/pubsub.subscriber` na assinatura, para `service-{número do projeto}@gcp-sa-pubsub.iam.gserviceaccount.com`), com os comandos `gcloud` equivalentes ao lado. O número do projeto vem da página, que já o conhece; sem ele, o botão fica desabilitado com o motivo.

### D-04 — Espiar: pontual, liberado na hora, com o custo dito

"Peek" numa assinatura:
1. faz pull de até 100 mensagens (pull síncrono com timeout curto);
2. **dá nack nelas imediatamente** (prazo de ack 0), para que voltem à assinatura na hora;
3. mostra cada mensagem: dados (como texto, JSON formatado quando válido, senão base64 e hexadecimal), atributos, horário de publicação, id da mensagem, chave de ordenação e tentativa de entrega.

Antes da primeira espiada numa assinatura, um aviso diz:
- as mensagens espiadas ficaram por um instante indisponíveis para os outros assinantes;
- **numa assinatura com política de dead letter, cada espiada conta como tentativa de entrega**, e mensagens perto do limite podem ir para dead letter.

O Nephoscope mostra nesse aviso o máximo de tentativas de entrega da assinatura.

**"Pull and acknowledge"** é uma ação separada e explícita. Ela remove as mensagens da assinatura, exige a confirmação digitada da quantidade e fica bloqueada em modo somente leitura.

Não existe espiada ao vivo numa assinatura existente.

Detalhes:
- Uma assinatura vazia responde ao pull síncrono só no fim do prazo; o Nephoscope espera no máximo 5 segundos e trata o fim do prazo como "nenhuma mensagem".
- O aviso aparece até ser confirmado ("I understand") uma vez por assinatura na aba; até lá, espiar e "Pull and acknowledge" ficam desabilitados.
- Os dados aparecem como texto quando são UTF-8 válido (formatados quando são JSON); senão, só em base64 e hexadecimal.
- A espiada é uma leitura para o modo somente leitura, porque devolve as mensagens; "Pull and acknowledge" é uma mutação.
- Só assinaturas pull podem ser espiadas; as de push, BigQuery e Cloud Storage explicam que o próprio Pub/Sub entrega as mensagens e sugerem observar o tópico.

**Racional:** fazer pull e nack repetidamente numa assinatura de produção rouba mensagens dos consumidores e infla as tentativas de entrega. Uma espiada pontual com aviso explícito é o jeito menos perturbador de olhar dentro de uma assinatura.

### D-05 — Observar um tópico por uma assinatura temporária

"Watch" num tópico:
1. cria uma assinatura chamada `nephoscope-watch-{aleatório}` nesse tópico, com filtro opcional, política de expiração de 24 horas e retenção de mensagens de 10 minutos;
2. transmite as mensagens dela pelo canal `pubsub.watch`, confirmando-as conforme chegam;
3. **exclui a assinatura** quando a visão fecha. A política de expiração a remove se o Nephoscope parar de forma inesperada.

É uma mutação, então o modo somente leitura a bloqueia, e exige `pubsub.subscriptions.create` no projeto. Mensagens publicadas antes do início da observação não aparecem.

A assinatura temporária recebe o label `created-by: nephoscope`. As listas de assinaturas escondem as `nephoscope-watch-*` e dizem quantas estão escondidas. A página mostra até 500 mensagens, as mais novas primeiro, enviadas ao navegador a cada 200 ms.

**Racional:** uma assinatura própria vê toda mensagem nova sem tirar nenhuma das assinaturas existentes e sem afetar as tentativas de entrega delas.

### D-06 — Mensagens em dead letter: inspecionar e reenviar

Uma assinatura com política de dead letter tem uma aba "Dead-lettered".
- **Com uma assinatura** no tópico de dead letter, a aba pode espiá-la (D-04) e **reenviar** mensagens selecionadas: publicá-las de novo no tópico original com os dados e atributos, e depois confirmá-las na assinatura de dead letter. Reenviar mais de uma mensagem exige a quantidade digitada.
- **Sem assinatura** no tópico de dead letter, a aba explica que as mensagens se perdem a menos que exista uma, e oferece criá-la.

### D-07 — Seek e snapshots

- **Snapshots:** criar a partir de uma assinatura, listar, excluir.
- **Seek de uma assinatura:**
  - para um snapshot;
  - ou para um horário: um horário passado reenvia as mensagens ainda retidas; "agora" marca como confirmada toda mensagem atual, o que equivale a uma **purga**.
- Os dois tipos de seek dizem o efeito numa frase e exigem confirmação digitada.

### D-08 — Schemas

- **Schemas** (Avro e Protocol Buffers): listar; criar; confirmar uma revisão nova; reverter; excluir uma revisão; validar uma definição.
- **Validar uma mensagem** contra um schema, em codificação JSON ou binária.
- **Configurações do tópico:** o schema, a codificação e a primeira e a última revisão permitidas.

### D-09 — Clientes do Cloud Storage

`@google-cloud/storage` para buckets e objetos. `@google-cloud/storage-control` para pastas de namespace hierárquico, pastas gerenciadas e renomeação de pasta. Com `STORAGE_EMULATOR_HOST` definido, os dois apontam para o `fake-gcs-server` (SPEC-0001 D-18); os recursos que o emulador não tem aparecem como indisponíveis.

**Emulador.**
- O SDK v8 lê `STORAGE_EMULATOR_HOST` sozinho e monta URLs de upload erradas, conforme a variável traga ou não o sufixo `/storage/v1`. O Nephoscope aceita a variável com ou sem esquema e sufixo, passa o endpoint explicitamente (`apiEndpoint`) e a remove do ambiente do processo.
- O `fake-gcs-server` não tem IAM, URLs assinadas, pastas hierárquicas nem renomeação de pasta: o servidor responde `FAILED_PRECONDITION` com motivo `EMULATOR_UNSUPPORTED`, e a UI explica antes.
- Ele aceita, mas não guarda, ciclo de vida, CORS, labels e a maior parte das configurações do bucket; a aba de configuração avisa. As listagens de versões e de objetos em exclusão reversível não são confiáveis nele.
- Ele descarta os metadados de uploads resumíveis; com o emulador, o Nephoscope reaplica o content type depois do upload.

### D-10 — Buckets no L2+

- **Listar:** location e tipo de location, classe de armazenamento padrão, acesso uniforme, prevenção de acesso público, versionamento, retenção de exclusão reversível, namespace hierárquico, labels, horário de criação. O tamanho e a quantidade de objetos ficam na aba de métricas (predefinição `storage-bucket` da SPEC-0005, amostrada uma vez por dia), não na lista.
- **Criar:** nome, location, classe de armazenamento, Autoclass, namespace hierárquico, acesso uniforme, prevenção de acesso público, política de exclusão reversível, versionamento, política de retenção, labels.
- **Configurações:**
  - um editor de **regras de ciclo de vida** (condições e ações em formulário, com visão JSON);
  - **CORS** como JSON validado;
  - versionamento, retenção de exclusão reversível, classe de armazenamento padrão, labels, requester pays, configuração de website, chave KMS padrão;
  - **política de retenção**, cuja confirmação diz que o bloqueio é irreversível. Bloquear exige o nome do bucket digitado e usa a metageração lida; um período bloqueado só pode crescer, e o servidor recusa encurtá-lo.
  - Só as configurações alteradas são enviadas; labels removidos vão como `null` para saírem do bucket.
- **Permissões:** a política de IAM do bucket, salva com o `etag` lido para que edições simultâneas entrem em conflito em vez de se sobrescreverem. Bindings com condição são preservados (política versão 3).
- **Excluir** exige o nome digitado. Um bucket não vazio exige também a quantidade de objetos e versões digitada.
  - O servidor conta até 1.000.000; acima disso recusa e sugere esvaziar o bucket com uma regra de ciclo de vida.
  - O bucket é esvaziado numa operação local (SPEC-0001 D-09), com 16 exclusões em paralelo, progresso e cancelamento; só então o bucket é excluído. Cancelar deixa o bucket com o que restou.

### D-11 — Navegador de objetos que faz streaming de tudo

- **Navegação.** Um bucket plano é navegado por prefixo e delimitador `/`; um bucket com namespace hierárquico, por pastas. A paginação é de 1.000 por página, com busca por prefixo.
- **Outras visões.**
  - Botões para mostrar versões não atuais e objetos em exclusão reversível. Objetos em exclusão reversível podem ser restaurados.
  - Ordenação por nome, tamanho ou horário de atualização dentro das páginas carregadas.
- **Download.** Em streaming pelo Nephoscope, com suporte a HTTP range; nunca guardado em memória.
- **Links de objeto.** Downloads e pré-visualizações usam links de mesma origem e curta duração, `/api/o/{token}`.
  - `<img>`, `<video>` e downloads não conseguem enviar o cabeçalho `x-nephoscope-client`. A página pede o link com o cabeçalho, e o token passa a fazer o papel dele.
  - O token tem 32 bytes aleatórios e fica só em memória (um restart invalida os links). Vale para um perfil, projeto, bucket, objeto, geração e disposição, e expira em 10 minutos quando embutido ou em 2 minutos quando anexo.
  - Só a exigência do cabeçalho é dispensada, e só para `GET` e `HEAD` (SPEC-0001 CA-13). Host, token de acesso e origem continuam verificados.
- **Upload.**
  - Arrastar e soltar arquivos e pastas, em streaming para uploads resumíveis do Cloud Storage.
  - Progresso por arquivo, 3 arquivos por vez, e cancelamento. Sobrescrever um objeto existente pede confirmação.
  - O corpo do `PUT` vai direto para o upload resumível, sem passar pelo parser de JSON, qualquer que seja o tipo do arquivo.
  - Sem confirmação, o upload usa `ifGenerationMatch: 0`. Um objeto existente responde **409** `ALREADY_EXISTS` com motivo `OBJECT_EXISTS`, e a UI oferece "Overwrite N objects" ou "Skip".
- **Ações.**
  - **Copiar, mover e renomear.** Em buckets com namespace hierárquico, renomear uma pasta usa a operação de renomeação de pasta.
  - **Excluir:** um objeto exige o nome digitado; vários exigem a quantidade digitada. A seleção só exclui objetos: pastas selecionadas ficam, e a confirmação diz isso.
  - **Pastas.** Num bucket plano, criar uma pasta grava um objeto vazio `nome/`; num bucket com namespace hierárquico, cria uma pasta de verdade.
  - **Versões.** Tornar atual uma versão não atual copia essa geração sobre o objeto vivo.
  - Editar metadados: content type, cache control, content disposition, encoding, idioma e metadados customizados.
  - Holds baseados em evento e temporários, por objeto.
- **Detalhes do objeto.** Geração, metageração, tamanho, MD5, CRC32C, classe de armazenamento, horários de criação, atualização e customizado, retenção, holds, chave KMS.
- **URLs assinadas.** URLs assinadas V4, com validade de até 7 dias, só são oferecidas quando o perfil consegue assinar: uma chave de conta de serviço, ou `iam.serviceAccounts.signBlob` na conta de serviço.
- **Acesso público.** "Make public" em buckets de controle fino diz o efeito, e fica bloqueado quando a prevenção de acesso público está imposta.

### D-12 — Pré-visualizações nunca executam conteúdo

As pré-visualizações seguem a SPEC-0001 D-22 e CA-73:
- pré-visualização embutida só para imagens raster, texto, JSON (formatado), CSV (como tabela, primeiras 1.000 linhas), PDF, áudio e vídeo;
- mídia vai em streaming, com requisições de range;
- pré-visualizações de texto param em 5 MiB e de imagem em 50 MiB;
- **HTML, SVG, XML e tipos desconhecidos nunca são renderizados embutidos.** HTML, SVG e XML aparecem como código-fonte: são servidos como `text/plain` com `Content-Disposition: attachment`, lidos pela página com `fetch` e mostrados como texto. Tipos desconhecidos só são baixados;
- só imagens raster, PDF, áudio e vídeo são servidos com um tipo de mídia; todo o resto vai como texto puro;
- cada resposta de objeto traz sua própria política: `default-src 'none'; sandbox; frame-ancestors 'self'`, com `nosniff` e `Cache-Control: private, no-store`. O PDF vai sem `sandbox`, porque o visualizador do navegador não roda em sandbox;
- JSON é formatado quando cabe inteiro nos 5 MiB; acima disso aparece como texto.

### D-13 — Filestore no L1

Instâncias (tier, capacidade, compartilhamentos de arquivo, redes, estado), backups e snapshots: lista, detalhe e recurso bruto.

---

## 6. Escopo

### Dentro
D-01 a D-13.

### Fora
Os não-objetivos de §4.

---

## 7. Requisitos

### 7.1 Pub/Sub

**CA-01** — Os tópicos seguem a D-02, incluindo publicação com atributos e chaves de ordenação, e publicação em lote por NDJSON com confirmação acima de 100 mensagens.

**CA-02** — As assinaturas seguem a D-03 nos quatro tipos de entrega, travam as configurações imutáveis e mostram as necessidades de IAM do dead letter.

**CA-03** — Espiar segue a D-04: as mensagens recebem nack na hora, e o aviso de tentativas de entrega com o limite da assinatura aparece antes da primeira espiada.

**CA-04** — "Pull and acknowledge" exige a quantidade digitada e fica bloqueado em modo somente leitura.

**CA-05** — Observar segue a D-05: assinatura temporária com expiração de 24 horas, transmitida pelo `pubsub.watch`, excluída ao fechar; bloqueada em modo somente leitura.

**CA-06** — A aba de dead letter segue a D-06, incluindo o reenvio com a quantidade digitada.

**CA-07** — Seek e snapshots seguem a D-07, e o seek diz o efeito antes de confirmar.

**CA-08** — Os schemas seguem a D-08, incluindo a validação de mensagens.

**CA-09** — Dados e atributos das mensagens são renderizados apenas como texto (SPEC-0001 D-22).

### 7.2 Cloud Storage

**CA-10** — Os buckets seguem a D-10, incluindo o editor de ciclo de vida, a validação de CORS e o aviso de bloqueio irreversível.

**CA-11** — O navegador de objetos segue a D-11. Downloads e uploads passam em streaming pelo servidor, qualquer que seja o tamanho.

**CA-12** — As pré-visualizações seguem a D-12.

**CA-13** — URLs assinadas só são oferecidas quando o perfil consegue assinar, e dizem a validade.

### 7.3 Filestore

**CA-14** — O Filestore segue a D-13.

---

## 8. Requisitos não-funcionais

| Id | Requisito |
|---|---|
| **NFR-01** | Baixar um objeto de 5 GiB mantém o crescimento de memória do servidor abaixo de 64 MiB. |
| **NFR-02** | Enviar um arquivo de 5 GiB mantém o crescimento de memória do servidor abaixo de 64 MiB e sobrevive a um erro de rede transitório pelo upload resumível. |
| **NFR-03** | Um prefixo com 100.000 objetos abre a primeira página em menos de 1 s depois que a API responde; a lista rola a 60 fps conforme as páginas carregam. |
| **NFR-04** | Observar mostra uma mensagem publicada em até 2 s. |

---

## 9. Cenários de teste

| Id | Cenário | Onde | Esperado |
|---|---|---|---|
| **T-01** | Criar um tópico e uma assinatura pull; publicar 3 mensagens com atributos | Emulador | Mensagens publicadas |
| **T-02** | Espiar a assinatura | Emulador | 3 mensagens mostradas; ainda disponíveis para outro assinante logo depois |
| **T-03** | Fazer pull e confirmar 3 mensagens | Emulador | Quantidade digitada exigida; mensagens removidas |
| **T-04** | Observar o tópico, publicar uma mensagem, fechar a visão | Emulador | A mensagem aparece; a assinatura `nephoscope-watch-*` é excluída |
| **T-05** | Derrubar o Nephoscope durante uma observação | Sandbox | A assinatura continua existindo, com expiração de 24 horas |
| **T-06** | Espiar uma assinatura com máximo de 5 tentativas de entrega | Sandbox | O aviso mostra o limite antes da primeira espiada |
| **T-07** | Forçar mensagens para um tópico de dead letter com assinatura; reenviar duas | Sandbox | As mensagens reenviadas são publicadas no tópico original e confirmadas na assinatura de dead letter |
| **T-08** | Criar um snapshot, confirmar tudo, fazer seek de volta ao snapshot | Sandbox | Mensagens disponíveis de novo |
| **T-09** | Criar uma assinatura push com OIDC para um Cloud Run service | Sandbox | As requisições chegam ao service com um token |
| **T-10** | Criar um schema Avro, anexá-lo a um tópico, publicar uma mensagem inválida | Sandbox | Publicação rejeitada; o validador explica o motivo |
| **T-11** | Criar um bucket; enviar uma pasta com 50 arquivos e um arquivo de 2 GiB | Emulador e Sandbox | Progresso por arquivo; memória do servidor dentro da NFR-02 |
| **T-12** | Baixar o arquivo de 2 GiB com uma requisição de range | Sandbox | Bytes corretos; memória dentro da NFR-01 |
| **T-13** | Pré-visualizar objetos PNG, JSON, CSV, PDF, MP4, HTML e SVG | Emulador | Os cinco primeiros embutidos; HTML e SVG só como texto ou anexo |
| **T-14** | Ligar o versionamento, sobrescrever um objeto, listar versões não atuais, restaurar uma | Sandbox | Versões listadas; a restauração funciona |
| **T-15** | Excluir um objeto num bucket com exclusão reversível; restaurá-lo | Sandbox | Restaurado com a mesma geração |
| **T-16** | Adicionar uma regra de ciclo de vida "excluir após 30 dias" e uma regra de CORS | Sandbox | Configurações salvas; a visão JSON confere |
| **T-17** | Renomear uma pasta num bucket com namespace hierárquico | Sandbox | Pasta renomeada numa única operação |
| **T-18** | Gerar uma URL assinada com uma chave de conta de serviço e depois com uma credencial de usuário | Sandbox | Oferecida para a chave; não oferecida para a credencial de usuário sem `signBlob` |
| **T-19** | Com um perfil somente leitura, tentar observar, pull-and-ack, upload e exclusão | Emulador | Todos rejeitados com `READ_ONLY` |

---

## 10. Plano de entrega

| Passo | Entregável | Depende de |
|---|---|---|
| M4.1 | Tópicos, assinaturas, publicação, espiar e observar do Pub/Sub | M0 |
| M4.2 | Aba de dead letter e reenvio, seek e snapshots, schemas | M4.1 |
| M4.3 | Buckets do Cloud Storage e configurações | M0 |
| M4.4 | Navegador de objetos, transferências, pré-visualizações, versões, exclusão reversível, pastas, URLs assinadas | M4.3 |
| M4.5 | Filestore | M0 |

**Estado.** M4.1 e M4.2 (Pub/Sub completo) foram entregues antes do M3, a pedido do dono. Automatizados contra o emulador: T-01 a T-04 (`pnpm --filter @nephoscope/api test:emulator`) e, pela interface, criar tópico e assinatura, publicar, espiar, pull and acknowledge, observar, snapshot com seek de volta (T-08, que roda no emulador) e schema com validação de mensagem, além do axe nos dois temas (`apps/web/scripts/pubsub-smoke.mjs`). T-05 a T-07, T-09 e T-10 dependem da SPEC-0001 Q-02; T-19 fica para verificação manual. M4.3 e M4.4 (Cloud Storage) foram entregues em seguida, também antes do M3.
- Contra o `fake-gcs-server` (`pnpm --filter @nephoscope/api test:emulator`): bucket, upload em streaming com recusa de sobrescrita, navegação por prefixo, pasta, metadados, cópia e movimento, leitura por range, exclusão com falha por objeto e exclusão de bucket cheio.
- Pela interface (`apps/web/scripts/storage-smoke.mjs`): T-11 sem o arquivo de 2 GiB, T-13 sem o MP4, download, renomear, pastas, exclusão com a quantidade digitada, a requisição de T-16 (o emulador não guarda ciclo de vida nem CORS) e a exclusão de bucket cheio, além do axe nos dois temas.
- T-12 e T-14 a T-18 dependem da SPEC-0001 Q-02. M4.5 (Filestore) continua pendente.

---

## 11. Riscos e questões em aberto

### Riscos

| Id | Risco | Mitigação |
|---|---|---|
| **R-01** | Espiar perturba os consumidores ou manda mensagens para dead letter | Espiada pontual com nack imediato e o aviso (D-04); observar para visões ao vivo (D-05) |
| **R-02** | Assinaturas temporárias de observação ficam para trás | Excluídas ao fechar; expiração de 24 horas como rede de segurança; nome `nephoscope-watch-*` para serem reconhecíveis |
| **R-03** | Conteúdo guardado executa na origem do Nephoscope | D-12 e SPEC-0001 D-22 |
| **R-04** | Transferências muito grandes esgotam a memória | Só streaming (NFR-01, NFR-02) |

### Questões em aberto

Nenhuma.

---

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-09-28 | 0.1 | | Versão inicial, exportada do plano aprovado: D-01 a D-13, CA-01 a CA-14, NFR-01 a NFR-04, T-01 a T-19, R-01 a R-04. Espiar é uma ação pontual e as visões ao vivo usam uma assinatura temporária, porque pull e nack repetidos contam tentativas de entrega |
| 2026-09-28 | 0.2 | | **Tradução para o português** (SPEC-0001 D-26) |
| 2026-09-28 | 0.3 | | **Implementação do Pub/Sub (M4.1 e M4.2), antes do M3 a pedido do dono.**<br>• D-01: o emulador atende snapshots, seek e schemas; clientes de baixo nível com as opções resolvidas pelo de alto nível; cliente por projeto para o streaming pull.<br>• D-03: grants do dead letter adicionados pela página.<br>• D-04: prazo de 5 s no pull; confirmação do aviso uma vez por assinatura; dados como texto só quando UTF-8 válido.<br>• D-05: label `created-by: nimbus`; as listas escondem as assinaturas de observação.<br>• Estado dos cenários no plano de entrega. |
| 2026-09-29 | 0.4 | | **Implementação do Cloud Storage (M4.3 e M4.4).**<br>• D-09: endpoint do emulador passado explicitamente; lacunas do `fake-gcs-server`.<br>• D-10: tamanho na aba de métricas; exclusão de bucket cheio com contagem até 1.000.000 e operação local cancelável; bloqueio de retenção com metageração; IAM com `etag`.<br>• D-11: links de objeto `/api/o/{token}`; upload sem parser de JSON e com `ifGenerationMatch: 0`; pastas; versões.<br>• D-12: HTML, SVG e XML como código-fonte, servidos como texto e como anexo; política por resposta.<br>• Caminhos em `apps/api/src/modules`; estado dos cenários no plano de entrega. |

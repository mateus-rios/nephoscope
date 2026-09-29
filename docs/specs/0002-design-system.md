# SPEC-0002 — Design system

| | |
|---|---|
| **Status** | Rascunho |
| **Autor(es)** | |
| **Revisores** | |
| **Sistemas** | `apps/web` (`src/design`, `src/kit`, `src/app`) · `PRODUCT.md` · `DESIGN.md` · `.claude/skills/` · `skills-lock.json` |
| **Spec relacionada** | [SPEC-0001 — Plataforma](./0001-platform.md) (comportamento do shell e do kit de recursos) · todas as specs de produto |
| **Última atualização** | 2026-09-29 |
| **Versão** | 0.9 |

---

## 1. Resumo

O Nephoscope é construído com três skills de design para agentes de IA, como o usuário pediu: **as skills de Emil Kowalski** (emilkowal.ski/skill), **Impeccable** (impeccable.style) e **Taste Skill** (tasteskill.dev).

Esta spec registra como elas são instaladas, o que cada uma governa e como os conflitos entre elas se resolvem num console denso, usado muitas horas por dia. Dela decorrem as regras concretas: tokens, tipografia, cor, densidade, movimento, componentes, texto da interface, acessibilidade e os portões de qualidade que todo marco precisa passar.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Skills de Emil** | `emilkowalski/skill`: `emil-design-eng` (princípios), `animate`, `review-animations`, `improve-animations`, `find-animation-opportunities`, `prototype`, `animation-vocabulary`, `apple-design`, `pick-ui-library`, `ask-sonner`. |
| **Impeccable** | `pbakaus/impeccable`: o vocabulário `/impeccable <comando>` (init, shape, craft, document, extract, critique, audit, polish, harden, onboard, bolder, quieter, distill, animate, colorize, typeset, layout, delight, overdrive, clarify, adapt, optimize, live, generate) e um detector determinístico com 61 regras de antipadrão. |
| **Taste Skill** | `Leonxlnx/taste-skill`: `design-taste-frontend` (v2, a padrão) e variantes como `full-output-enforcement`, `redesign-existing-projects` e a minimalista. Três dials: `DESIGN_VARIANCE`, `MOTION_INTENSITY`, `VISUAL_DENSITY`. |
| **PRODUCT.md** | Arquivo de contexto de produto do Impeccable: usuários, propósito, contexto de operação, restrições, voz, princípios. Escrito pelo `/impeccable init`. |
| **DESIGN.md** | Arquivo de sistema visual do Impeccable: valores concretos de tokens, tipografia, forma, movimento, inventário de componentes. Escrito pelo `/impeccable document`. |
| **Detector** | `npx impeccable detect`, que varre o código atrás de antipadrões. Código de saída 0 significa sem achados primários; 2 significa achados. |
| **Token** | Um valor de design nomeado (cor, tamanho, duração, curva) exposto como propriedade CSS customizada e como valor de tema do Tailwind v4. |
| **Classe de frequência** | Com que frequência o usuário dispara uma interação (F1 a F4, D-10). Decide se ela anima. |
| **StatusGlyph** | O componente que mostra o estado de um recurso como forma, cor e rótulo de texto. |
| **Estado de problema** | O componente que renderiza um problem (SPEC-0001 CA-28) com a correção que ele permite. |

---

## 3. Problema

Interfaces feitas por IA tendem ao mesmo visual genérico: fontes padrão, gradientes roxos, cards aninhados, chips por toda parte, movimento saltitante. Um console de nuvem precisa do oposto. Engenheiros o deixam aberto por horas, navegam pelo teclado, varrem tabelas densas e nunca podem ler errado um estado ou confirmar a exclusão errada. E ele cobre mais de 40 produtos, então qualquer inconsistência se multiplica.

As três skills trazem opiniões fortes, às vezes conflitantes. Sem uma conciliação escrita, cada tela seguiria a regra que tivesse sido carregada por último.

---

## 4. Objetivos

1. Uma interface calma, densa e precisa, com cara de ferramenta feita para especialistas, não de landing page.
2. Uma única linguagem visual e de interação em todos os produtos.
3. Movimento que só dá feedback e continuidade, nunca espera: nada anima em ações frequentes ou de teclado.
4. WCAG 2.2 AA nos temas claro e escuro.
5. Portões automáticos que mantêm as regras de pé conforme o produto cresce.

### Não-objetivos

- Páginas de marketing, seções hero, ilustrações ou storytelling de marca.
- Layouts mobile-first. O Nephoscope é desktop-first e legível em celulares (SPEC-0001 NFR-07).
- Usar os ícones de produto, logos ou a identidade visual do Google.

---

## 5. Decisões tomadas

### D-01 — As três skills ficam instaladas no escopo do projeto

Instalação feita em 2026-09-28, a partir da raiz do repositório:

| Skill | Comando | Instalado |
|---|---|---|
| Emil | `npx skills add emilkowalski/skill -a claude-code -s '*' -y --copy` | `emil-design-eng`, `animate`, `animation-vocabulary`, `apple-design`, `ask-sonner`, `find-animation-opportunities`, `improve-animations`, `pick-ui-library`, `prototype`, `review-animations`. As skills para apps nativos (`write-swift`, `mobile-native`, `animate-expo`) foram removidas por não se aplicarem a um console web. |
| Taste | `npx skills add https://github.com/Leonxlnx/taste-skill -a claude-code -s design-taste-frontend -s full-output-enforcement -s redesign-existing-projects -y --copy` | `design-taste-frontend`, `full-output-enforcement`, `redesign-existing-projects` |
| Impeccable | `npx skills add pbakaus/impeccable -a claude-code -s impeccable -y --copy` | `impeccable` 4.4.0 |

- **`--copy`** grava os arquivos direto em `.claude/skills/`, evitando o problema de links simbólicos no Windows e o bug em que o `skills add` no escopo de projeto não cria o link em `.claude/skills/` (vercel-labs/skills #1355).
- **O instalador próprio do Impeccable falhou** (`npx impeccable install -y --providers=claude --scope=project` → "Could not verify skill bundle: HTTP 404", issue #479 do projeto). Por isso a skill foi instalada pelo CLI genérico, que **não configura o hook de design** do Impeccable. O detector continua rodando pelo `impeccable` fixado como devDependency, em `pnpm check` e no CI (G1). Quando o problema for corrigido, `npx impeccable install` adiciona o hook (R-04).
- **`skills-lock.json`** registra a origem e o hash de cada skill instalada, e é versionado com o código.
- **As pastas das skills não entram no repositório público** (`.claude/skills/` está no `.gitignore`). São trabalho de terceiros, sob as licenças de cada projeto, e o Nephoscope é publicado sob Apache-2.0 (SPEC-0001 D-28). Quem clona o repositório reinstala as skills com os comandos da tabela acima; o `skills-lock.json` diz quais e de onde.

**Racional:** instalar no escopo do projeto deixa as skills disponíveis em toda sessão que trabalhe no Nephoscope. Versionar só o `skills-lock.json` registra quais skills guiam o design sem redistribuir o trabalho de terceiros.

### D-02 — O que cada skill governa e como os conflitos se resolvem

| Área | Governada por | Observação |
|---|---|---|
| Movimento: se anima, com que velocidade, com qual curva | **Emil** | O modelo de frequência (D-10) é obrigatório |
| Escolha de bibliotecas | **Emil** `pick-ui-library` | Categorias que a lista dele não cobre são escolhidas explicitamente (D-04) |
| Antipadrões visuais, tipografia, cor, layout, texto de UX, auditorias | **Impeccable** | O detector é um portão de CI (D-16); o modo da superfície é **Operate** |
| Higiene de texto, paridade de tema escuro, layout de formulário, checklist de pré-voo, nada de saída incompleta | **Taste** (só regras universais) | Ver abaixo |

**A Taste v2 declara dashboards, tabelas de dados, painéis administrativos e editores de código fora do seu escopo** e os encaminha a design systems. O Nephoscope é exatamente esse tipo de interface. Por isso:
- As regras de layout, variância e movimento da Taste, escritas para landing pages, **não** se aplicam.
- As regras universais dela **se aplicam**:
  - proibição de travessão;
  - paridade de contraste entre os dois temas;
  - rótulo acima do campo e erro abaixo;
  - nada de borda dupla em linhas de lista;
  - o checklist de pré-voo;
  - a regra de saída completa (sem placeholders, sem stubs de TODO, sem implementação truncada).
- Se a `design-taste-frontend` for invocada, o briefing é "ferramenta densa para desenvolvedores", mirando `DESIGN_VARIANCE 2`, `MOTION_INTENSITY 2`, `VISUAL_DENSITY 9`.
- A variante minimalista **não é usada**: o padding de 24 a 40 px, as serifadas editoriais e as revelações ao rolar contradizem a densidade de console.

**Racional:** cada skill é mais forte na sua área. O próprio texto da Taste diz que ela não cobre esse tipo de produto, e aplicar as regras de landing page dela iria contra a intenção do usuário. O Impeccable chama esse tipo de superfície de modo Operate, em que familiaridade e consistência valem mais que expressão.

### D-03 — Componentes próprios sobre Base UI e Tailwind v4

- As primitivas vêm do **Base UI** (`@base-ui/react` v1): headless, acessíveis, e com as convenções que os exemplos de Emil usam (`data-starting-style`, `data-ending-style`, `data-instant`, `--transform-origin`).
- A estilização é **Tailwind v4** com tokens em `@theme`, variantes com **cva** e junção de classes com **clsx**.
- O Nephoscope é dono dos seus componentes, em `src/design`. Nenhum pacote de biblioteca de componentes (registro do shadcn, Carbon, Material) é instalado.
- A densidade segue as convenções "produtivas" do Carbon (linhas compactas, escala tipográfica pequena, superfícies planas), sem usar o pacote nem o visual do Carbon.

**Racional:** o Base UI é a escolha de Emil e cabe no mapeamento "componentes próprios com Tailwind v4" da Taste. Ser dono dos componentes mantém o visual próprio e permite aplicar as regras de movimento e densidade em todo lugar. O Carbon é a referência da Taste para produtos densos em dados, então as convenções de densidade dele são emprestadas.

### D-04 — Bibliotecas

Da lista `pick-ui-library` de Emil: `@base-ui/react`, `cmdk`, `sonner`, `motion`, `react-virtuoso`, `recharts`, `liveline`, `zustand`, `clsx`, `class-variance-authority`, `shiki`, `@dnd-kit`, `@number-flow/react`.

Não cobertas pela lista, escolhidas explicitamente:

| Necessidade | Biblioteca | Por quê |
|---|---|---|
| Rotas | TanStack Router | Search params tipados guardam o estado das visões, então toda visão tem link profundo (SPEC-0001 CA-61) |
| Estado do servidor | TanStack Query | Cache, invalidação após operações, polling |
| Lógica de tabela | TanStack Table, renderizada com `react-virtuoso` | Lógica de ordenação, visibilidade e seleção, com o Virtuoso para listas grandes |
| Formulários | react-hook-form com zod | Compartilha os schemas zod de `packages/contracts` |
| Edição de código e diffs | Monaco (`monaco-editor`, carregado localmente, **fixado em 0.52.2**) com `monaco-yaml` | A Taste encaminha editores de código ao Monaco; validação por JSON Schema e YAML, editor de diff. A versão fica fixa porque o `monaco-yaml` 5.5 usa a API `createWebWorker` antiga, removida no Monaco 0.55. O worker de YAML entra por um arquivo local (`src/design/code/yaml.worker.ts`) e é pré-empacotado pelo Vite, para a dependência CJS dele funcionar em desenvolvimento |
| Junção de classes | `tailwind-merge` sobre `clsx` (`cn`) | Uma classe passada por quem usa o componente substitui a padrão em vez de competir com ela; configurado com os tamanhos de texto, cores e raios do Nephoscope |
| Datas | date-fns | Pequena, tree-shakeable |
| Ícones | Phosphor (`@phosphor-icons/react`) | Ver D-13 |
| Séries temporais densas (Metrics Explorer) | uPlot (canvas) | O Recharts renderiza SVG e fica lento com muitas séries de milhares de pontos; ver D-14 |

**Racional:** o usuário pediu a skill de Emil, e a lista dele é explícita em ficar dentro dela, a não ser que a categoria não esteja coberta. Cada acréscimo cobre uma categoria que a lista não cobre.

### D-05 — PRODUCT.md e DESIGN.md apoiam esta spec

- **PRODUCT.md** foi escrito pelo fluxo `init` do Impeccable em 2026-09-28, depois de uma rodada de confirmação com o dono (público, nome, idioma). Registra:
  - usuários: engenheiros e operadores, o dono e colegas, trabalhando a partir de arquivos de credencial;
  - contexto: aberto por horas, muito teclado, muitas abas, frequentemente durante incidentes;
  - princípios: verdade acima de decoração, segurança por padrão, densidade calma, rapidez nas mãos, honestidade sobre limites.
- Fica em inglês, porque é contexto de design para a skill e a interface é em inglês.
- **Caminho de construção:** code-first é o único caminho, porque não há geração de imagem disponível. Nada é gravado em `.impeccable/config.json`, já que a skill só grava valores que o usuário escolheu.
- O **DESIGN.md** é escrito pelo `/impeccable document` a partir dos tokens e componentes implementados, quando o kit existir.
- **Esta spec guarda as regras e decisões. O DESIGN.md guarda os valores concretos.** Se discordarem, esta spec prevalece e o DESIGN.md é regenerado.

**Racional:** os comandos do Impeccable leem os dois arquivos. Manter o "porquê" aqui e o "o quê exatamente" lá evita duas fontes da verdade.

### D-06 — Tipografia

- **Archivo** (variável, pesos 100 a 900, largura 62% a 125%) em todos os papéis da interface. **Martian Mono** (variável, pesos 100 a 800, largura 75% a 112,5%) apenas em ids, nomes de recurso, caminhos, código, logs, JSON e dados medidos. Auto-hospedadas com `@fontsource-variable`, só woff2; os subconjuntos latin das duas somam cerca de 128 KB.
- **Legendas** (rótulos de title block e cabeçalhos de tabela) usam a Archivo condensada (`font-stretch` por volta de 75%), em caixa alta por `text-transform` e com espaçamento aberto. É a letra técnica da folha de desenho (D-17). O texto de origem continua em caixa de sentença.
- Algarismos tabulares (`font-variant-numeric: tabular-nums`) onde números são comparados: tabelas, métricas, tamanhos, contagens, timestamps.
- Escala (tamanho/altura de linha, px): 11/14 legenda condensada, 12/16 metadados, **13/18 padrão denso** (tabelas, barras laterais, formulários em painéis), 14/20 corpo, 16/22 título de seção, 20/28 título de página.
- Pesos 400, 500 (rótulos, botões) e 600 (títulos). Nada mais pesado.
- Proibidas como face principal: Inter, Roboto, Arial, DM Sans, IBM Plex e pilhas de fonte padrão do sistema; faces display serifadas em itálico.

**Racional:**
- **Uma família, larguras diferentes.** No modo Operate, o Impeccable recomenda uma família bem ajustada com escala fixa de papéis. O eixo de largura da Archivo dá, na mesma família, o corpo de leitura e as legendas condensadas da folha de desenho. A Archivo foi desenhada para contextos técnicos e tem algarismos tabulares.
- **Por que não a Plex.** O `new-work` do Impeccable lista a IBM Plex entre os padrões de treinamento que indicam falta de escolha. A proposta anterior (Plex) foi, portanto, substituída.
- **A mono.** A Martian Mono também tem eixo de largura, então ids longos podem condensar sem trocar de face.

### D-17 — Mundo visual: a folha de desenho técnico

*Escolhido pelo dono em 2026-09-28, na rodada de direção do Impeccable (semente `ac8393d6`, direção sorteada "Drafting Sheet"). Contrato completo em `apps/web/.impeccable/surfaces/apps-web-src-app-shell-tsx.md`.*

**Tese:** todo recurso do Google Cloud é uma folha de desenho: um title block diz o que ele é e sob qual credencial, uma tabela de revisões diz o que mudou, e o redline marca o que está errado ou prestes a ser destruído. Recusa o padrão dos consoles de nuvem: barra superior colorida, trilho de ícones e dashboard de cards.

Elementos da folha, cada um com função:

| Elemento de desenho | No Nephoscope |
|---|---|
| Title block | Faixa superior (perfil, projeto, estado da chave) e cabeçalho de todo recurso (nome, id, location, revisão, estado, atualização), em células com legendas |
| Tabela de revisões | Revisões do Cloud Run, revisões de workflow, histórico de rulesets, Activity |
| Lista de materiais (BOM) | Listas de recursos, com coluna de item numerada; a home do projeto é a BOM dos produtos |
| Notas gerais | Condições e avisos numerados (API sem estado conhecido, somente leitura, projeto de cota), no lugar de faixas coloridas de alerta |
| Redline | Erros, diffs e ações destrutivas |
| Triângulo de revisão | Campo editado e ainda não salvo |
| Carimbo | Estados da folha: "Read-only", "Emulator" |
| Azul não reproduzível | Informação de construção e secundária: linhas de grade, seleção, foco, dicas |

- **Tema escuro:** blueprint, um azul-marinho de planta dessaturado, com traço claro.
- **Movimento:** a tinta assenta, não voa (D-10). Diagramas podem traçar as suas linhas uma vez, como uma plotter, na primeira montagem de uma visão rara.
- **Proibido:** grade de zonas na borda, carimbos decorativos, setas de cota e selos onde não carregam informação (seria fantasia).
- **Interação assinatura:** a prévia em redline. Antes de qualquer confirmação, a folha mostra em redline exatamente o que muda, marca cada campo editado com um triângulo de revisão, e o único controle de confirmação diz a consequência ("Deploy revision · 3 changes").

**Racional:** o dono escolheu a direção sorteada entre o próprio sorteio, a escolha do Impeccable (sala de controle ISA-101), um desafiante competitivo (bancada de osciloscópio) e o padrão da categoria. Cada elemento da folha corresponde a uma função real do console, o que atende ao modo Operate: a expressão nunca esconde a tarefa.

### D-18 — Um controle de confirmação por visão

*Elevação vinda do desafiante "bancada de hardware".*

Cada visão tem no máximo **um** controle que confirma (deploy, execute, save, delete), na única cor de ação saturada (variante `commit`), ou em redline quando destrói. Todo o resto fica em grafite (variantes `secondary` e `ghost`). Em builds de desenvolvimento, o kit avisa no console quando mais de um controle `commit` está montado na mesma visão.

**Racional:** numa tela densa, o olho precisa achar a ação que muda o mundo sem procurar; se tudo é primário, nada é.

### D-19 — Símbolo gerado a partir da chave de cada perfil

*Elevação vinda do desafiante "identidade gerativa".*

Cada perfil tem um **símbolo determinístico**:
- uma forma (círculo, triângulo, quadrado, losango, hexágono ou pentágono), escolhida por um hash do id da chave (ou do principal);
- as iniciais do principal;
- a cor da etiqueta do perfil.

Ele aparece no seletor de perfil, na faixa superior e na página Connections.

**Racional:** confundir o perfil de produção com o de desenvolvimento é o erro mais caro que o Nephoscope pode induzir. A cor sozinha não basta (daltonismo, etiquetas iguais); forma mais letras distinguem perfis com a mesma cor.

### D-20 — Lei da paleta

*Elevação vinda do desafiante "tela de arcade".*

Cada cor de estado tem **um único significado** no app inteiro: redline = erro e destruição; âmbar = aviso; verde = saudável e adição; azul não reproduzível = informação e seleção; cor de confirmação = a ação que confirma. As **etiquetas de cor de perfil são identidade, não estado**: aparecem só na faixa sob a barra superior e no símbolo do perfil (D-19), nunca em glifos de estado.

### D-21 — Denso no bloco, generoso entre blocos; seleção ligada

*Elevações vindas dos desafiantes "pedreira de nuvem" e "folha dobrável".*

- **Blocos:** dentro de um bloco, o espaçamento é apertado (4 a 8 px); entre blocos, generoso (32 a 40 px), com uma linha fina e o título do bloco. Blocos nunca ganham caixa com borda (D-09).
- **Seleção ligada:** escolher uma revisão, um intervalo de tempo ou um recurso numa página propaga a escolha para todo painel ligado da mesma página (métricas, logs, tráfego), pelo contexto de seleção do kit.

**Racional:** densidade sem espaço entre blocos vira muro de texto. A seleção ligada é o que faz uma página de recurso responder como um instrumento só, e não como painéis soltos.

### D-07 — Cor

- Toda cor é um token **OKLCH**. Componentes nunca usam valores de cor crus (CA-03).
- **Tema claro, filme de desenho:** um quase branco frio com tinta, e texto em **grafite** (nada de preto ou cinza puros).
- **Tema escuro, blueprint:** um azul-marinho profundo e dessaturado, com traço quase branco (nunca `#000`).
- **Azul não reproduzível** (claro, de baixo croma) para construção: linhas de grade, tinta de seleção, halo de foco, informação secundária.
- **Cor de confirmação:** cobalto saturado (matiz por volta de 262), reservado ao único controle de confirmação da visão (D-18). Links são grafite sublinhado, não azuis.
- **Cores semânticas:** ok (verde), aviso (âmbar), erro e destruição (redline), info (azul não reproduzível), neutro (grafite). Cada uma tem cor de primeiro plano, um fundo sutil e um valor de borda, ajustados por tema, e um único significado (D-20).
- **Etiquetas de cor de perfil:** cinza, azul, verde, âmbar, vermelho, violeta. São identidade, não estado (D-20): aparecem como amostra, no símbolo do perfil (D-19) e como a linha de 2 px sob a barra superior (SPEC-0001 CA-59).
- **Proibidos:** gradientes decorativos (em especial roxo para azul), brilhos escuros, glassmorphism, texto cinza apagado sobre fundo colorido, o "bege de IA".
- Os dois temas são de primeira classe e passam nas mesmas checagens de contraste (D-15).

Os valores exatos saem do `/impeccable colorize` e ficam registrados no DESIGN.md.

**Racional:** as regras de cor do Impeccable (OKLCH, neutros tingidos), e um único acento mantém a atenção nos dados. As cores semânticas são as únicas saturadas que aparecem com frequência, o que torna o estado fácil de varrer com os olhos.

### D-08 — Densidade e espaçamento

- Grade de 4 px. Tokens de espaçamento são múltiplos de 4.
- Os modos de densidade mudam as alturas de linha e de controle:

| Modo | Linha de tabela | Controle | Uso |
|---|---|---|---|
| Compact | 28 px | 28 px | Opcional, para listas muito grandes |
| **Default** | **32 px** | **32 px** | Em todo lugar |
| Comfortable | 40 px | 36 px | Opcional |

- Padding de página de 24 px (16 px abaixo de 1280 px). Espaço entre seções da página de 24 px. Formulários com no máximo 720 px de largura; tabelas usam a largura toda.
- Páginas de detalhe mostram uma coluna lateral de fatos principais a partir de 1440 px de largura.

**Racional:** a própria escala de densidade da Taste coloca dashboards densos no topo. Linhas de 32 px cabem cerca de duas vezes mais linhas que uma tabela SaaS típica, mantendo alvos de 24 px (D-15).

### D-09 — Forma e elevação

- Raio: 4 px em controles, 6 px em menus e popovers, 8 px em diálogos e painéis deslizantes. Chips de filtro e etiquetas de perfil podem ser totalmente arredondados.
- Superfícies são planas e separadas por bordas finas de 1 px. Sombras só em sobreposições (menus, popovers, diálogos, painéis deslizantes, toasts), suaves e de baixa opacidade.
- **Nada de cards aninhados.** Uma página tem seções separadas por títulos e linhas finas. Um painel com borda nunca contém outro painel com borda.
- **Nada de bordas laterais de aba.** Um item ativo (entrada da barra lateral, seleção de lista) ganha preenchimento tingido e texto mais forte, não uma borda colorida à esquerda. Abas mantêm um indicador inferior.
- Linhas de tabela são separadas por uma única linha fina, nunca por borda superior e inferior.

**Racional:** as regras de aninhamento de cards e de borda lateral do Impeccable, e a regra de borda dupla da Taste. Superfícies planas mantêm as telas densas calmas.

### D-10 — Movimento

O modelo de Emil é obrigatório. Se algo anima depende, antes de tudo, de com que frequência o usuário o dispara:

| Classe | Frequência | Exemplos no Nephoscope | Movimento |
|---|---|---|---|
| **F1** | 100+ por dia | Paleta de comandos, atalhos `g`, `j`/`k`, filtrar enquanto digita, troca de aba, mudança de rota, navegação na barra lateral | **Nenhum, nunca.** Ações iniciadas pelo teclado nunca animam. |
| **F2** | Dezenas por dia | Hover, menus, selects, tooltips, expandir nós de JSON, toggles | Mínimo: cor e opacidade em no máximo 150 ms; menus escalam a partir de 0,97 com opacidade em 150 ms |
| **F3** | Ocasional | Diálogos, painéis deslizantes, toasts, bandeja de operações, confirmações | Padrão, de 200 a 300 ms |
| **F4** | Raro ou primeira vez | Connections no primeiro uso, primeira abertura de projeto | Pode ter um toque de encanto: stagger de 30 a 50 ms só na primeira montagem |

Tokens e regras:
- **Curvas:** `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` para entrar e sair, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` para movimento na tela, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` para painéis deslizantes, `ease` para hover e mudanças de cor, `linear` para movimento constante (spinners, progresso indeterminado). **Nunca `ease-in`.** Nada de curvas elásticas ou com quique.
- **Durações:** pressionar botão 160 ms; tooltips 125 ms; menus e selects 150 ms (saída 100 ms); diálogos 200 ms (saída 150 ms); painéis deslizantes 250 ms (saída 200 ms). **A saída é sempre mais rápida que a entrada.**
- **Escala e origem:**
  - Nada escala a partir de 0: entra a partir de `scale(0.97)` com `opacity: 0`.
  - Popovers e menus escalam a partir do gatilho (`transform-origin: var(--transform-origin)`). Diálogos ficam centralizados.
  - Elementos pressionáveis escalam para 0,97 em `:active`.
- **Tooltips:** o primeiro espera 500 ms para abrir; depois que um fecha, os outros abrem na hora por 300 ms (`data-instant`, sem transição).
- **Desempenho:**
  - UI dinâmica (toasts, linhas ao vivo, bandeja de operações) usa transições CSS, não keyframes, para poder ser interrompida.
  - Só `transform` e `opacity` animam. Com Motion, usar strings `transform` completas, não os atalhos `x`/`y`.
- **Hover** fica restrito a `@media (hover: hover) and (pointer: fine)`.
- **Movimento reduzido:** transforms são removidos; mudanças de opacidade e de cor ficam. Spinners continuam, como estado essencial.
- **Linhas atualizadas ao vivo** (tail de logs, listen do Firestore, observação do Pub/Sub) mostram uma tinta que aparece na hora e some em 1.000 ms.
  - É a única exceção documentada à regra de "menos de 300 ms": não responde a uma ação, marca o que mudou, e precisa ficar visível tempo suficiente para ser notada.
  - Como só muda cor, também permanece com movimento reduzido.

**Racional:** um console é o caso clássico da regra de frequência de Emil: a maior parte das interações acontece centenas de vezes por dia, e qualquer animação nelas vira atrito.

### D-11 — Estado é glifo e palavra, nunca sopa de chips

- O estado de um recurso é sempre renderizado pelo **StatusGlyph**: uma forma, uma cor e um rótulo de texto.

| Estado | Glifo | Cor |
|---|---|---|
| Pronto, sucesso, ativo | Check num círculo | ok |
| Aviso, degradado | Triângulo | aviso |
| Falhou, erro | Xis num círculo | erro |
| Em andamento, em deploy, em progresso | Spinner (linear) | acento |
| Pendente, na fila | Círculo vazio | neutro |
| Pausado, desabilitado, parado | Pausa num círculo | neutro |
| Desconhecido | Interrogação num círculo | neutro |

- **Nada de pontos pulsantes** para estados em andamento (antipadrão do Impeccable).
- Um estado por linha. Chips coloridos só em filtros e em labels de recurso (como chips mono neutros).
- Cor nunca é o único sinal: a forma e a palavra também carregam o significado.

**Racional:** o Impeccable aponta a "sopa de chips de estado" e os pontos pulsantes. Forma mais rótulo mantém o estado legível para daltônicos e em tabelas densas.

### D-12 — Texto da interface

- **Nada de travessão (—) nos textos da interface** (Taste). Meia-risca (–) só entre números.
- Caixa de sentença em tudo: títulos, rótulos, botões, itens de menu. **Única exceção:** as legendas da folha de desenho (rótulos de title block e cabeçalhos de tabela) aparecem em caixa alta por CSS (D-06, D-17); o texto de origem continua em caixa de sentença, e leitores de tela o leem normalmente.
- Condições e avisos de página são **notas gerais numeradas** (D-17), com o glifo do estado, e não faixas coloridas.
- Botões dizem exatamente o que fazem, com verbo e objeto: "Deploy revision", "Execute job", "Delete 3 documents". Nunca "Submit", "Continue", "OK", "Yes" ou "No".
- Mensagens de erro dizem o que aconteceu, o porquê quando se sabe, e o que fazer: "Cloud Run Admin API is disabled in project acme-prod. Enable it to see services."
- Estados vazios dizem o que é a coisa e como criar a primeira.
- Sem pontos de exclamação. Sem palavras de marketing ("seamless", "effortless", "powerful", "unleash", "supercharge").
- Nomes de produtos do Google são usados como o Google os escreve, de forma descritiva (Cloud Run, Firestore).
- Nomes de recurso, ids e caminhos em mono.
- **Formatos:**
  - Tamanhos usam unidades binárias com rótulos IEC (KiB, MiB, GiB).
  - Durações são compactas em tabelas ("1m 12s") e por extenso em frases.
  - Timestamps mostram tempo relativo em tabelas ("3 min ago") com o horário absoluto, local e UTC, no hover.

**Racional:** a proibição de travessão da Taste e as regras do Impeccable contra CTAs genéricos e mensagens vagas. Texto preciso também é segurança: "Delete 3 documents" diz a consequência, "OK" não.

### D-13 — Ícones

Phosphor, peso regular, em 16 px na UI densa e 20 px em cabeçalhos. Uma única família em todo lugar. Sem emoji. Sem logos coloridos de produto: os produtos são identificados por um glifo monocromático e pelo nome.

**Racional:** um traço consistente mantém calmas as telas densas. Os ícones de produto do Google são ativos de marca (não-objetivo de §4).

### D-14 — Visualização de dados

- Todo gráfico segue a skill **dataviz**: heurística de forma, paleta validada, especificação de marcas, regras de interação, os dois temas.
- **Recharts** nos gráficos predefinidos das abas Metrics dos recursos: poucas séries, e o servidor alinha os dados do Cloud Monitoring para que cada série tenha no máximo cerca de 300 pontos (SPEC-0005).
- **uPlot** no Metrics Explorer, onde uma consulta pode devolver muitas séries com milhares de pontos cada. Estilizado com os mesmos tokens, para os dois tipos de gráfico parecerem um só sistema.
- **Liveline** só em visões explicitamente ao vivo, com os recursos decorativos (partículas, setas de momento) desligados.
- Números que mudam no lugar podem usar NumberFlow, mas só em contextos F3 e F4, nunca em tabelas que atualizam com frequência.

**Racional:** as escolhas de gráfico de Emil, com a skill dataviz como método, para os gráficos parecerem um só sistema.

### D-15 — Base de acessibilidade

WCAG 2.2 AA:
- Contraste de pelo menos 4,5:1 para texto, e 3:1 para texto grande, componentes de UI e indicadores de foco, nos dois temas.
- Um anel de foco visível de 2 px, com afastamento, em todo elemento focável.
- Alvos de pelo menos 24 × 24 px, inclusive ações de ícone dentro de linhas densas.
- Tudo alcançável e operável pelo teclado. O Base UI fornece os padrões ARIA; tabelas são tabelas de verdade ou grids ARIA com suporte a teclado.
- Toasts e conclusões de operação são anunciados em live regions.
- Botões só de ícone têm nome acessível. Erros de formulário são ligados com `aria-describedby`.
- Movimento reduzido respeitado (D-10). Cor nunca é o único sinal (D-11).

### D-16 — Portões de qualidade em todo marco

Um marco só fecha quando:

| Portão | Checagem |
|---|---|
| **G1** | `npx impeccable detect --json apps/web/src` sai com 0. Exceções são inline (`impeccable-disable-next-line <regra>: <motivo>`), sempre com motivo. Roda no CI. |
| **G2** | `/impeccable critique`, `/impeccable audit`, `/impeccable harden` e `/impeccable polish` rodaram nas telas novas do marco. Os achados foram corrigidos ou registrados com motivo no histórico desta spec. |
| **G3** | O `review-animations` de Emil rodou em todo movimento alterado, e cada linha da tabela Antes/Depois/Por quê dele foi tratada. |
| **G4** | O checklist de pré-voo da Taste passa nos itens universais: zero travessões nos textos da interface, contraste AA, rótulos acima e erros abaixo, movimento reduzido tratado, os dois temas conferidos, sem placeholders. |
| **G5** | Os snapshots visuais do Playwright de `/_kit` (claro, escuro, movimento reduzido) batem, e o axe não aponta violações sérias ou críticas nas páginas do marco. O axe roda em `apps/web/e2e/a11y.spec.ts` (WCAG 2.2 A e AA, cada página do marco nos dois temas); a suíte do Playwright roda contra `vite build` e `vite preview`, com a API simulada por fixtures. |
| **G6** | Um lint de tokens não encontra valores de cor crus (hex, `rgb()`, `hsl()`, literais `oklch()`) fora do arquivo de tokens. |

**Racional:** regras sem portões se desgastam. G1 e G6 são determinísticos; G2 a G4 trazem o julgamento das skills para cada marco.

---

## 6. Escopo

### Dentro
Tokens, fontes, ícones, primitivas, o comportamento visual do kit de recursos, movimento, texto da interface, acessibilidade, gráficos, a página `/_kit`, PRODUCT.md, DESIGN.md, as skills instaladas e os portões de qualidade.

### Fora
Comportamento do shell e do kit (SPEC-0001 §8.10 e §8.11). As telas de produto (specs de produto), que devem seguir esta spec.

---

## 7. Requisitos

### 7.1 Tokens e temas

**CA-01** — Os tokens ficam em `apps/web/src/design/tokens.css` como propriedades CSS customizadas, expostas ao Tailwind v4 via `@theme`. Há um conjunto claro e um escuro com os mesmos nomes.

**CA-02** — Os tokens de cor são semânticos (`--bg`, `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-subtle`, `--accent`, `--accent-fg`, `--accent-tint`, `--ok`, `--ok-tint`, `--warn`, `--warn-tint`, `--error`, `--error-tint`, `--focus`, `--selection`, cores das etiquetas de perfil). Os componentes usam só esses.

**CA-03** — Nenhum arquivo de componente contém literal de cor crua (G6).

**CA-04** — A escolha de tema (sistema, claro, escuro) é aplicada antes da primeira pintura por um script da mesma origem (SPEC-0001 CA-60). Trocar de tema não anima.

**CA-05** — Os tokens de movimento (`--ease-out`, `--ease-in-out`, `--ease-drawer` e as durações da D-10) são definidos uma vez e usados por todos os componentes.

### 7.2 Tipografia e layout

**CA-06** — As fontes são woff2 auto-hospedadas com `font-display: swap`, só latin e latin-ext, com no máximo 200 KB para todas as faces usadas na primeira carga.

**CA-07** — Tabelas, métricas, tamanhos e timestamps usam algarismos tabulares. Números ficam alinhados à direita nas tabelas.

**CA-08** — Ids, nomes de recurso, caminhos, JSON, logs e código usam a face mono.

**CA-09** — O modo de densidade é uma preferência do usuário (padrão "Default"), aplicada por tokens, e muda apenas as alturas de linha e de controle.

### 7.3 Componentes

**CA-10** — **Button**: variantes primary, secondary, ghost e danger; tamanhos 28, 32 e 36 px. Em `:active` escala para 0,97 em 160 ms. Carregando, um spinner substitui o ícone sem mudar a largura. Um botão desabilitado explica o porquê numa dica quando o motivo é conhecido (capacidade, somente leitura).

**CA-11** — **Campos de formulário**: rótulo acima, texto de ajuda abaixo, erro abaixo no lugar do texto de ajuda, ligado com `aria-describedby`. A validação roda ao sair do campo e ao enviar, não a cada tecla. Campos obrigatórios são marcados.

**CA-12** — **Select e Combobox**: busca ao digitar, suporte completo a teclado, opções virtualizadas para listas longas (regiões, papéis, contas de serviço).

**CA-13** — **Menu e Popover**: entram a partir de `scale(0.97)` e opacidade em 150 ms com `--ease-out`, saem em 100 ms, com origem no gatilho.

**CA-14** — **Tooltip**: 500 ms de atraso no primeiro; imediato nos seguintes dentro de 300 ms; transição de 125 ms; nunca é o único lugar de uma informação essencial.

**CA-15** — **Dialog**: centralizado, entra a partir de `scale(0.97)` e opacidade em 200 ms, sai em 150 ms, prende o foco, fecha com Escape, devolve o foco ao gatilho.

**CA-16** — **Sheet** (painel deslizante): entra pela direita em 250 ms com `--ease-drawer`, sai em 200 ms. Usado para editar um recurso sem sair da lista dele.

**CA-17** — **Toast** (Sonner): canto inferior direito, no máximo 3 visíveis, sucesso some após 4 s, erros ficam até serem dispensados, ação opcional, temporizadores pausam no hover e em abas ocultas.

**CA-18** — **Tabs**: trocar de conteúdo nunca anima (F1). A aba ativa tem indicador inferior.

**CA-19** — **ResourceTable**:
- linhas de 28, 32 ou 40 px conforme a densidade; cabeçalho fixo; colunas redimensionáveis; indicadores de ordenação;
- tinta de hover (restrita a ponteiros finos) e tinta de seleção mais forte;
- teclado: `j`/`k` movem, `x` seleciona, `Enter` abre, Shift+clique seleciona um intervalo;
- células longas truncam e mostram o valor completo numa dica; ids oferecem cópia no hover;
- linhas separadas por uma única linha fina.

**CA-20** — **StatusGlyph** implementa a D-11, com o rótulo sempre visível, exceto na coluna estreita de estado, onde o rótulo vai para a dica e para o nome acessível.

**CA-21** — **Skeletons** só aparecem quando o carregamento passa de 300 ms, seguem a forma do conteúdo e não têm brilho nem pulsação.

**CA-22** — **EmptyState**: no máximo um ícone, um título, uma frase e a ação principal. Sem ilustrações.

**CA-23** — **ProblemState** renderiza cada código de problem com a sua correção:
- `API_DISABLED` ganha o botão Enable;
- `PERMISSION_DENIED` nomeia a permissão, com botão de copiar e link para o IAM;
- `NOT_FOUND` oferece o caminho de volta;
- `UNAVAILABLE` e `DEADLINE_EXCEEDED` oferecem Retry.

**CA-24** — **ConfirmDestructive**: diz a consequência numa frase, mostra o que será afetado, pede o nome ou a quantidade digitados (SPEC-0001 D-13), mantém o botão de perigo desabilitado até bater e mostra o comando equivalente.

**CA-25** — **JsonTree**: virtualizado, recolhível, pesquisável, com cópia de valor ou caminho, tipos de valor distinguidos por cor e por um rótulo de tipo, strings longas truncadas com controle para expandir.

**CA-26** — **CodeView** (shiki) e **CodeEditor**/**DiffEditor** (Monaco) compartilham um tema gerado a partir dos tokens e a face mono em 13 px. O minimapa fica desligado. A quebra de linha pode ser alternada. O diff é lado a lado a partir de 1200 px e embutido abaixo disso.

**CA-27** — **TimeRangePicker**: atalhos (5 min, 15 min, 1 h, 6 h, 12 h, 1 dia, 7 dias, 30 dias) e um intervalo absoluto personalizado com fuso horário. Intervalos relativos continuam relativos na URL.

**CA-28** — **FilterBar**: filtro de texto e chips removíveis para as facetas, com "Clear all".

**CA-29** — **Paleta de comandos**: 640 px de largura, a 20% do topo, sem animação de abrir ou fechar, resultados agrupados com destaque da correspondência, dicas de teclado no rodapé.

**CA-30** — **Barra lateral**: o item ativo tem preenchimento tingido e texto mais forte (sem borda à esquerda). Os rótulos de grupo são pequenos, apagados, em caixa de sentença.

**CA-31** — **Barra superior**: 48 px de altura, com a faixa do perfil (SPEC-0001 CA-59) como uma linha de 2 px abaixo dela.

**CA-32** — A **página `/_kit`** (só em builds de desenvolvimento) mostra todo componente em todo estado e variante, nos dois temas e em todos os modos de densidade. Os tokens de tema valem para qualquer subárvore com `data-theme`, então a página mostra as duas pranchas (A: filme de desenho; B: blueprint) lado a lado na rolagem. É a referência dos testes visuais (G5).

### 7.4 Movimento, texto e acessibilidade

**CA-33** — Toda animação no código segue a D-10. `transition: all` é proibido; as propriedades são listadas explicitamente.

**CA-34** — Os textos da interface não contêm travessão (G4), nem rótulos genéricos de botão, e seguem a D-12.

**CA-35** — Toda página atende à D-15; o axe não aponta violações sérias ou críticas (G5).

---

## 8. Requisitos não-funcionais

| Id | Requisito |
|---|---|
| **NFR-01** | Animações rodam a 60 fps e só em `transform` e `opacity` (a tinta de linha ao vivo é uma mudança de cor num único elemento e fica isenta). |
| **NFR-02** | O carregamento de fontes não causa deslocamento de layout além das métricas do `font-display: swap`; o deslocamento cumulativo de layout do shell fica abaixo de 0,02. |
| **NFR-03** | O design system acrescenta no máximo 60 KB gzip de CSS e JS ao shell, sem contar Monaco, gráficos e fontes. |

---

## 9. Cenários de teste

| Id | Cenário | Esperado |
|---|---|---|
| **T-01** | Rodar o detector em `apps/web/src` | Sai com 0 |
| **T-02** | Buscar "—" nos textos da interface | Nenhuma ocorrência |
| **T-03** | Abrir e fechar a paleta de comandos com Ctrl+K | Abre e fecha na hora, sem transição |
| **T-04** | Passar o mouse por uma série de botões de barra de ferramentas com tooltips | Primeira tooltip após 500 ms; as seguintes na hora |
| **T-05** | Abrir um menu a partir de um botão perto do canto inferior direito | Escala a partir do canto do gatilho em 150 ms; saída mais rápida |
| **T-06** | Ligar o movimento reduzido e abrir um diálogo, um painel deslizante e um menu | Sem escala nem deslize; só opacidade; spinners continuam girando |
| **T-07** | Observar uma visão ao vivo do Firestore enquanto um documento muda | A tinta da linha aparece e some em 1 s; a linha não se move |
| **T-08** | Conferir todo estado de `/_kit` com o axe nos temas claro e escuro | Nenhuma violação séria ou crítica |
| **T-09** | Medir o contraste de todo par de tokens de texto e de UI nos dois temas. Automatizado em `scripts/check-tokens.mjs` (`pnpm design:tokens`, parte do `pnpm check`), que também aplica o G6 e a parte de travessões do G4 | AA atendido (4,5:1 texto, 3:1 UI e texto grande) |
| **T-10** | Navegar com Tab por uma página de lista e por um formulário | Todo controle alcançável, anel de foco visível, ordem lógica |
| **T-11** | Usar uma página de lista numa tela de toque | Sem efeitos de hover grudados |
| **T-12** | Rodar o lint de tokens | Nenhum literal de cor crua fora de `tokens.css` |
| **T-13** | Comparar os snapshots de `/_kit` (claro, escuro, movimento reduzido) com a referência | Nenhuma diferença não revisada |
| **T-14** | Carregar o shell com cache frio | Nenhum deslocamento por causa das fontes além do orçamento da NFR-02 |

---

## 10. Plano de entrega

| Marco | Entregável |
|---|---|
| **M0** | Skills instaladas (D-01); PRODUCT.md (D-05); tokens, fontes e ícones; todas as primitivas de §7.3; `/_kit`; passadas de `/impeccable typeset` e `/impeccable colorize`; DESIGN.md; portões G1 a G6 ligados ao `pnpm check` e ao CI |
| **M1 a M7** | Portões G1 a G6 nas telas novas de cada marco. `/impeccable shape` antes de cada tela L3. O M7 acrescenta um `/impeccable audit` do app inteiro, o `improve-animations` de Emil e um `/impeccable polish` no app todo |

---

## 11. Riscos e questões em aberto

### Riscos

| Id | Risco | Mitigação |
|---|---|---|
| **R-01** | As skills evoluem; a Taste v2 está marcada como experimental | `skills-lock.json` registra as versões instaladas; revisar as mudanças antes de atualizar (`npx skills update`) |
| **R-02** | Falsos positivos do detector atrasam o trabalho | Exceções inline com motivo; exceções revisadas a cada marco |
| **R-03** | A densidade prejudica a leitura para alguns usuários | Modos de densidade (D-08) e os portões de contraste |
| **R-04** | O hook de design do Impeccable não está instalado, porque o instalador dele falhou upstream (issue #479) | O detector roda em `pnpm check` e no CI (G1); rodar `npx impeccable install -y --providers=claude --scope=project` quando o problema for corrigido |

### Questões em aberto

Nenhuma. Mudanças na proposta de tipografia ou de cor depois das passadas de `/impeccable typeset` e `/impeccable colorize` ficam registradas no histórico de revisões.

---

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-09-28 | 0.1 | | Versão inicial, exportada do plano aprovado: D-01 a D-16, CA-01 a CA-35, NFR-01 a NFR-03, T-01 a T-14, R-01 a R-03. O conteúdo das skills foi lido de emilkowal.ski/skill (emil-design-eng, pick-ui-library), de impeccable.style e seu repositório e de tasteskill.dev, com os arquivos taste-skill v2, minimalist-skill e output-skill |
| 2026-09-28 | 0.2 | | D-04 e D-14: uPlot (canvas) acrescentado para o Metrics Explorer, fora da lista de Emil, porque o Recharts (SVG) não escala para muitas séries densas; o Recharts continua nas abas Metrics predefinidas |
| 2026-09-28 | 0.3 | | **Tradução para o português** (SPEC-0001 D-26).<br>• D-01 atualizada com a instalação real: comandos e skills instaladas, remoção das skills de apps nativos, `--copy`, falha do instalador do Impeccable (issue #479) e instalação pelo CLI genérico sem o hook, `skills-lock.json` como registro de versões.<br>• D-02: superfície em modo Operate do Impeccable; nomes reais das skills da Taste.<br>• D-05: PRODUCT.md escrito pelo `init` após confirmação com o dono; caminho code-first por não haver geração de imagem.<br>• R-01 atualizado; novo R-04 (hook pendente). |
| 2026-09-28 | 0.4 | | **Mundo visual escolhido.**<br>• Nova D-17 (folha de desenho técnico, escolhida pelo dono na rodada de direção do Impeccable, semente `ac8393d6`, com a tabela de elementos da folha e a interação assinatura de prévia em redline).<br>• Novas D-18 (um controle de confirmação por visão), D-19 (símbolo do perfil gerado da chave), D-20 (lei da paleta; etiquetas de perfil são identidade, não estado) e D-21 (denso no bloco, generoso entre blocos; seleção ligada), vindas das elevações dos desafiantes recusados.<br>• D-06: Archivo e Martian Mono substituem a IBM Plex, que o Impeccable lista como padrão de treinamento; legendas condensadas em caixa alta; escala com o papel de legenda de 11 px.<br>• D-07: paleta de filme de desenho e blueprint; cobalto reservado ao controle de confirmação; links em grafite sublinhado.<br>• D-12: exceção de caixa alta para as legendas; notas gerais numeradas no lugar de faixas de alerta. |
| 2026-09-28 | 0.5 | | **Portões G1, G4 (travessões), G6 e T-09 ligados ao `pnpm check`.**<br>• O `scripts/check-tokens.mjs` mede 94 pares de contraste nos dois temas. A primeira execução reprovou seis pares, e os tokens foram ajustados: `--rule-strong` (bordas de controles) escurecido no tema claro e clareado no escuro, para 3:1 contra as superfícies; `--warn` e `--tag-amber` do tema claro escurecidos para 3:1.<br>• Os seletores de tema passaram de `:root[data-theme]` para `[data-theme]`, para as pranchas do `/_kit` (CA-32).<br>• Links com aparência de botão usam `buttonClass()`, porque um botão dentro de um link é HTML inválido.<br>• O detector do Impeccable (G1) não aponta nada em `apps/web/src`. |
| 2026-09-28 | 0.6 | | **Portões do M1.**<br>• D-04: Monaco fixado em 0.52.2 por compatibilidade com o `monaco-yaml`; worker de YAML local; `tailwind-merge` no `cn`.<br>• Os temas do Monaco e as cores dos gráficos são lidos dos tokens em tempo de execução (`tokenHex`), então seguem o tema sem cores cruas (G6).<br>• G5: `a11y.spec.ts` roda o axe em 16 telas do M1 nos dois temas. Achados corrigidos: contraste do item ativo do índice de produtos quando a API está desligada (tinta 3 sobre `construct-tint`, 4,42:1; agora tinta 2) e o grafo do Workflows, que tinha `role="img"` com nós focáveis (agora `role="group"`). O par tinta 2 sobre `construct-tint` entrou no T-09 (96 pares).<br>• Comando equivalente: comandos longos quebram uma flag por linha, sem quebrar dentro de aspas; o bloco rola na horizontal em vez de quebrar.<br>• Tabelas: cliques e teclas vindos de controles dentro de uma célula (botões, links, campos) não abrem a linha, e cliques vindos de diálogos abertos pela célula também não.<br>• G2 e G3: revisão visual feita por capturas do Playwright em todas as telas do M1; os comandos `/impeccable critique`, `audit`, `harden` e `polish` e o `review-animations` ficam para a próxima sessão com as skills carregadas, antes de fechar o M1. |
| 2026-09-28 | 0.7 | | **Portões do M2.**<br>• Editor: gramática de Security Rules própria (`firestore-rules`) no Monaco, com as cores dos tokens.<br>• O editor de diff libera os modelos na ordem certa ao fechar (antes, fechar o diálogo de revisão gerava um erro na página); a rejeição "Canceled" que o Monaco usa para o próprio trabalho interrompido é ignorada, e qualquer outra continua aparecendo.<br>• A árvore de campos usa listas aninhadas com `aria-expanded` nos botões, sem os papéis ARIA `tree`, cujo modelo de teclado ela não implementa.<br>• G5: axe nas telas do Firestore (bancos, painéis, tabela, consulta) nos dois temas, pelo script de ponta a ponta contra o emulador; sem violações.<br>• Valores escalares na árvore de campos ficam numa linha; strings quebram. |
| 2026-09-29 | 0.8 | | **Nova marca.** O "N" dentro de um quadrado lembrava o logo do Notion; a marca passa a desenhar o próprio instrumento: o espelho redondo do nefoscópio com as graduações cardeais e uma nuvem atravessando, na cor de construção (`--construct-ink`, que segue o tema). O favicon tem a variante escura por `prefers-color-scheme`. Sem letras, legível em 16 e 20 px. |
| 2026-09-29 | 0.9 | | D-01: as pastas das skills saem do repositório público (`.claude/skills/` no `.gitignore`), por serem trabalho de terceiros sob licenças próprias; o `skills-lock.json` continua versionado e a tabela diz como reinstalar |

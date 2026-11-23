# Decisões

Oito decisões que moldaram o JER CRM. Cada registro traz o contexto, a escolha, as alternativas que entraram na mesa e as consequências que vieram depois, inclusive as que eu revisitaria.

## ADR-001: Autorização aplicada pelo Row Level Security

**Contexto.** O produto tem dois papéis com visibilidades diferentes. O vendedor trabalha só a própria fila; o gestor vê todas as filas, todos os relatórios e todas as configurações. Filtrar apenas na camada de serviço transforma cada consulta numa obrigação, e basta um predicado esquecido para expor o pipeline de um concorrente. O time é pequeno, então a garantia precisa sobreviver a código descuidado, não só a código cuidadoso.

**Decisão.** O Row Level Security está ligado em todas as tabelas, e a aplicação se conecta com um papel criado sem direito de superusuário e sem `BYPASSRLS`. Cada unidade de trabalho abre uma transação e grava o identificador do ator e o papel nas configurações locais da transação com `set_config(name, value, true)`. As políticas leem essas configurações por funções helper estáveis. Sem contexto, os helpers devolvem null e nenhuma linha casa. As views de relatório são declaradas caller-scoped, para que as mesmas regras valham por elas.

**Alternativas.** Filtrar exclusivamente na camada de serviço; um schema ou banco separado por papel; um motor de políticas dentro da aplicação.

**Consequências.** Predicado ausente devolve nada em vez de vazar, ou seja, falha para o lado seguro. O preço é que toda função de serviço nova precisa abrir a transação certa; um erro aparece como tela vazia, não como exceção; e o banco passa a carregar regras que têm de migrar junto com o schema. As políticas ainda acrescentam uma subconsulta para as linhas de interação, barata neste volume de dados.

## ADR-002: SQL escrito à mão no node-postgres, sem ORM

**Contexto.** O sistema se apoia em recursos do PostgreSQL que um ORM esconderia: políticas, views caller-scoped, índices parciais, upsert com `on conflict` e uma função `SECURITY DEFINER`. E o mesmo código precisa rodar na instância local e no provedor gerenciado.

**Decisão.** O driver é o `pg`, as consultas são escritas à mão na camada de serviço, e funções pequenas mapeiam o resultado para tipos de domínio. Não há query builder nem gerador de migration.

**Alternativas.** Um ORM completo com ferramenta de migration; uma biblioteca cliente hospedada, presa a um provedor; um query builder sobre o mesmo driver.

**Consequências.** O SQL que roda em desenvolvimento é o que roda em produção, e o comportamento da política fica à vista enquanto a consulta é escrita. Contagem de linhas, cláusulas `returning` e tratamento de conflito continuam explícitos. O preço é repetição: lista de colunas, bloco de upsert e código de mapeamento aparecem em mais de um módulo, e nada confere em tempo de compilação se a consulta corresponde ao schema. Com um time maior, eu acrescentaria tipos gerados a partir do schema vivo.

## ADR-003: Server actions como único caminho de mutação, sem middleware de autenticação

**Contexto.** A aplicação é um conjunto de páginas autenticadas com formulários e botões. O Next.js oferece middleware, que roda antes da rota, e server actions, que rodam no servidor depois do envio do formulário.

**Decisão.** Toda mutação passa por server action. A action valida o payload, lê a sessão, confere o papel, chama um serviço e devolve um objeto de resultado. A autenticação é verificada no layout autenticado e em cada action. Não existe arquivo de middleware.

**Alternativas.** Middleware protegendo todo o grupo de rotas autenticadas; uma camada de API separada, com busca no cliente; route handlers para cada mutação.

**Consequências.** Cada operação decide num lugar só quem pode executá-la, e a checagem fica ao lado do código que depende dela, o que é mais fácil de auditar do que um padrão de matcher. O custo é repetição: a checagem de sessão aparece em toda action, e uma action nova que a esqueça só é pega na revisão, por testes que ainda não existem ou pelas políticas atrás dela. O middleware teria centralizado o redirecionamento, não as regras de papel, e não protege um serviço chamado por job agendado.

## ADR-004: Uma sessão assinada sem estado em cookie httpOnly

**Contexto.** O produto precisa de login para poucos usuários e dispensa federação, refresh token e gestão de dispositivo. Operar uma tabela de sessão acrescentaria uma escrita por requisição e um job de limpeza.

**Decisão.** O login confere um hash bcrypt e emite um JWT assinado com HS256, com identificador do usuário, nome, e-mail e papel, válido por oito horas. O cookie é httpOnly, SameSite=Lax e Secure em produção. A sessão é lida uma vez por requisição e memoizada.

**Alternativas.** Tokens opacos em tabela de sessão, com revogação no servidor; um provedor de identidade de terceiros; tokens de vida curta com rotação de refresh.

**Consequências.** Nenhum session store, nenhuma limpeza, nenhuma leitura extra por requisição. A revogação é limitada: sair limpa o cookie, mas um token copiado segue válido até expirar, e mudança de papel só vale quando o token é reemitido, até oito horas depois. Essa janela serve a um time interno pequeno e não serviria a um produto com usuário externo.

## ADR-005: Dois papéis de banco, um para as pessoas e um para o sistema

**Contexto.** Pela política, só gestor grava registro de empresa e atribuição. Mas três rotinas de sistema precisam gravar esses dados sem gente por trás: a ingestão cadastral durante a rodada agendada, o enriquecimento do cadastro e a escrituração da própria rodada.

**Decisão.** Dois pools. O session pool usa o papel restrito e sempre carrega contexto de ator. O system pool usa o dono do schema e fica reservado a essas rotinas. As funções que tocam o system pool fazem a própria autorização antes de chamá-lo, e os pontos de chamada são poucos o bastante para enumerar.

**Alternativas.** Dar ao papel restrito escrita nas tabelas de referência e passar um ator sintético; rodar o trabalho agendado como conta de gestor dedicada; mover as escritas de sistema para funções `SECURITY DEFINER`.

**Consequências.** O tráfego de usuário nunca precisa de direito elevado, e o código de sistema continua legível em vez de contornar política. O custo é um segundo caminho de conexão que ignora as políticas por inteiro, então erro na checagem de chamador não é pego pelo banco. As funções que usam esse caminho são as que mais merecem revisão.

## ADR-006: Um motor de distribuição guiado por configuração, com escrita idempotente

**Contexto.** Reabastecer a fila era o passo manual que mais falhava. O provedor devolve empresas por código de atividade e estado, sem saber quais o time já tem, e a mesma busca devolve as mesmas linhas todo dia.

**Decisão.** Os gestores configuram códigos de atividade, estados, um piso por vendedor e um teto por rodada. A rodada consulta o provedor para cada combinação, descarta os CNPJs já armazenados, embaralha os candidatos com Fisher-Yates sobre fonte criptográfica e distribui aos vendedores ativos menos carregados. As escritas caem numa transação só, com constraint única em empresa e vendedor, então rodada repetida não insere nada duas vezes. A rodada começa no painel ou em rota de cron autenticada.

**Alternativas.** Atribuição round-robin determinística; atribuição por score que pondera porte, estado e atividade; um serviço de queue externo com worker.

**Consequências.** A fila se reabastece sozinha, e a divisão é justa na prática, porque a escolha aleatória dentro do grupo menos carregado tira o viés de ordenação do provedor. O motor não garante ótimo global, depende de o provedor devolver empresa nova e para quando a cota acaba. A idempotência do caminho de escrita é o que torna a retentativa segura, e é a parte que eu manteria em qualquer redesenho.

## ADR-007: Cache e cota na frente do provedor medido, com fallback rotulado

**Contexto.** Busca cadastral é cobrada e limitada por minuto e por dia. A interface também precisa ser demonstrável sem contrato, e demonstração cheia de dado inventado seria pior do que uma vazia.

**Decisão.** As respostas ficam em cache sob um hash da consulta normalizada, com tempo de vida; uma linha de contador diário acompanha o consumo; e uma janela deslizante em memória aplica o limite por minuto. A busca paga por mapas e perfis sociais fica desligada, a menos que alguém peça. Quando o provedor falha e o fallback está ligado, o resultado vem marcado como dado de demonstração, e a interface imprime o motivo acima das linhas.

**Alternativas.** Sem cache, aceitando o custo; confiar que o provedor aplique os limites; derrubar a tela com erro genérico.

**Consequências.** Busca repetida ao longo do dia de trabalho não custa nada, e o time entende por que um registro está incompleto. A linha de contador vira gargalo com escrita concorrente, a janela de minuto é por processo, e o fallback existe só para demonstração, um compromisso que eu tiraria em implantação paga.

## ADR-008: Colunas de data lidas como texto

**Contexto.** O negócio roda em um fuso, o servidor pode rodar em UTC. Uma coluna `date` convertida em `Date` do JavaScript à meia-noite do horário local e renderizada em outro fuso anda um dia, o que corrompe "contatos hoje" e todo relatório diário.

**Decisão.** O parser do driver para o tipo `date` devolve a string crua `YYYY-MM-DD`. Timestamp continua timestamp e é convertido para o fuso do negócio em SQL na hora de agrupar por dia. A formatação para data legível acontece na camada de apresentação.

**Alternativas.** Guardar tudo como `timestamptz` e truncar em SQL; definir o fuso da sessão para o fuso do negócio e aceitar objetos `Date`; formatar data em SQL para cada tela.

**Consequências.** O bucket diário fica estável, e um relatório nunca discorda de si mesmo entre duas telas. O preço é que a string de data precisa ser formatada antes de exibir e não pode ser comparada nem subtraída sem parsing, então quem chega novo tem de aprender a convenção. Ela está documentada na arquitetura e no código que configura o driver.

# Decisões

Oito decisões que moldaram o JER CRM. Cada registro traz o contexto, a escolha, as alternativas consideradas e as consequências que vieram depois, incluindo as que eu revisitaria.

## ADR-001: Autorização aplicada por Row Level Security

**Contexto.** O produto tem dois papéis com visibilidades diferentes. Um vendedor trabalha apenas a própria fila; um gestor vê todas as filas, todos os relatórios e todas as configurações. Filtrar apenas na camada de serviço significa que toda consulta carrega uma obrigação, e um predicado esquecido expõe o pipeline de um concorrente. O time é pequeno, então a garantia precisa sobreviver a código descuidado, não apenas a código cuidadoso.

**Decisão.** O Row Level Security está habilitado em todas as tabelas, e a aplicação se conecta com um papel criado sem direitos de superusuário e sem `BYPASSRLS`. Cada unidade de trabalho abre uma transação e grava o identificador do ator e o papel nas configurações locais da transação com `set_config(name, value, true)`. As políticas leem essas configurações por funções helper estáveis. Sem contexto, os helpers retornam null e nenhuma linha casa. As views de relatório são declaradas caller-scoped para que as mesmas regras valham por elas.

**Alternativas.** Filtrar exclusivamente na camada de serviço; um schema ou banco separado por papel; um motor de políticas na aplicação.

**Consequências.** Um predicado ausente retorna nada em vez de vazar, o que falha na direção segura. O custo é que toda nova função de serviço precisa abrir a transação correta, um erro aparece como telas vazias em vez de um erro, e o banco agora carrega regras que precisam ser migradas junto com o schema. As políticas também acrescentam uma subconsulta para as linhas de interação, o que é barato neste volume de dados.

## ADR-002: SQL escrito à mão no node-postgres, sem ORM

**Contexto.** O sistema é construído sobre recursos do PostgreSQL que um ORM obscureceria: políticas, views caller-scoped, índices parciais, upserts com `on conflict` e uma função `SECURITY DEFINER`. O mesmo código precisa rodar em uma instância local e em um provedor gerenciado.

**Decisão.** O driver é o `pg`, as consultas são escritas à mão na camada de serviço e os resultados são mapeados para tipos de domínio por funções pequenas. Não há query builder nem gerador de migration.

**Alternativas.** Um ORM completo com ferramenta de migration; uma biblioteca cliente hospedada e presa a um provedor; um query builder sobre o mesmo driver.

**Consequências.** O SQL que roda em desenvolvimento é o SQL que roda em produção, e o comportamento das políticas fica visível enquanto a consulta é escrita. Contagens de linhas, cláusulas `returning` e tratamento de conflito permanecem explícitos. O preço é repetição: listas de colunas, blocos de upsert e código de mapeamento aparecem em mais de um módulo, e nada verifica em tempo de compilação que uma consulta corresponde ao schema. Com um time maior eu acrescentaria tipos gerados a partir do schema vivo.

## ADR-003: Server actions como o único caminho de mutação, sem middleware de autenticação

**Contexto.** A aplicação é um conjunto de páginas autenticadas com formulários e botões. O Next.js oferece middleware que roda antes de uma rota e oferece server actions que rodam no servidor depois do envio de um formulário.

**Decisão.** As mutações passam por server actions. Cada action valida seu payload, lê a sessão, confere o papel, chama um serviço e retorna um objeto de resultado. A autenticação é aplicada no layout autenticado e em cada action. Não existe arquivo de middleware.

**Alternativas.** Middleware que protege todo o grupo de rotas autenticadas; uma camada de API separada com busca no cliente; route handlers para cada mutação.

**Consequências.** Um lugar por operação decide quem pode fazê-la, e a checagem fica ao lado do código que precisa dela, o que é mais fácil de auditar do que um padrão de matcher. O custo é repetição: a checagem de sessão é escrita em cada action, e uma nova action que a esquece só é pega em revisão, por testes que ainda não existem ou pelas políticas atrás dela. O middleware teria centralizado o redirecionamento, mas não as regras de papel, e não protege um serviço chamado por um job agendado.

## ADR-004: Uma sessão assinada sem estado em cookie httpOnly

**Contexto.** O produto precisa de um login para poucos usuários e não precisa de federação, de refresh tokens nem de gestão de dispositivos. Operar uma tabela de sessão acrescentaria uma escrita a cada requisição e um job de limpeza.

**Decisão.** O login verifica um hash bcrypt e emite um JWT assinado com HS256, carregando o identificador do usuário, nome, e-mail e papel, válido por oito horas. O cookie é httpOnly, SameSite=Lax e Secure em produção. A sessão é lida uma vez por requisição e memoizada.

**Alternativas.** Tokens opacos em uma tabela de sessão com revogação no servidor; um provedor de identidade de terceiros; tokens de vida curta com rotação de refresh.

**Consequências.** Sem session store, sem limpeza, sem leitura extra por requisição. A revogação é limitada: sair limpa o cookie, mas um token copiado continua válido até expirar, e uma mudança de papel só tem efeito quando o token é reemitido, até oito horas depois. Essa janela é aceitável para um time interno pequeno e não seria aceitável para um produto com usuários externos.

## ADR-005: Dois papéis de banco, um para as pessoas e um para o sistema

**Contexto.** As políticas tornam os registros de empresa e as atribuições graváveis apenas por gestores. Mas três rotinas de sistema precisam gravar esses dados sem uma pessoa por trás: a ingestão cadastral durante uma rodada agendada, o enriquecimento dos registros de empresa e a contabilidade da própria rodada.

**Decisão.** Dois pools. O session pool usa o papel restrito e sempre carrega um contexto de ator. O system pool usa o dono do schema e fica reservado a essas rotinas. As funções que tocam o system pool fazem a própria autorização antes de chamá-lo, e os pontos de chamada são poucos o bastante para enumerar.

**Alternativas.** Dar ao papel restrito acesso de escrita nas tabelas de referência e passar um ator sintético; rodar o trabalho agendado como uma conta de gestor dedicada; mover as escritas de sistema para funções `SECURITY DEFINER`.

**Consequências.** O tráfego de usuário nunca precisa de direitos elevados, e o código de sistema continua legível em vez de contornar políticas. O custo é um segundo caminho de conexão que ignora as políticas por completo, então um erro em uma checagem de chamador não é pego pelo banco. As funções que o usam são as que mais valem revisão.

## ADR-006: Um motor de distribuição orientado por configuração com escritas idempotentes

**Contexto.** Reabastecer a fila era o passo manual que falhava com mais frequência. O provedor retorna empresas por código de atividade e estado, sem noção de quais o time já tem, e a mesma busca retorna as mesmas linhas todos os dias.

**Decisão.** Os gestores configuram códigos de atividade, estados, um piso por vendedor e um teto por rodada. Uma rodada consulta o provedor para cada combinação, descarta os CNPJs já armazenados, embaralha os candidatos com Fisher-Yates sobre uma fonte criptográfica e os atribui aos vendedores ativos menos carregados. As escritas acontecem em uma transação com uma constraint única em empresa e vendedor, então uma rodada repetida não insere nada duas vezes. Uma rodada roda a partir do painel ou de uma rota de cron autenticada.

**Alternativas.** Atribuição round-robin determinística; atribuição por um score que pondera porte, estado e atividade; um serviço de queue externo com um worker.

**Consequências.** A fila se reabastece sozinha e a divisão é justa na prática, porque a escolha aleatória dentro do grupo menos carregado remove o viés de ordenação do provedor. O motor não consegue garantir um ótimo global, depende de o provedor retornar empresas novas e para quando a cota se esgota. A idempotência do caminho de escrita é o que torna uma nova tentativa segura, e é a parte que eu manteria em qualquer redesenho.

## ADR-007: Cache e cota na frente do provedor medido, com um fallback rotulado

**Contexto.** As buscas cadastrais são cobradas e limitadas por minuto e por dia. A interface também precisa ser demonstrável sem contrato, e uma demonstração cheia de dados inventados seria pior do que uma vazia.

**Decisão.** As respostas são cacheadas sob um hash da consulta normalizada com um tempo de vida, uma linha de contador diário acompanha o consumo e uma janela deslizante em memória aplica o limite por minuto. A busca paga por mapas e perfis sociais fica desligada a menos que seja solicitada. Quando o provedor falha e o fallback está habilitado, o resultado é marcado como dado de demonstração e a interface imprime o motivo acima das linhas.

**Alternativas.** Sem cache, aceitando o custo; confiar no provedor para aplicar os limites; derrubar a tela com um erro genérico.

**Consequências.** Buscas repetidas durante um dia de trabalho não custam nada, e o time vê por que um registro está incompleto. A linha de contador é um gargalo sob escritas concorrentes, a janela de minuto é por processo, e o fallback existe apenas para demonstração, o que é um compromisso que eu removeria em uma implantação paga.

## ADR-008: Colunas de data lidas como texto

**Contexto.** O negócio roda em um fuso horário, enquanto o servidor pode rodar em UTC. Uma coluna `date` convertida em um `Date` do JavaScript à meia-noite do horário local e renderizada em outro fuso se desloca um dia, o que corrompe "contatos hoje" e todo relatório diário.

**Decisão.** O parser do driver para o tipo `date` retorna a string crua `YYYY-MM-DD`. Os timestamps continuam timestamps e são convertidos para o fuso horário do negócio em SQL quando são agrupados por dia. A formatação para uma data legível acontece na camada de apresentação.

**Alternativas.** Armazenar tudo como `timestamptz` e truncar em SQL; definir o fuso horário da sessão para o fuso do negócio e aceitar objetos `Date`; formatar as datas em SQL para cada tela.

**Consequências.** Os buckets diários são estáveis e um relatório nunca discorda de si mesmo entre duas telas. O custo é que as strings de data precisam ser formatadas antes da exibição e não podem ser comparadas ou subtraídas sem parsing, então um novo desenvolvedor precisa aprender a convenção. Ela está documentada na arquitetura e no código que configura o driver.

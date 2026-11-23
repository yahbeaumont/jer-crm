# Estudo de caso

## O briefing

Uma distribuidora de automação industrial vende componentes para fábricas. Seu time comercial não espera interesse inbound: ele escolhe uma fatia do mercado por código de atividade econômica, compra uma lista de empresas que correspondem e liga para elas. A lista é a matéria-prima do negócio.

A lista chegava como planilha: alguém a exportava de um provedor de base cadastral, dividia as linhas entre os vendedores e colava os telefones no WhatsApp Web. O time não tinha uma fila que se reabastecesse, nem uma divisão justa, nem registro do que já havia sido tentado.

Fui encarregado de substituir isso, não por um CRM genérico com editor de pipeline, mas por uma ferramenta moldada em torno de um movimento: abrir uma empresa, ver com quem falar, falar com ela e registrar o que aconteceu em dois cliques.

## Restrições

**Um engenheiro, sem time de operações.** Um processo, um banco de dados, diagnosticável por logs e por um endpoint de health.

**Uma fonte de dados medida.** O provedor de base cadastral cobra por busca e limita requisições por minuto e por dia. A ingestão tinha de funcionar dentro desse orçamento.

**Dados pessoais reais.** Os registros incluem sócios vindos do registro público. Esses dados são públicos, mas ainda pessoais, e os telefones dos sócios não são publicados de forma alguma, o que a interface precisa dizer em vez de inventá-los.

**Um time comercial, não engenheiros.** Uma tela que exige três cliques para iniciar uma conversa no WhatsApp não é usada, e um número que abre uma conversa vazia custa uma ligação.

**Nenhuma suíte de testes.** Não havia cultura de testes para herdar nem tempo para construir uma durante a primeira entrega, a primeira coisa que eu mudaria.

## O que foi construído

Uma aplicação Next.js com PostgreSQL por trás: onze páginas, trinta server actions, quinze módulos de serviço, dez tabelas e vinte e três políticas de acesso, aplicadas por cinco migrations SQL.

O vendedor recebe uma fila agrupada por estágio, com busca e um atalho para a empresa mais antiga ainda não trabalhada. O cadastro da empresa mostra dados cadastrais, código de atividade, porte, endereço, telefone, e-mail, site, sócios e perfis sociais, com ações para WhatsApp, e-mail, telefone e mapas. Cada ação registra uma interação com data, hora e autor, e um pipeline de sete estágios acompanha a conversa.

O gestor vê o time inteiro, o funil, hoje contra ontem, uma série de quatorze dias, um ranking, conversão mensal, interações recentes, transferências e exportações CSV.

O motor mudou a natureza do produto: ele observa códigos de atividade e estados, consulta o provedor em uma agenda, descarta as empresas já armazenadas e atribui o resto aos vendedores menos carregados.

## Os quatro problemas difíceis

### 1. Fazer do banco de dados a autoridade sem quebrar o login

O Row Level Security precisa saber quem está perguntando, e a resposta tem de chegar com a consulta, não com a conexão, porque as conexões são agrupadas em pool e compartilhadas.

Cada unidade de trabalho abre uma transação e chama `set_config` com o identificador do usuário e o papel, marcado como local para que os valores desapareçam no commit. As políticas leem essas configurações por helpers estáveis, então uma conexão do pool não carrega identidade entre requisições.

O login foi o primeiro problema. Ele acontece antes de existir um ator, e a tabela de contas é protegida como todo o resto, então uma leitura para verificar uma senha seria bloqueada pela própria política. A solução é uma função de banco, pertencente ao dono do schema, que retorna exatamente as seis colunas necessárias para autenticar um e-mail, com execute revogado do público e o search path fixo.

O segundo apareceu depois, quando duas tabelas novas foram adicionadas com políticas mas sem privilégios para o papel da aplicação. O PostgreSQL verifica privilégios antes das políticas, então a tela falhou com um erro de permissão em vez de uma lista vazia. Uma quinta migration concedeu acesso de leitura e deixou a política decidir as linhas. Neste modelo, uma tabela nova precisa de três coisas, não de uma.

### 2. Um reabastecimento justo, repetível e barato

A primeira versão tinha apenas importação manual: um gestor escolhia uma lista e um vendedor. Isso substituiu a planilha sem manter a fila cheia.

O motor tinha de responder a três perguntas ao mesmo tempo. Quais empresas são novas? Quem deve receber cada uma? O que acontece se a rodada rodar duas vezes?

A novidade é uma diferença de conjuntos contra os CNPJs armazenados. A justiça é um embaralhamento seguido de atribuição ao vendedor menos carregado, com um teto por rodada. A repetibilidade vem do banco de dados: uma constraint única em empresa e vendedor e um upsert que não faz nada em conflito.

Dois detalhes levaram mais tempo. Matriz e filiais têm CNPJs diferentes e o mesmo valor comercial, então os candidatos são agrupados pelos primeiros dígitos do CNPJ antes do embaralhamento. E um erro em uma combinação de código de atividade e estado não pode descartar o que foi coletado, então cada combinação registra o próprio erro e a rodada continua.

### 3. Dados que admitem de onde vieram

Um cadastro de empresa é montado a partir de quatro fontes com custos diferentes. O site da empresa é grátis e frequentemente lista perfis sociais. O provedor comercial é medido e tem os dados cadastrais. Um espelho público do registro tem os sócios. Uma API de busca tem mapas e perfis e cobra por chamada.

A regra é que a interface nunca apresenta um chute como fato. O enriquecimento roda as fontes grátis primeiro e as pagas sob demanda, e cada registro guarda qual fonte produziu seus dados. Quando uma fonte falha, o resultado carrega um aviso e a interface o imprime; quando o provedor está fora e o fallback está habilitado, as linhas são rotuladas como dados de demonstração.

Duas lições menores. Uma API pública rejeitou o user agent padrão do runtime Node com um 403, então as chamadas externas agora enviam um agente identificável. E o enriquecimento em lote teve de ser limitado: seis workers mantêm uma rodada dentro da janela agendada sem esgotar o limite por minuto.

### 4. Um registro que sobrevive ao estado que descreve

A primeira tentativa de relatório lia o estágio atual de cada atribuição e contava. Estava errada de um jeito que levou uma semana para ser notado: avançar uma atribuição apagava o fato de que ela já estivera atrás, então o funil parecia saudável enquanto o time pulava estágios.

A correção foi tratar a tabela de interações como o registro e a atribuição como um cache do estado mais recente. Cada ação acrescenta uma linha com o estágio anterior, o novo estágio, o ator e a hora, na mesma transação que atualiza a atribuição. O relatório lê uma view sobre as interações agrupadas por vendedor e dia, convertidas para o fuso horário do negócio dentro do SQL.

Essa mudança também corrigiu uma classe de bugs de fuso horário. As colunas de data são lidas como texto pelo driver, então uma data de negócio não pode mudar de dia quando o servidor roda em UTC, e os números diários batem entre o painel e a exportação.

## O que mudou no caminho

O produto começou como uma ferramenta de importação e se tornou um sistema de ingestão. O segundo commit entregou o CRM com importação manual; o terceiro acrescentou o motor automático, os sócios, a descoberta social e os alertas de WhatsApp. O motor não é uma feature que eu planejei. É o que o cliente precisou depois de usar a primeira versão por uma semana.

A validação de mapas passou de uma API de places dedicada para o provedor de busca, porque uma conta paga era mais fácil de explicar e limitar do que duas. A descoberta social começou como uma busca paga por rede e se tornou uma leitura grátis do site da própria empresa, com a busca paga como fallback.

## O que eu faria diferente

**Testes em torno das políticas.** O código de maior risco não é o SQL que retorna linhas, mas o SQL que decide quem pode vê-las. Um harness que faz seed de dois atores e verifica o que cada um pode ler, escrever e exportar teria pegado as concessões faltantes.

**Um único caminho de conexão com elevação explícita.** Dois pools funcionam, mas o segundo ignora as políticas e depende de disciplina nos pontos de chamada. Trocar de papel dentro de uma transação manteria um pool e um modelo mental.

**Uma queue para o enriquecimento.** Hoje ele roda dentro da requisição ou da rodada; uma tabela de jobs com retries manteria os dois curtos.

**Revogação antes da expiração.** Uma sessão assinada válida por oito horas é a troca certa para um time interno e a errada para um produto com usuários externos.

O que eu manteria é o que teve peso: autorização no banco de dados, a tabela de interações como fonte da verdade e um caminho de ingestão idempotente por construção.

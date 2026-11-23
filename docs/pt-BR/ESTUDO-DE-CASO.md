# Estudo de caso

## O pedido

Uma distribuidora de automação industrial vende componentes para fábricas. O time comercial dela não espera interesse inbound: escolhe uma fatia do mercado por código de atividade econômica, compra uma lista de empresas que se encaixam e liga. A lista é a matéria-prima do negócio.

A lista chegava em planilha. Alguém exportava do provedor de base cadastral, dividia as linhas entre os vendedores e colava os telefones no WhatsApp Web. O time não tinha fila que se reabastecesse, nem divisão justa, nem registro do que já havia sido tentado.

Fui chamado para substituir isso. Não por um CRM genérico com editor de pipeline, mas por uma ferramenta desenhada em torno de um movimento só: abrir uma empresa, ver com quem falar, falar e registrar o que aconteceu em dois cliques.

## Restrições

**Um engenheiro, nenhum time de operação.** Um processo, um banco de dados, diagnosticável por log e por um endpoint de health.

**Uma fonte de dados medida.** O provedor de base cadastral cobra por busca e limita requisição por minuto e por dia. A ingestão tinha de caber nesse orçamento.

**Dado pessoal de verdade.** Os registros incluem sócios vindos do registro público. O dado é público, mas continua pessoal, e o telefone do sócio não aparece em fonte pública nenhuma, o que a interface precisa dizer em vez de inventar.

**Um time comercial, não engenheiros.** Tela que exige três cliques para começar uma conversa no WhatsApp não é usada, e número que abre conversa vazia custa uma ligação.

**Nenhuma suíte de testes.** Não havia cultura de teste para herdar nem tempo de construir uma na primeira entrega, a primeira coisa que eu mudaria.

## O que foi construído

Uma aplicação Next.js com PostgreSQL atrás: onze páginas, trinta server actions, quinze módulos de serviço, dez tabelas e vinte e três políticas de acesso, aplicadas por cinco migrations SQL.

O vendedor recebe uma fila agrupada por estágio, com busca e um atalho para a empresa mais antiga que ninguém tocou. O cadastro mostra dado cadastral, código de atividade, porte, endereço, telefone, e-mail, site, sócios e perfis sociais, com ação para WhatsApp, e-mail, telefone e mapas. Toda ação registra uma interação com data, hora e autor, e um pipeline de sete estágios acompanha a conversa.

O gestor vê o time inteiro, o funil, hoje contra ontem, a série de quatorze dias, o ranking, a conversão mensal, as interações recentes, as transferências e as exportações CSV.

O motor mudou a natureza do produto: vigia códigos de atividade e estados, consulta o provedor na agenda, descarta o que já está armazenado e distribui o resto aos vendedores menos carregados.

## Os quatro problemas difíceis

### 1. Fazer do banco a autoridade sem quebrar o login

O Row Level Security precisa saber quem pergunta, e a resposta tem de chegar junto com a consulta, não com a conexão, porque conexão é pooled e compartilhada.

Cada unidade de trabalho abre uma transação e chama `set_config` com o identificador do usuário e o papel, marcado como local, para que os valores sumam no commit. As políticas leem essas configurações por helpers estáveis, então uma conexão do pool não carrega identidade de uma requisição para outra.

O login foi o primeiro problema. Ele acontece antes de existir ator, e a tabela de contas é protegida como todo o resto: uma leitura para conferir senha esbarraria na própria política. A saída é uma função de banco, do dono do schema, que devolve exatamente as seis colunas necessárias para autenticar um e-mail, com execute revogado do público e search path fixo.

O segundo apareceu depois, quando entraram duas tabelas novas com políticas e sem privilégio para o papel da aplicação. O PostgreSQL confere privilégio antes de política, então a tela quebrou com erro de permissão em vez de lista vazia. Uma quinta migration concedeu leitura e deixou a política decidir as linhas. Nesse modelo, tabela nova precisa de três coisas, não de uma.

### 2. Um reabastecimento justo, repetível e barato

A primeira versão tinha só importação manual: o gestor escolhia uma lista e um vendedor. Substituía a planilha, mas não mantinha a fila cheia.

O motor tinha de responder a três perguntas de uma vez. Quais empresas são novas? Quem fica com cada uma? E o que acontece se a rodada rodar duas vezes?

Novidade é diferença de conjunto contra os CNPJs armazenados. Justiça é embaralhar e entregar ao vendedor menos carregado, com teto por rodada. Repetibilidade vem do banco: constraint única em empresa e vendedor e um upsert que não faz nada em conflito.

Dois detalhes tomaram mais tempo. Matriz e filial têm CNPJ diferente e o mesmo valor comercial, então os candidatos são agrupados pelos primeiros dígitos do CNPJ antes do embaralhamento. E erro em uma combinação de código de atividade e estado não pode jogar fora o que já foi coletado, então cada combinação registra o próprio erro e a rodada segue.

### 3. Dado que assume de onde veio

O cadastro de uma empresa se monta a partir de quatro fontes de custo diferente. O site da empresa é grátis e muitas vezes lista perfil social. O provedor comercial é medido e tem o dado cadastral. Um espelho público do registro tem os sócios. Uma API de busca tem mapas e perfis, e cobra por chamada.

A regra é simples: a interface nunca apresenta chute como fato. O enriquecimento roda as fontes grátis primeiro e as pagas sob demanda, e cada registro guarda qual fonte produziu cada dado. Quando uma fonte falha, o resultado leva um aviso e a interface imprime; quando o provedor está fora e o fallback ligado, a linha vem rotulada como dado de demonstração.

Duas lições menores. Uma API pública recusou o user agent padrão do runtime Node com 403, então as chamadas externas passaram a mandar um agente identificável. E o enriquecimento em lote precisou de limite: seis workers mantêm a rodada dentro da janela agendada sem estourar o limite por minuto.

### 4. Um registro que sobrevive ao estado que descreve

A primeira tentativa de relatório lia o estágio atual de cada atribuição e contava. Estava errada de um jeito que levou uma semana para aparecer: avançar uma atribuição apagava o fato de que ela já estivera atrás, e o funil parecia saudável enquanto o time pulava etapas.

A correção foi tratar a tabela de interações como registro e a atribuição como cache do estado mais recente. Toda ação acrescenta uma linha com o estágio anterior, o novo estágio, o ator e a hora, na mesma transação que atualiza a atribuição. O relatório lê uma view sobre as interações agrupadas por vendedor e por dia, já convertidas para o fuso do negócio dentro do SQL.

A mudança também resolveu uma classe de bug de fuso. As colunas de data são lidas como texto pelo driver, então uma data de negócio não anda um dia quando o servidor roda em UTC, e o número diário bate entre o painel e a exportação.

## O que mudou no caminho

O produto nasceu ferramenta de importação e virou sistema de ingestão. O segundo commit entregou o CRM com importação manual; o terceiro trouxe o motor automático, os sócios, a descoberta social e os alertas de WhatsApp. O motor não é feature que eu planejei: é o que o cliente precisou depois de usar a primeira versão por uma semana.

A validação de mapa saiu de uma API de places dedicada e foi para o provedor de busca, porque uma conta paga era mais fácil de explicar e de limitar do que duas. A descoberta social começou como busca paga por rede e virou leitura grátis do site da própria empresa, com a busca paga como fallback.

## O que eu faria diferente

**Testes em volta das políticas.** O código de maior risco não é o SQL que devolve linha, e sim o SQL que decide quem pode vê-la. Um harness que faz seed de dois atores e verifica o que cada um consegue ler, escrever e exportar teria pego as concessões que faltavam.

**Um caminho de conexão só, com elevação explícita.** Dois pools funcionam, mas o segundo ignora as políticas e depende de disciplina em cada ponto de chamada. Trocar de papel dentro da transação manteria um pool e um modelo mental.

**Uma queue para o enriquecimento.** Hoje ele roda dentro da requisição ou da rodada; uma tabela de jobs com retry manteria os dois curtos.

**Revogação antes do vencimento.** Sessão assinada válida por oito horas é a troca certa para time interno e a errada para produto com usuário externo.

O que eu manteria é o que carregou o peso: autorização no banco, a tabela de interações como fonte da verdade e um caminho de ingestão idempotente por construção.

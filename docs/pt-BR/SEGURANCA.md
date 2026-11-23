# Modelo de segurança

Este documento descreve o que o produto protege, onde ficam as fronteiras de confiança, quais ameaças moldaram o design, o que está implementado e o que explicitamente não é garantido. Ele descreve o sistema privado, não este repositório, que não contém código de produto executável.

## 1. Ativos

**Dados de empresas e contatos.** Dados cadastrais, endereços, telefones, e-mails e sites das empresas prospectadas, além do histórico de interações de cada uma. O valor comercial do sistema é, em grande parte, esse conjunto de dados.

**Dados pessoais de indivíduos.** Nomes, qualificações, faixas etárias e documentos mascarados dos sócios das empresas, retirados do registro público. Nomes e e-mails de trabalho do time comercial. As notas escritas pelos vendedores podem conter qualquer coisa que uma pessoa digitou, incluindo nomes e telefones de pessoas com quem falou.

**Desempenho comercial.** Atividade diária por vendedor, conversão, metas e o funil. Isso é sensível dentro da empresa, ainda que não seja dado pessoal.

**Credenciais.** Hashes de senha do time, o segredo de assinatura da sessão, o segredo compartilhado do endpoint de cron e as chaves de três provedores externos.

## 2. Fronteiras de confiança

**Navegador para servidor.** Não confiável. Toda requisição pode ser forjada, repetida ou modificada. A única coisa que o servidor aceita do navegador é o cookie de sessão assinado e o payload de uma action, que é validado.

**Servidor para banco de dados.** Transporte confiável, mas duas identidades diferentes. O session pool é um papel restrito sujeito a todas as políticas. O system pool é o dono do schema e ignora as políticas.

**Servidor para provedores.** Apenas de saída, apenas no servidor. As respostas são entrada não confiável: são interpretadas de forma defensiva e nunca executadas nem renderizadas como markup.

**Operador para implantação.** Variáveis de ambiente, runner de migration e console do banco. Quem tem as credenciais do dono do schema tem acesso total, e nenhum controle da aplicação se aplica a essa pessoa.

## 3. Ameaças consideradas

*Ler a fila de outro vendedor alterando um identificador.* Os identificadores são UUIDs, mas adivinhar não é o modelo de ameaça; um link vazado ou compartilhado é. Toda leitura de uma atribuição ou interação passa por uma política que compara o dono com o ator no contexto da transação.

*Escalar de vendedor para gestor.* O papel viaja no cookie assinado e no contexto da transação. Um cookie forjado falha na verificação de assinatura. Um cookie genuíno de um usuário rebaixado mantém o papel antigo até expirar, o que é uma janela conhecida (ver seção 5).

*Roubar uma sessão.* O cookie é httpOnly, então um script não consegue lê-lo, e SameSite=Lax o bloqueia em posts de formulário vindos de outro site. Os caminhos restantes são um navegador comprometido, um segredo de assinatura vazado ou um transporte sem criptografia fora de produção.

*Adivinhar senhas.* Os hashes são bcrypt com fator de trabalho 10. Não há limite de taxa nem bloqueio, então a defesa é o comprimento da senha e a base pequena de usuários, não o throttling.

*Extrair a base inteira.* Um gestor pode exportar tudo o que consegue ver, por design. Um vendedor só pode exportar nada: as rotas de exportação recusam qualquer papel que não seja gestor. Um vendedor ainda consegue ler a própria fila por completo, o que é o escopo pretendido do trabalho dele.

*Vazar chaves de provedor.* As chaves são lidas no servidor pela conexão administrativa e nunca são incluídas no payload de uma página. Elas são armazenadas como valores em texto claro em uma linha de configurações que só gestores conseguem ler pela aplicação.

*Abusar do endpoint agendado.* A rota de cron exige um segredo compartilhado em um header ou em um parâmetro de consulta. Sem ele a rota retorna 401 e não faz nada.

*Injeção.* Toda consulta usa parâmetros. A única instrução montada dinamicamente constrói uma lista de colunas a partir de uma allowlist fixa de nomes de campo, nunca a partir de entrada do usuário.

*Comprometimento ou indisponibilidade de um provedor.* Um provedor pode retornar dados errados, dados parciais ou um erro. A interface rotula uma fonte que falhou em vez de substituí-la por um chute, e timeouts limitam toda chamada.

## 4. Controles implementados

- Row Level Security em todas as dez tabelas, com o papel da aplicação criado sem direitos de superusuário e sem `BYPASSRLS`.
- Ator e papel gravados nas configurações locais da transação em cada unidade de trabalho; sem contexto, nenhuma linha.
- Views caller-scoped, para que o relatório não possa ampliar o que uma política permite.
- Sessão e papel reconferidos em cada server action e em cada rota de exportação, independentemente da política do banco.
- Cookie de sessão httpOnly, SameSite=Lax, Secure em produção, expiração de oito horas, assinado com HS256.
- Senhas com hash bcrypt; nenhuma consulta devolve um hash para a aplicação, exceto a única busca de login.
- Uma única função `SECURITY DEFINER` para a busca de login, com search path fixo, projeção estreita e execute revogado do público.
- Configurações que guardam chaves de provedor legíveis apenas por gestores; chaves resolvidas no servidor, com precedência das variáveis de ambiente.
- Exportações restritas a gestores e filtradas pelas mesmas políticas das telas.
- Proteção do último administrador ativo, para que o sistema não fique sem nenhum.
- User agent identificável e timeouts explícitos em toda chamada de saída.
- Modo de demonstração que pode ser desativado por configuração, e um fallback sempre rotulado na interface.

## 5. O que não é garantido

**Sem autenticação multifator, sem limite de tentativas de login, sem bloqueio.** Uma senha fraca é um risco real. O produto conta com o comprimento da senha e uma base de usuários pequena e conhecida.

**Mudanças de papel não são imediatas.** O papel vive em um token assinado válido por oito horas. Um usuário rebaixado ou desativado mantém o papel antigo na sessão existente até ela expirar, embora o próximo login de um usuário desativado falhe.

**Sem revogação de um token copiado.** Sair limpa o cookie naquele navegador. Um token copiado para outro lugar continua válido até expirar.

**A conexão de sistema ignora as políticas.** A ingestão cadastral, o enriquecimento e a contabilidade das rodadas usam o dono do schema. A segurança deles depende do código de servidor que os chama, não do banco de dados. Essa é a maior premissa única do design.

**Sem auditoria de leituras.** As escritas são registradas na tabela de interações. Leituras, exportações e logins não são, então o sistema não consegue responder quem olhou o quê.

**Sem criptografia em repouso além da que o provedor do banco oferece.** As chaves de provedor ficam como valores em texto claro em uma linha de configurações. Qualquer pessoa com acesso ao banco ou a um backup consegue lê-las.

**Sem hardening de transporte no nível da aplicação.** A aplicação não define um Content-Security-Policy nem headers HSTS por conta própria; isso depende da camada de hospedagem.

**As exportações CSV não são sanitizadas para planilhas.** Um valor que começa com um caractere de fórmula é escrito como está, o que é um risco se uma exportação for aberta em um aplicativo de planilha e os dados não forem confiáveis.

**Os logs não estão livres de identificadores.** Uma chamada de provedor que falha registra o CNPJ e o erro, não o nome da empresa. Os logs operacionais estão fora dos controles de retenção e de acesso da aplicação.

**Sem garantia formal.** Não houve teste de penetração, certificação de conformidade nem revisão das políticas por terceiros. O endpoint de health informa o nome e o papel do banco a um chamador não autenticado, o que é útil para operações e deveria ser restrito em uma implantação hostil.

## 6. Reportando um problema

Se você encontrar uma fraqueza no design como descrito aqui, abra um security advisory privado neste repositório ou contate o autor pelo perfil indicado no README. Por favor, não abra uma issue pública com detalhes de reprodução. Este repositório não contém código de produto, então espera-se que os relatos tratem dos mecanismos descritos, dos exemplos publicados ou da documentação.

# Modelo de segurança

Este documento descreve o que o produto protege, onde ficam as fronteiras de confiança, quais ameaças pesaram no desenho, o que está implementado e o que não tem garantia nenhuma. Ele fala do sistema privado, não deste repositório, que não contém código de produto executável.

## 1. Ativos

**Dados de empresas e contatos.** Dado cadastral, endereço, telefone, e-mail e site das empresas prospectadas, mais o histórico de interação de cada uma. O valor comercial do sistema está, em boa parte, nesse conjunto.

**Dados pessoais de indivíduos.** Nome, qualificação, faixa etária e documento mascarado dos sócios, tirados do registro público. Nome e e-mail de trabalho do time comercial. As notas que o vendedor escreve podem conter qualquer coisa que alguém digitou, inclusive nome e telefone de quem estava do outro lado.

**Desempenho comercial.** Atividade diária por vendedor, conversão, meta e funil. É sensível dentro da empresa, ainda que não seja dado pessoal.

**Credenciais.** Hash de senha do time, segredo de assinatura da sessão, segredo compartilhado do endpoint de cron e as chaves de três provedores externos.

## 2. Fronteiras de confiança

**Navegador para servidor.** Não confiável. Toda requisição pode vir forjada, repetida ou alterada. Do navegador o servidor aceita duas coisas: o cookie de sessão assinado e o payload de uma action, que passa por validação.

**Servidor para banco de dados.** Transporte confiável, duas identidades diferentes. O session pool é um papel restrito, sujeito a todas as políticas. O system pool é o dono do schema e ignora as políticas.

**Servidor para provedores.** Só de saída, só no servidor. A resposta é entrada não confiável: é lida com desconfiança, nunca executada nem renderizada como markup.

**Operador para implantação.** Variável de ambiente, runner de migration e console do banco. Quem tem a credencial do dono do schema tem acesso total, e nenhum controle da aplicação alcança essa pessoa.

## 3. Ameaças consideradas

*Ler a fila de outro vendedor trocando um identificador.* Os identificadores são UUID, mas adivinhar não é o modelo de ameaça; um link vazado ou compartilhado é. Toda leitura de atribuição ou de interação passa por uma política que compara o dono com o ator no contexto da transação.

*Subir de vendedor para gestor.* O papel viaja no cookie assinado e no contexto da transação. Cookie forjado não passa na verificação de assinatura. Cookie legítimo de usuário rebaixado mantém o papel antigo até expirar, o que é uma janela conhecida (seção 5).

*Roubar uma sessão.* O cookie é httpOnly, então script não lê; SameSite=Lax barra post de formulário vindo de outro site. Sobram três caminhos: navegador comprometido, segredo de assinatura vazado ou transporte sem criptografia fora de produção.

*Adivinhar senha.* O hash é bcrypt com fator de trabalho 10. Não há limite de tentativa nem bloqueio, então a defesa é o tamanho da senha e a base pequena de usuários, não o throttling.

*Extrair a base inteira.* O gestor exporta tudo o que enxerga, por design. O vendedor não exporta nada: as rotas de exportação recusam qualquer papel que não seja gestor. Ele continua lendo a própria fila por inteiro, que é o escopo previsto do trabalho dele.

*Vazar chave de provedor.* As chaves são lidas no servidor pela conexão administrativa e nunca entram no payload de uma página. Ficam guardadas como valor em texto claro numa linha de configurações que só gestor consegue ler pela aplicação.

*Abusar do endpoint agendado.* A rota de cron exige segredo compartilhado em header ou em parâmetro de consulta. Sem ele, devolve 401 e não faz nada.

*Injeção.* Toda consulta usa parâmetro. A única instrução montada dinamicamente compõe uma lista de colunas a partir de uma allowlist fixa de nomes de campo, nunca de entrada do usuário.

*Provedor comprometido ou fora do ar.* O provedor pode devolver dado errado, dado parcial ou erro. A interface rotula a fonte que falhou em vez de pôr um chute no lugar, e toda chamada tem timeout.

## 4. Controles implementados

- Row Level Security nas dez tabelas, com o papel da aplicação criado sem direito de superusuário e sem `BYPASSRLS`.
- Ator e papel gravados nas configurações locais da transação em cada unidade de trabalho; sem contexto, nenhuma linha.
- Views caller-scoped, para que o relatório não amplie o que a política permite.
- Sessão e papel reconferidos em toda server action e em toda rota de exportação, independentemente da política do banco.
- Cookie de sessão httpOnly, SameSite=Lax, Secure em produção, validade de oito horas, assinado com HS256.
- Senha com hash bcrypt; nenhuma consulta devolve hash para a aplicação, exceto a busca de login.
- Uma única função `SECURITY DEFINER` para a busca de login, com search path fixo, projeção estreita e execute revogado do público.
- Configurações que guardam chave de provedor, legíveis apenas por gestores; chaves resolvidas no servidor, com precedência das variáveis de ambiente.
- Exportações restritas a gestores e filtradas pelas mesmas políticas das telas.
- Proteção do último administrador ativo, para que o sistema não fique sem nenhum.
- User agent identificável e timeout explícito em toda chamada de saída.
- Modo de demonstração desligável por configuração, e um fallback sempre rotulado na interface.

## 5. O que não é garantido

**Sem MFA, sem limite de tentativa de login, sem bloqueio.** Senha fraca é risco real. O produto conta com o tamanho da senha e com uma base pequena e conhecida de usuários.

**Mudança de papel não é imediata.** O papel vive num token assinado válido por oito horas. Quem foi rebaixado ou desativado segue com o papel antigo na sessão aberta até ela expirar, embora o próximo login de um usuário desativado falhe.

**Token copiado não é revogado.** Sair limpa o cookie naquele navegador. Token copiado para outro lugar continua válido até vencer.

**A conexão de sistema ignora as políticas.** Ingestão cadastral, enriquecimento e escrituração das rodadas usam o dono do schema. A segurança deles depende do código de servidor que os chama, não do banco. É a maior premissa única do desenho.

**Nenhuma auditoria de leitura.** A escrita fica na tabela de interações. Leitura, exportação e login não entram no registro, então o sistema não responde quem olhou o quê.

**Nenhuma criptografia em repouso além da que o provedor do banco oferece.** As chaves de provedor ficam como valor em texto claro numa linha de configurações. Quem tem acesso ao banco ou a um backup consegue lê-las.

**Nenhum hardening de transporte na aplicação.** A aplicação não define Content-Security-Policy nem header HSTS por conta própria; isso depende da camada de hospedagem.

**Exportação CSV não é sanitizada para planilha.** Valor que começa com caractere de fórmula é escrito como está, o que é risco se a exportação for aberta em aplicativo de planilha e o dado não for confiável.

**Log não está livre de identificador.** Chamada de provedor que falha registra o CNPJ e o erro, não o nome da empresa. Os logs de operação ficam fora dos controles de retenção e de acesso da aplicação.

**Nenhuma garantia formal.** Não houve teste de penetração, certificação de conformidade nem revisão das políticas por terceiros. O endpoint de health informa nome e papel do banco a um chamador não autenticado, o que é útil para operação e deveria ser restrito em implantação hostil.

## 6. Como reportar um problema

Se você encontrar uma fraqueza no desenho descrito aqui, abra um security advisory privado neste repositório ou fale com o autor pelo perfil indicado no README. Não abra issue pública com detalhe de reprodução. Como este repositório não tem código de produto, o relato deve tratar dos mecanismos descritos, dos exemplos publicados ou da documentação.

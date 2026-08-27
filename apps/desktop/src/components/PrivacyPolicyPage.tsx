import { useEffect, type ReactNode } from 'react';
import { ArrowLeft, ExternalLink, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';

const EFFECTIVE_DATE = '20 de agosto de 2026';
const PRIVACY_EMAIL = 'privacidade@noxera.online';

const sections = [
  { id: 'escopo', label: '1. Escopo' },
  { id: 'dados-coletados', label: '2. Dados que tratamos' },
  { id: 'finalidades', label: '3. Como usamos os dados' },
  { id: 'bases-legais', label: '4. Bases legais' },
  { id: 'midia-permissoes', label: '5. Voz, vídeo e permissões' },
  { id: 'compartilhamento', label: '6. Compartilhamento' },
  { id: 'transferencias', label: '7. Transferências internacionais' },
  { id: 'retencao', label: '8. Retenção' },
  { id: 'direitos', label: '9. Seus direitos' },
  { id: 'seguranca', label: '10. Segurança' },
  { id: 'menores', label: '11. Menores de idade' },
  { id: 'alteracoes', label: '12. Alterações' },
  { id: 'contato', label: '13. Contato' },
] as const;

export function PrivacyPolicyPage() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;

    document.title = 'Política de Privacidade — Guilda';
    if (description) {
      description.content =
        'Saiba como a Guilda coleta, utiliza, compartilha e protege dados pessoais.';
    }

    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, []);

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(circle at 12% 2%, rgba(150,132,255,.18), transparent 28%), radial-gradient(circle at 90% 22%, rgba(117,224,189,.1), transparent 24%)',
        }}
      />

      <header className="relative z-10 border-b border-line/80 bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
          <a href="/" className="flex items-center gap-3" aria-label="Noxera — início">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet text-canvas shadow-glow">
              <Sparkles size={21} aria-hidden="true" />
            </span>
            <span className="text-lg font-bold tracking-tight">noxera</span>
          </a>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel/80 px-4 py-2.5 text-sm font-semibold transition hover:border-violet/50 hover:bg-panelRaised"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Voltar ao início
          </a>
        </div>
      </header>

      <div className="relative mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:px-12 lg:py-20">
        <aside className="self-start lg:sticky lg:top-8">
          <div className="rounded-3xl border border-line bg-panel/70 p-5 shadow-xl shadow-black/10 backdrop-blur">
            <p className="flex items-center gap-2 text-sm font-semibold text-mint">
              <ShieldCheck size={17} aria-hidden="true" /> Documento público
            </p>
            <p className="mt-3 text-xs leading-5 text-muted">Em vigor desde {EFFECTIVE_DATE}.</p>
            <nav
              className="mt-5 hidden border-t border-line pt-5 lg:block"
              aria-label="Nesta política"
            >
              <ul className="space-y-1.5">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="block rounded-lg px-2.5 py-1.5 text-xs leading-5 text-muted transition hover:bg-white/5 hover:text-ink"
                    >
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </aside>

        <article className="min-w-0 rounded-[2rem] border border-line bg-panel/75 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-10 lg:p-14">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[.18em] text-mint">
              Privacidade e proteção de dados
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">
              Política de Privacidade da Guilda
            </h1>
            <p className="mt-6 text-base leading-8 text-muted sm:text-lg">
              Esta política explica como a Guilda, apresentada no site sob a marca Noxera, trata
              dados pessoais quando você usa nosso site, aplicativo web, aplicativo desktop e
              serviços de comunicação.
            </p>
            <div className="mt-7 flex flex-wrap gap-3 text-xs font-semibold text-muted">
              <span className="rounded-full border border-line bg-canvas/60 px-3 py-1.5">
                Última atualização: {EFFECTIVE_DATE}
              </span>
              <span className="rounded-full border border-line bg-canvas/60 px-3 py-1.5">
                Aplicável à web e ao desktop
              </span>
            </div>
          </div>

          <div className="mt-12 max-w-3xl space-y-12 text-[15px] leading-7 text-muted sm:text-base sm:leading-8">
            <PolicySection id="escopo" title="1. Escopo">
              <p>
                Esta política se aplica à Guilda em Windows, macOS, Linux e navegador, aos serviços
                hospedados em <strong className="text-ink">noxera.online</strong> e às APIs
                necessárias para autenticação, mensagens, arquivos e comunicação em tempo real.
                Serviços de terceiros acessados por links próprios possuem políticas independentes.
              </p>
            </PolicySection>

            <PolicySection id="dados-coletados" title="2. Dados que tratamos">
              <ul className="list-disc space-y-3 pl-5 marker:text-violet">
                <li>
                  <strong className="text-ink">Conta e perfil:</strong> e-mail, nome de usuário,
                  nome de exibição, imagem de perfil, identificadores internos e senha armazenada
                  somente na forma de hash seguro.
                </li>
                <li>
                  <strong className="text-ink">Conteúdo e atividade:</strong> comunidades, canais,
                  mensagens, mensagens diretas, reações, anexos, convites, relações de amizade,
                  bloqueios, denúncias e registros de moderação.
                </li>
                <li>
                  <strong className="text-ink">Estado em tempo real:</strong> presença, digitação,
                  participação em canais de voz e estado de microfone, câmera ou compartilhamento.
                  Esses sinais são majoritariamente efêmeros.
                </li>
                <li>
                  <strong className="text-ink">Dados técnicos:</strong> endereço IP, data e hora,
                  identificadores de sessão e requisição, sistema operacional, tipo de cliente,
                  eventos de segurança, falhas e informações necessárias para diagnosticar o
                  serviço.
                </li>
                <li>
                  <strong className="text-ink">Armazenamento local:</strong> o aplicativo web
                  utiliza o armazenamento do navegador para manter a sessão autenticada. O
                  aplicativo desktop utiliza o armazenamento seguro de credenciais disponível no
                  sistema operacional quando suportado.
                </li>
              </ul>
            </PolicySection>

            <PolicySection id="finalidades" title="3. Como usamos os dados">
              <p>Tratamos dados para:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-violet">
                <li>criar, autenticar e proteger sua conta;</li>
                <li>entregar mensagens, arquivos, notificações e recursos sociais;</li>
                <li>operar voz, vídeo e compartilhamento de tela em tempo real;</li>
                <li>aplicar permissões, bloqueios, denúncias e ações de moderação;</li>
                <li>prevenir fraude, abuso, invasões e outros incidentes de segurança;</li>
                <li>manter, diagnosticar e melhorar estabilidade e desempenho;</li>
                <li>cumprir obrigações legais e responder a solicitações válidas.</li>
              </ul>
              <p className="mt-4 font-medium text-ink">
                Não vendemos dados pessoais nem utilizamos o conteúdo das suas conversas para
                publicidade direcionada.
              </p>
            </PolicySection>

            <PolicySection id="bases-legais" title="4. Bases legais">
              <p>
                Conforme a Lei Geral de Proteção de Dados Pessoais (LGPD), o tratamento pode se
                basear na execução do serviço solicitado, no cumprimento de obrigação legal, no
                exercício regular de direitos, em interesses legítimos de segurança e melhoria do
                serviço e, quando aplicável, no consentimento. Permissões de câmera, microfone,
                notificações e captura de tela permanecem sob controle do usuário e do sistema
                operacional.
              </p>
            </PolicySection>

            <PolicySection id="midia-permissoes" title="5. Voz, vídeo e permissões do dispositivo">
              <p>
                Microfone, câmera e compartilhamento de tela são acessados somente depois de uma
                ação do usuário e das permissões exigidas pela plataforma. Os fluxos de áudio, vídeo
                e tela são transportados em tempo real por WebRTC e software LiveKit operado na
                infraestrutura da Guilda. A Guilda não grava nem armazena rotineiramente o conteúdo
                desses fluxos. Outros participantes presentes na chamada recebem o conteúdo enquanto
                a transmissão estiver ativa e podem usar recursos externos de gravação sobre os
                quais não temos controle.
              </p>
            </PolicySection>

            <PolicySection id="compartilhamento" title="6. Quando compartilhamos dados">
              <p>Podemos compartilhar dados somente nas seguintes situações:</p>
              <ul className="mt-3 list-disc space-y-3 pl-5 marker:text-violet">
                <li>
                  <strong className="text-ink">Com outros usuários:</strong> perfil, presença e
                  conteúdo ficam visíveis conforme a conversa, comunidade e permissões escolhidas.
                </li>
                <li>
                  <strong className="text-ink">Com operadores de infraestrutura:</strong>
                  Cloudflare fornece entrega e proteção do site; Oracle Cloud Infrastructure hospeda
                  serviços, banco de dados e arquivos; GitHub hospeda artefatos públicos de
                  atualização; Microsoft processa instalação e atualização pelo Microsoft Store.
                </li>
                <li>
                  <strong className="text-ink">Por segurança ou obrigação legal:</strong> quando
                  necessário para investigar abuso, proteger direitos ou responder a ordem válida de
                  autoridade competente.
                </li>
                <li>
                  <strong className="text-ink">Em reorganização:</strong> mediante proteção
                  compatível, caso o serviço seja objeto de fusão, aquisição ou transferência.
                </li>
              </ul>
              <p className="mt-4">
                Cada operador trata somente os dados necessários ao serviço contratado e está
                sujeito aos próprios compromissos de privacidade e segurança.
              </p>
            </PolicySection>

            <PolicySection id="transferencias" title="7. Transferências internacionais">
              <p>
                A infraestrutura e seus fornecedores podem processar dados fora do Brasil. Nessas
                situações, buscamos utilizar fornecedores com medidas contratuais, técnicas e
                organizacionais adequadas e mecanismos admitidos pela legislação aplicável.
              </p>
            </PolicySection>

            <PolicySection id="retencao" title="8. Retenção e exclusão">
              <p>
                Mantemos dados enquanto forem necessários para operar a conta e os recursos
                solicitados, preservar a segurança, resolver disputas e cumprir obrigações legais.
                Mensagens e arquivos permanecem até serem excluídos pelo usuário ou por moderação,
                quando o recurso estiver disponível. Sessões expiram ou são revogadas; presença e
                digitação são removidas após desconexão ou timeout. Registros técnicos e cópias de
                segurança podem permanecer por período adicional limitado até sua rotação segura.
              </p>
              <p className="mt-4">
                Solicitações de exclusão de conta e dados podem ser enviadas ao canal indicado na
                seção de contato. Alguns registros podem ser preservados quando houver obrigação
                legal, necessidade de segurança ou exercício regular de direitos.
              </p>
            </PolicySection>

            <PolicySection id="direitos" title="9. Seus direitos e escolhas">
              <p>
                Nos limites da legislação aplicável, você pode solicitar confirmação e acesso,
                correção, portabilidade quando cabível, informação sobre compartilhamentos,
                anonimização, bloqueio ou exclusão, revogação de consentimento e revisão de decisões
                automatizadas. Também pode se opor a tratamentos baseados em interesse legítimo.
              </p>
              <p className="mt-4">
                Para proteger sua conta, podemos solicitar informações razoáveis para confirmar sua
                identidade. Você também pode controlar permissões de mídia nas configurações do
                sistema, encerrar sessões, bloquear usuários e excluir conteúdo pelos controles
                disponíveis no produto.
              </p>
            </PolicySection>

            <PolicySection id="seguranca" title="10. Segurança">
              <p>
                Aplicamos controles como hashing de senhas, comunicação criptografada, tokens com
                expiração e revogação, validação de entrada, autorização no servidor, limitação de
                requisições, registros de auditoria e armazenamento seguro de segredos. Nenhum
                sistema é totalmente invulnerável; por isso, incidentes suspeitos devem ser
                comunicados pelo canal de privacidade.
              </p>
            </PolicySection>

            <PolicySection id="menores" title="11. Menores de idade">
              <p>
                A Guilda não é direcionada a crianças menores de 13 anos. Pessoas abaixo da idade
                mínima exigida em seu país devem usar o serviço somente com autorização válida do
                responsável. Se identificarmos tratamento indevido de dados de criança, adotaremos
                medidas para excluir ou restringir esses dados.
              </p>
            </PolicySection>

            <PolicySection id="alteracoes" title="12. Alterações nesta política">
              <p>
                Podemos atualizar esta política para refletir mudanças no produto, na infraestrutura
                ou na legislação. A data no início do documento será alterada e, quando a mudança
                for relevante, forneceremos aviso adequado no produto ou no site.
              </p>
            </PolicySection>

            <PolicySection id="contato" title="13. Contato de privacidade">
              <p>
                Para dúvidas, solicitações relacionadas a dados pessoais ou relatos de incidente,
                envie um e-mail para:
              </p>
              <a
                href={`mailto:${PRIVACY_EMAIL}`}
                className="mt-5 inline-flex items-center gap-2 rounded-xl border border-violet/40 bg-violet/10 px-4 py-3 font-semibold text-ink transition hover:border-violet hover:bg-violet/15"
              >
                <LockKeyhole size={17} aria-hidden="true" /> {PRIVACY_EMAIL}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              <p className="mt-4 text-sm">
                Informe o e-mail vinculado à conta e descreva o pedido. Não envie sua senha, tokens
                ou outros segredos.
              </p>
            </PolicySection>
          </div>
        </article>
      </div>

      <footer className="relative border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <span>© 2026 Guilda. Política aplicável aos serviços Noxera.</span>
          <a href="/" className="font-semibold text-ink transition hover:text-violet">
            Voltar para noxera.online
          </a>
        </div>
      </footer>
    </main>
  );
}

function PolicySection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-line pt-9 first:border-0 first:pt-0">
      <h2 className="text-2xl font-semibold tracking-[-.025em] text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

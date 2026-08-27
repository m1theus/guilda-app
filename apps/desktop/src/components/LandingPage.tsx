import { useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  Globe2,
  MessageCircle,
  Monitor,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import packageJson from '../../package.json';

type DesktopOs = 'windows' | 'macos' | 'linux';
interface DesktopDownload {
  id: DesktopOs;
  name: string;
  detail: string;
  file?: string;
  href?: string;
  action?: string;
  alternate?: { label: string; file: string };
}

const releaseBaseUrl = 'https://github.com/m1theus/guilda-releases/releases/latest/download';
const version = packageJson.version;
const microsoftStoreUrl = import.meta.env.VITE_MSSTORE_URL?.trim();
const downloads: DesktopDownload[] = [
  {
    id: 'windows',
    name: 'Windows',
    detail: microsoftStoreUrl
      ? 'Windows 10 ou superior · Microsoft Store'
      : 'Disponível em breve na Microsoft Store',
    ...(microsoftStoreUrl
      ? { href: microsoftStoreUrl, action: 'Obter na Microsoft Store' }
      : { action: 'Em breve na Microsoft Store' }),
  },
  {
    id: 'macos',
    name: 'macOS',
    detail: 'macOS 11 ou superior · Apple Silicon',
    file: `Guilda_${version}_aarch64.dmg`,
  },
  {
    id: 'linux',
    name: 'Linux',
    detail: 'Distribuições 64 bits · AppImage',
    file: `Guilda_${version}_amd64.AppImage`,
    alternate: { label: 'Baixar pacote .deb', file: `Guilda_${version}_amd64.deb` },
  },
];

function detectDesktopOs(): DesktopOs | null {
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'macos';
  if (platform.includes('linux')) return 'linux';
  return null;
}

function releaseUrl(file: string): string {
  return `${releaseBaseUrl}/${encodeURIComponent(file)}`;
}

function downloadUrl(download: DesktopDownload): string | null {
  if (download.href) return download.href;
  if (download.file) return releaseUrl(download.file);
  return null;
}

export function LandingPage() {
  const detectedOs = useMemo(detectDesktopOs, []);

  return (
    <main className="min-h-screen overflow-hidden bg-canvas text-ink">
      <div
        className="pointer-events-none fixed inset-0 opacity-80"
        style={{
          background:
            'radial-gradient(circle at 15% 8%, rgba(150,132,255,.2), transparent 31%), radial-gradient(circle at 88% 35%, rgba(117,224,189,.12), transparent 28%), radial-gradient(circle at 50% 100%, rgba(255,130,120,.08), transparent 30%)',
        }}
      />

      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8 lg:px-12">
        <a href="/" className="flex items-center gap-3" aria-label="Noxera — início">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet text-canvas shadow-glow">
            <Sparkles size={21} />
          </span>
          <span className="text-lg font-bold tracking-tight">noxera</span>
        </a>
        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Navegação principal">
          <a
            href="#downloads"
            className="hidden rounded-xl px-4 py-2.5 text-sm font-medium text-muted transition hover:text-ink sm:block"
          >
            Downloads
          </a>
          <a
            href="/app"
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel/80 px-4 py-2.5 text-sm font-semibold transition hover:border-violet/50 hover:bg-panelRaised"
          >
            Entrar <ArrowRight size={16} />
          </a>
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-24 pt-16 sm:px-8 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(460px,.88fr)] lg:px-12 lg:pb-32 lg:pt-24">
        <div className="relative z-10 max-w-3xl">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-violet/25 bg-violet/10 px-3 py-1.5 text-sm font-medium text-violet">
            <Globe2 size={15} /> Sua comunidade, em qualquer lugar
          </div>
          <h1 className="text-5xl font-semibold leading-[.98] tracking-[-.055em] sm:text-6xl lg:text-7xl">
            Conversas que viram
            <span className="block text-violet">comunidade.</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted sm:text-xl">
            Um espaço direto e acolhedor para reunir pessoas, organizar canais e manter cada
            conversa por perto.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              href="/app"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-violet px-6 text-sm font-bold text-canvas shadow-glow transition hover:-translate-y-0.5 hover:brightness-110"
            >
              Abrir no navegador <ArrowRight size={17} />
            </a>
            <a
              href="#downloads"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-panel/70 px-6 text-sm font-semibold transition hover:border-violet/40 hover:bg-panelRaised"
            >
              <Download size={17} /> Baixar para desktop
            </a>
          </div>
          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted">
            <span className="inline-flex items-center gap-2">
              <Check size={15} className="text-mint" /> Texto, voz e vídeo
            </span>
            <span className="inline-flex items-center gap-2">
              <Check size={15} className="text-mint" /> Web e desktop
            </span>
          </div>
        </div>

        <ProductPreview />
      </section>

      <section className="relative border-y border-line/80 bg-panel/35">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-10 sm:grid-cols-3 sm:px-8 lg:px-12">
          <Feature
            icon={<MessageCircle size={19} />}
            title="Canais organizados"
            description="Um lugar certo para cada assunto, sem perder o ritmo da conversa."
          />
          <Feature
            icon={<Users size={19} />}
            title="Feito para grupos"
            description="Reúna amigos, equipes e comunidades com papéis e espaços próprios."
          />
          <Feature
            icon={<ShieldCheck size={19} />}
            title="Você no controle"
            description="Permissões e moderação integradas para manter cada espaço saudável."
          />
        </div>
      </section>

      <section
        id="downloads"
        className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-12 lg:py-32"
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-mint">
            Noxera desktop
          </p>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-.04em] sm:text-5xl">
            Escolha o seu sistema
          </h2>
          <p className="mt-5 text-base leading-7 text-muted">
            Tenha notificações, atualizações automáticas e acesso rápido direto da sua área de
            trabalho.
          </p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {downloads.map((download) => {
            const recommended = download.id === detectedOs;
            const href = downloadUrl(download);
            return (
              <article
                key={download.id}
                className={`relative flex min-h-64 flex-col rounded-[1.75rem] border p-6 transition sm:p-7 ${
                  recommended
                    ? 'border-violet/55 bg-violet/10 shadow-glow'
                    : 'border-line bg-panel/75 hover:border-violet/35'
                }`}
              >
                {recommended && (
                  <span className="absolute right-5 top-5 rounded-full bg-violet px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-canvas">
                    Seu dispositivo
                  </span>
                )}
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-canvas text-violet">
                  <Monitor size={22} />
                </span>
                <h3 className="mt-6 text-2xl font-semibold">{download.name}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{download.detail}</p>
                <div className="mt-auto pt-7">
                  {href ? (
                    <a
                      href={href}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-bold text-canvas transition hover:-translate-y-0.5 hover:bg-white"
                    >
                      <Download size={16} /> {download.action ?? `Baixar para ${download.name}`}
                    </a>
                  ) : (
                    <span
                      aria-disabled="true"
                      className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-line bg-panelRaised px-4 py-3 text-sm font-bold text-muted"
                    >
                      <ShieldCheck size={16} /> {download.action}
                    </span>
                  )}
                  {download.alternate && (
                    <a
                      href={releaseUrl(download.alternate.file)}
                      className="mt-3 block text-center text-xs font-semibold text-muted transition hover:text-ink"
                    >
                      {download.alternate.label}
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <p className="mt-6 text-center text-xs text-muted">Versão {version}</p>
      </section>

      <footer className="relative border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <Sparkles size={15} className="text-violet" /> noxera
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <p>Conversas melhores começam com um lugar para pertencer.</p>
            <a
              href="/privacy"
              className="text-xs font-semibold text-ink transition hover:text-violet"
            >
              Política de Privacidade
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="rounded-2xl border border-transparent p-5 transition hover:border-line hover:bg-panel/50">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet/10 text-violet">
        {icon}
      </span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
    </article>
  );
}

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-xl lg:ml-auto">
      <div className="absolute -inset-8 rounded-full bg-violet/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.8rem] border border-line bg-panel shadow-2xl shadow-black/40">
        <div className="flex h-11 items-center gap-2 border-b border-line px-4">
          <span className="h-2.5 w-2.5 rounded-full bg-coral/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-300/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-mint/70" />
          <span className="ml-3 text-[11px] font-medium text-muted">Noxera · Clube criativo</span>
        </div>
        <div className="grid min-h-[360px] grid-cols-[72px_140px_1fr] sm:grid-cols-[76px_170px_1fr]">
          <div className="border-r border-line bg-canvas/70 p-3">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className={`mb-3 h-11 rounded-2xl ${item === 0 ? 'bg-violet' : 'bg-panelRaised'}`}
              />
            ))}
          </div>
          <div className="border-r border-line p-4">
            <p className="text-xs font-bold">Clube criativo</p>
            <p className="mt-5 text-[9px] font-semibold uppercase tracking-wider text-muted">
              Canais
            </p>
            {['geral', 'projetos', 'referências', 'conversa-livre'].map((channel, index) => (
              <div
                key={channel}
                className={`mt-2 rounded-lg px-2 py-1.5 text-[10px] ${index === 1 ? 'bg-violet/15 text-violet' : 'text-muted'}`}
              >
                # {channel}
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-col p-4 sm:p-5">
            <div className="border-b border-line pb-3">
              <p className="text-xs font-semibold"># projetos</p>
              <p className="mt-1 text-[9px] text-muted">Compartilhe o que está criando</p>
            </div>
            <div className="flex-1 space-y-5 py-5">
              <PreviewMessage color="bg-mint" width="w-4/5" />
              <PreviewMessage color="bg-violet" width="w-3/5" />
              <PreviewMessage color="bg-coral" width="w-3/4" />
            </div>
            <div className="h-10 rounded-xl border border-line bg-canvas/70" />
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewMessage({ color, width }: { color: string; width: string }) {
  return (
    <div className="flex gap-3">
      <span className={`h-8 w-8 shrink-0 rounded-xl ${color}`} />
      <div className="min-w-0 flex-1 pt-1">
        <div className="h-2 w-20 rounded-full bg-ink/70" />
        <div className={`mt-2 h-2 rounded-full bg-muted/20 ${width}`} />
        <div className="mt-1.5 h-2 w-2/5 rounded-full bg-muted/15" />
      </div>
    </div>
  );
}

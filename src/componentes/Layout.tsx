import { NavLink, Outlet } from 'react-router-dom';
import { useSessao } from '../banco/sessao';
import { PAPEL_LEGIVEL } from '../banco/tipos';

export function Layout() {
  const { usuario, sair } = useSessao();

  // Espelha o recorte das policies. É só uma dica de navegação: quem montar a
  // URL à mão chega na tela, e lá o banco devolve vazio — que é o
  // comportamento certo. O menu evita o passeio inútil, não é a proteção.
  const enxergaTudo = usuario?.papel === 'advogado_responsavel'
                   || usuario?.papel === 'secretaria'
                   || usuario?.admin_escritorio === true;
  const podeAdministrar = usuario?.admin_escritorio === true
                       || usuario?.papel === 'advogado_responsavel';

  const estiloAba = ({ isActive }: { isActive: boolean }) =>
    [
      'rounded-md px-3 py-2 text-sm font-medium',
      isActive
        ? 'bg-sky-100 text-sky-900'
        : 'text-slate-700 hover:bg-slate-100',
    ].join(' ');

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Primeiro elemento focável da página: pula a navegação e leva direto
          ao conteúdo. Para quem usa teclado, sem isso toda troca de tela
          custa passar por todos os links do menu de novo. Fica escondido até
          receber foco. */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4
                   focus:top-4 focus:z-50 focus:rounded-md focus:bg-white
                   focus:px-4 focus:py-2 focus:font-medium focus:text-sky-900"
      >
        Pular para o conteúdo
      </a>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <span className="font-semibold text-slate-900">Flypi Docket</span>

          {/* A ordem não é alfabética: prazos primeiro porque é o que tem
              consequência se ficar sem olhar. As seções de administração
              aparecem só para quem pode usá-las — item de menu que leva a uma
              tela vazia por falta de permissão ensina o usuário a ignorar o
              menu. */}
          <nav aria-label="Seções" className="flex flex-wrap gap-1">
            <NavLink to="/pauta" className={estiloAba}>Pauta</NavLink>
            <NavLink to="/prazos" className={estiloAba}>A confirmar</NavLink>
            <NavLink to="/processos" className={estiloAba}>Processos</NavLink>
            <NavLink to="/tarefas" className={estiloAba}>Tarefas</NavLink>
            {enxergaTudo && (
              <NavLink to="/clientes" className={estiloAba}>Clientes</NavLink>
            )}
            <NavLink to="/calendario" className={estiloAba}>Calendário</NavLink>
            {podeAdministrar && (
              <>
                <NavLink to="/equipe" className={estiloAba}>Equipe</NavLink>
                <NavLink to="/auditoria" className={estiloAba}>Auditoria</NavLink>
              </>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {usuario && (
              <span className="text-right text-sm leading-tight">
                <span className="block font-medium text-slate-900">
                  {usuario.nome}
                </span>
                <span className="block text-slate-600">
                  {PAPEL_LEGIVEL[usuario.papel] ?? usuario.papel}
                </span>
              </span>
            )}
            <button
              type="button" onClick={() => void sair()}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm
                         font-medium text-slate-700 hover:bg-slate-100"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* id que o skip link procura, e tabIndex -1 para que o foco possa
          realmente parar aqui quando o link é acionado. */}
      <main id="conteudo" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

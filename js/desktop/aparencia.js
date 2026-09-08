import { supabase, requireAuth, configurarBotaoSair } from '../supabaseClient.js';
import { aplicarTemaSalvo, TEMAS, temaAtual, definirTema, salvarTemaNoBanco, carregarTemaDoBanco } from '../temaService.js';
import { montarNavRail } from './navRail.js';
import { abrirComandos } from './comandos.js';

let usuarioAtual = null;

function corDoEsquema(tema) {
  const escuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return escuro ? tema.dark : tema.light;
}

function iconeCheck() {
  return '<svg class="tema-check" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
}

function renderGrade() {
  const container = document.getElementById('grade-temas');
  const atualId = temaAtual();

  container.innerHTML = TEMAS.map((tema) => {
    const cor = corDoEsquema(tema);
    const selecionado = tema.id === atualId;
    return `
      <button type="button" class="tema-item ${selecionado ? 'selecionado' : ''}" data-id="${tema.id}">
        <div class="tema-amostra" style="background: linear-gradient(135deg, ${cor.grad1}, ${cor.grad2})">
          ${selecionado ? iconeCheck() : ''}
        </div>
        <div class="tema-nome">${tema.nome}</div>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.tema-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (id === temaAtual()) return;
      if (usuarioAtual) {
        await salvarTemaNoBanco(supabase, usuarioAtual.id, id);
      } else {
        definirTema(id);
      }
      renderGrade();
    });
  });
}

async function iniciar() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  montarNavRail('aparencia');
  configurarBotaoSair();
  document.getElementById('btn-topbar-busca').addEventListener('click', abrirComandos);

  renderGrade();

  try {
    await carregarTemaDoBanco(supabase, user.id);
    renderGrade();
  } catch (err) {
    console.error(err);
  }
}

iniciar();

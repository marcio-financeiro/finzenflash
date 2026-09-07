import { supabase, requireAuth, configurarBotaoSair } from './supabaseClient.js';
import { montarNavInferior } from './navInferior.js?v=5';
import { aplicarTemaSalvo, TEMAS, temaAtual, definirTema, salvarTemaNoBanco, carregarTemaDoBanco } from './temaService.js?v=3';

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

async function init() {
  aplicarTemaSalvo();
  montarNavInferior('aparencia');
  configurarBotaoSair();

  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  renderGrade();

  try {
    await carregarTemaDoBanco(supabase, user.id);
    renderGrade();
  } catch (err) {
    console.error(err);
  }
}

init();

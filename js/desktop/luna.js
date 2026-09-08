import { supabase, requireAuth, configurarBotaoSair } from '../supabaseClient.js';
import { aplicarTemaSalvo } from '../temaService.js';
import { coletarContexto, buildSystemPrompt, renderMd } from '../lunaContext.js';
import { montarNavRail } from './navRail.js';
import { abrirComandos } from './comandos.js';

let usuarioAtual = null;
let historico = [];
let contexto = null;
let carregando = false;

const el = (id) => document.getElementById(id);

async function analyzeRequest(body) {
  const { data: sd } = await supabase.auth.getSession();
  const token = sd.session?.access_token;
  if (!token) throw new Error('Não autenticado');
  return fetch('/api/luna-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function inicializar() {
  el('statusContexto').textContent = 'Carregando seus dados...';
  try {
    contexto = await coletarContexto(usuarioAtual.id);
    el('statusContexto').textContent = 'Pronta pra ajudar';
    el('inputMsg').disabled = false;
    el('btnEnviar').disabled = false;
    el('inputMsg').placeholder = 'Pergunte sobre seus gastos, cartões, metas...';
  } catch (err) {
    console.error(err);
    el('statusContexto').textContent = 'Erro ao carregar seus dados';
  }
}

function addMsg(role, conteudo = '', animado = false) {
  const wrap = el('mensagens');
  el('emptyState')?.remove();

  const div = document.createElement('div');
  div.className = `chat-msg chat-msg-${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.innerHTML = role === 'ai'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  if (role === 'ai') {
    bubble.innerHTML = animado ? '<span class="chat-cursor"></span>' : renderMd(conteudo);
  } else {
    bubble.textContent = conteudo;
  }

  div.appendChild(avatar);
  div.appendChild(bubble);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return bubble;
}

function addTyping() {
  el('emptyState')?.remove();
  const wrap = el('mensagens');
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-ai';

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/></svg>';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = '<div class="chat-dots"><span></span><span></span><span></span></div>';

  div.appendChild(avatar);
  div.appendChild(bubble);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

async function enviar(mensagemForcada) {
  if (carregando || !contexto) return;

  const input = el('inputMsg');
  const mensagem = (mensagemForcada ?? input.value).trim();
  if (!mensagem) return;

  carregando = true;
  input.value = '';
  input.style.height = 'auto';
  el('btnEnviar').disabled = true;

  addMsg('user', mensagem);
  historico.push({ role: 'user', content: mensagem });

  const typing = addTyping();
  let textoAcumulado = '';
  let bubble = null;
  let primeiroChunk = true;

  try {
    const resp = await analyzeRequest({
      prompt: mensagem,
      system: buildSystemPrompt(contexto),
      history: historico.slice(-10),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || 'Limite diário de IA atingido.');
      }
      throw new Error(`Erro ${resp.status}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const linhas = buffer.split('\n');
      buffer = linhas.pop();

      for (const linha of linhas) {
        if (!linha.startsWith('data: ')) continue;
        const raw = linha.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const json = JSON.parse(raw);
          const delta = json?.delta?.text || '';
          if (delta) {
            if (primeiroChunk) {
              typing.remove();
              bubble = addMsg('ai', '', true);
              primeiroChunk = false;
            }
            textoAcumulado += delta;
            bubble.innerHTML = renderMd(textoAcumulado) + '<span class="chat-cursor"></span>';
            el('mensagens').scrollTop = el('mensagens').scrollHeight;
          }
        } catch (_) { /* linha incompleta, ignora */ }
      }
    }

    if (bubble) bubble.innerHTML = renderMd(textoAcumulado);
    historico.push({ role: 'assistant', content: textoAcumulado });
    if (historico.length > 20) historico.splice(0, 2);
  } catch (err) {
    typing?.remove();
    addMsg('ai', err.message || 'Não consegui processar sua mensagem agora.');
  } finally {
    carregando = false;
    el('btnEnviar').disabled = false;
    input.focus();
  }
}

function limparChat() {
  historico = [];
  el('mensagens').innerHTML = `
    <div id="emptyState" class="chat-empty">
      <div class="chat-empty-icone">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/></svg>
      </div>
      <h3>Olá! Eu sou a Luna</h3>
      <p>Tenho acesso aos seus dados financeiros reais. Pergunte sobre gastos, receitas, cartões e mais.</p>
    </div>`;
}

async function iniciar() {
  aplicarTemaSalvo();
  const user = await requireAuth();
  if (!user) return;
  usuarioAtual = user;

  montarNavRail('luna');
  configurarBotaoSair();
  document.getElementById('btn-topbar-busca').addEventListener('click', abrirComandos);

  el('inputMsg').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });
  el('inputMsg').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  });
  el('btnEnviar').addEventListener('click', () => enviar());
  el('btnLimpar').addEventListener('click', limparChat);
  el('chatSuggestions').addEventListener('click', (e) => {
    const chip = e.target.closest('.chat-chip');
    if (chip) enviar(chip.dataset.msg);
  });

  await inicializar();
}

iniciar();

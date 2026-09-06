// js/lunaInsights.js — Painel proativo da Luna na Home
// Cache de 6h em localStorage. Se a IA falhar, usa fallback local sem IA.

import { supabase } from './supabaseClient.js';
import { coletarContextoResumo } from './lunaContext.js';

const CACHE_KEY = 'flash_luna_panel_v1';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas

function lerCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.insights) || typeof parsed?.ts !== 'number') {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed;
  } catch (_) {
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function salvarCache(insights) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ insights, ts: Date.now() })); } catch (_) {}
}

function cacheValido(c) {
  return c && (Date.now() - c.ts) < CACHE_TTL;
}

async function buscarInsights(userId) {
  const cached = lerCache();
  if (cacheValido(cached)) return cached.insights;

  try {
    const contexto = await coletarContextoResumo(userId);

    const { data: sd } = await supabase.auth.getSession();
    const token = sd.session?.access_token;
    if (!token) throw new Error('Não autenticado');

    const res = await fetch('/api/luna-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contexto }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { insights } = await res.json();

    if (insights?.length) {
      salvarCache(insights);
      return insights;
    }
  } catch (err) {
    console.warn('[lunaInsights] IA indisponível, usando fallback local:', err.message);
  }

  try {
    return await insightsFallback(userId);
  } catch (err) {
    console.error('[lunaInsights] fallback também falhou:', err);
    return ['Tudo em ordem por hoje'];
  }
}

async function insightsFallback(userId) {
  const hoje = new Date();
  const hojeISO = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const em7ISO = new Date(hoje.getTime() + 7 * 86400000 - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const ref = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

  const [{ data: faturas }, { data: ciclos }, { data: pendentes }] = await Promise.all([
    supabase.from('card_transactions').select('valor_parcela').eq('user_id', userId).eq('status', 'aberta').eq('fatura_referencia', ref),
    supabase.from('offshore_cycles').select('data_embarque').eq('user_id', userId).gt('data_embarque', hojeISO).order('data_embarque').limit(1),
    supabase.from('transactions').select('id').eq('user_id', userId).eq('status', 'pendente').gte('date', hojeISO).lte('date', em7ISO),
  ]);

  const insights = [];
  const totalFat = (faturas || []).reduce((s, f) => s + Number(f.valor_parcela || 0), 0);
  if (totalFat > 0) insights.push(`Fatura do mês: R$ ${totalFat.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);

  const prox = ciclos?.[0];
  if (prox) {
    const dias = Math.ceil((new Date(prox.data_embarque) - hoje) / 86400000);
    insights.push(`Embarque em ${dias} dia${dias !== 1 ? 's' : ''} — ${prox.data_embarque}`);
  }

  if ((pendentes || []).length > 0) insights.push(`${pendentes.length} lançamento(s) pendente(s) esta semana`);
  if (!insights.length) insights.push('Tudo em ordem por hoje');

  return insights;
}

export async function iniciarLunaInsights(userId) {
  const el = document.getElementById('luna-insight-texto');
  if (!el) return;

  try {
    const insights = await buscarInsights(userId);
    el.textContent = (insights.length ? insights : ['Tudo em ordem por hoje']).join('  ·  ');
  } catch (err) {
    console.error('[lunaInsights] erro fatal:', err);
    el.textContent = 'Tudo em ordem por hoje';
  }
}

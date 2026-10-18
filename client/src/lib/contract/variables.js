import { formatDoc, formatStoredPhone } from '../format.js';
import { formatDateISO, isoToday } from './model.js';
import { VAR_RE, lookup } from './fill.js';

// Variáveis que o usuário pode usar nos textos do contrato.
export const VARIABLE_GROUPS = [
  {
    group: 'cliente', title: 'Dados do cliente', items: [
      ['nome', 'Nome'], ['documento', 'CPF/CNPJ'], ['email', 'E-mail'], ['telefone', 'WhatsApp'],
      ['endereco', 'Endereço completo'], ['cep', 'CEP'], ['rua', 'Rua'], ['numero', 'Número'], ['complemento', 'Complemento'],
      ['bairro', 'Bairro'], ['cidade', 'Cidade'], ['estado', 'Estado (UF)'], ['observacoes', 'Observações'],
    ],
  },
  { group: 'empresa', title: 'Minha empresa / meus dados', items: [['nome', 'Nome'], ['documento', 'CPF/CNPJ'], ['email', 'E-mail'], ['telefone', 'Telefone']] },
  { group: 'data', title: 'Data de hoje', items: [['hoje', 'Por extenso (16 de outubro de 2026)'], ['hoje_curta', 'Curta (16/10/2026)'], ['dia', 'Dia'], ['mes', 'Mês por extenso'], ['ano', 'Ano']] },
];

export const variableToken = (group, name) => `{{${group}.${name}}}`;
const LABELS = Object.fromEntries(VARIABLE_GROUPS.flatMap((g) => g.items.map(([n, l]) => [`${g.group}.${n}`, `${g.group === 'cliente' ? 'Cliente' : g.group === 'empresa' ? 'Empresa' : 'Data'}: ${l.replace(/ \(.*\)$/, '')}`])));
export const variableLabel = (key) => LABELS[key.toLowerCase()] || key;

const cepMask = (z) => (z && z.length === 8 ? `${z.slice(0, 5)}-${z.slice(5)}` : z || '');
const phoneOf = (p) => (p ? formatStoredPhone(p.startsWith('55') && p.length > 11 ? p.slice(2) : p) : '');

export function addressOf(c) {
  const line = [c.street, c.number, c.complement, c.district].filter(Boolean).join(', ');
  const city = [c.city, c.state].filter(Boolean).join('/');
  return [line, city, c.zip ? `CEP ${cepMask(c.zip)}` : ''].filter(Boolean).join(' - ');
}

// Dados que alimentam as variáveis: o cliente escolhido, o usuário logado (empresa) e a data de hoje.
export function buildContext({ contact, user, today = isoToday() }) {
  const [y, m, d] = today.split('-').map(Number);
  const mes = formatDateISO(today, 'long').split(' de ')[1] || '';
  return {
    cliente: {
      nome: contact.name || '', documento: contact.document ? formatDoc(contact.document) : '', email: contact.email || '', telefone: phoneOf(contact.phone),
      endereco: addressOf(contact), cep: cepMask(contact.zip), rua: contact.street || '', numero: contact.number || '', complemento: contact.complement || '',
      bairro: contact.district || '', cidade: contact.city || '', estado: contact.state || '', observacoes: contact.notes || '',
    },
    empresa: { nome: user.name || '', documento: user.document ? formatDoc(user.document) : '', email: user.email || '', telefone: phoneOf(user.phone) },
    data: { hoje: formatDateISO(today, 'long'), hoje_curta: formatDateISO(today, 'numeric'), dia: String(d), mes, ano: String(y) },
  };
}

// Variáveis usadas no contrato (texto das caixas e o texto antes da data).
export function usedVariables(doc) {
  const keys = new Set();
  for (const page of doc.pages) {
    for (const el of page.els) {
      for (const field of [el.text, el.prefix]) {
        if (typeof field !== 'string' || !field.includes('{{')) continue;
        for (const m of field.matchAll(VAR_RE)) keys.add(m[1].toLowerCase());
      }
    }
  }
  return keys;
}

// Variáveis usadas que existem, mas o cliente não tem esse dado cadastrado.
export function missingVariables(doc, ctx) {
  return [...usedVariables(doc)].filter((k) => lookup(ctx, k) === '').map((k) => ({ key: k, label: variableLabel(k) }));
}

// Modelos prontos para começar (montados pelo mesmo motor de layout da importação)
// e blocos prontos para inserir numa página (cabeçalho, assinaturas, rodapé).
import { MARGIN, blankDoc, newElement, pageSize } from './model.js';
import { layoutBlocks } from './layout.js';

export const TEMPLATES = [
  { key: 'blank', label: 'Em branco', desc: 'Uma página vazia para você montar do seu jeito.' },
  { key: 'servicos', label: 'Prestação de serviços', desc: 'Contrato clássico com partes, cláusulas, data e assinaturas.' },
  { key: 'moderno', label: 'Prestação de serviços (moderno)', desc: 'Mesmo conteúdo, com faixa colorida no topo.' },
];

const INK = '#0f2238';

function clauses({ headColor, headFont }) {
  const head = (text) => ({ kind: 'text', t: 'subtitle', text, gapAfter: 4, keepTogether: true, style: { fontFamily: headFont, fontSize: 14, bold: true, align: 'left', color: headColor, lineHeight: 1.3 } });
  const body = (text, gapAfter = 14) => ({ kind: 'text', t: 'text', text, gapAfter, style: { fontSize: 13, align: 'justify', lineHeight: 1.6 } });
  return [
    head('CLÁUSULA 1ª – DO OBJETO'),
    body('O presente contrato tem por objeto a prestação dos seguintes serviços: [descrição detalhada dos serviços].'),
    head('CLÁUSULA 2ª – DO VALOR E DO PAGAMENTO'),
    body('Pela prestação dos serviços, o CONTRATANTE pagará ao CONTRATADO o valor de R$ [valor], da seguinte forma: [forma de pagamento e datas de vencimento].'),
    head('CLÁUSULA 3ª – DO PRAZO'),
    body('Este contrato vigora pelo prazo de [prazo], com início em [data de início].'),
    head('CLÁUSULA 4ª – DAS OBRIGAÇÕES'),
    body('O CONTRATADO compromete-se a executar os serviços com qualidade e dentro do prazo combinado. O CONTRATANTE compromete-se a fornecer as informações necessárias e a efetuar os pagamentos nas datas acordadas.'),
    head('CLÁUSULA 5ª – DA RESCISÃO'),
    body('O contrato poderá ser rescindido por qualquer das partes, mediante aviso prévio por escrito de [número] dias, sem prejuízo dos valores já devidos pelos serviços prestados.'),
    head('CLÁUSULA 6ª – DO FORO'),
    body('Fica eleito o foro da comarca de [cidade/UF] para resolver quaisquer questões decorrentes deste contrato.', 18),
    body('E, por estarem de acordo, as partes assinam o presente contrato em duas vias de igual teor.', 10),
    { kind: 'text', t: 'date', text: '', gapAfter: 4, style: { fontSize: 13, align: 'left', prefix: '[Cidade], ', dateMode: 'today', dateFormat: 'long' } },
    { kind: 'sign', labels: ['CONTRATANTE', 'CONTRATADO(A)'] },
  ];
}

const parties = (color) => [
  { kind: 'text', t: 'text', text: 'CONTRATANTE: [nome completo ou razão social], inscrito(a) no CPF/CNPJ sob o nº [número], com endereço em [endereço completo].', gapAfter: 8, style: { fontSize: 13, align: 'justify', lineHeight: 1.6 } },
  { kind: 'text', t: 'text', text: 'CONTRATADO(A): [nome completo ou razão social], inscrito(a) no CPF/CNPJ sob o nº [número], com endereço em [endereço completo].', gapAfter: 18, style: { fontSize: 13, align: 'justify', lineHeight: 1.6 } },
  { kind: 'text', t: 'capsule', text: 'CLÁUSULAS', w: 160, gapAfter: 14, style: { fill: color, color: color === INK ? '#ffffff' : INK, fontSize: 12 } },
];

export async function buildTemplate(key) {
  if (key === 'servicos') {
    return layoutBlocks([
      { kind: 'text', t: 'title', text: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS', gapAfter: 6, style: { fontSize: 24, align: 'center', color: INK } },
      { kind: 'text', t: 'subtitle', text: `Contrato nº 001/${new Date().getFullYear()}`, gapAfter: 22, style: { fontSize: 14, align: 'center' } },
      { kind: 'text', t: 'capsule', text: 'PARTES', w: 160, center: true, gapAfter: 14, style: { fontSize: 12 } },
      ...parties('#f2a33a'),
      ...clauses({ headColor: INK, headFont: 'inter' }),
    ]);
  }
  if (key === 'moderno') {
    const { w: PW } = pageSize('portrait');
    const CW = PW - MARGIN * 2;
    const extras = [
      newElement('shape', { x: 0, y: 0, w: PW, h: 150, fill: INK, radius: 0 }),
      newElement('text', { x: MARGIN, y: 44, w: CW, text: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS', fontFamily: 'montserrat', fontSize: 26, bold: true, color: '#ffffff', align: 'left', lineHeight: 1.2 }),
      newElement('capsule', { x: MARGIN, y: 104, w: 190, text: `Nº 001/${new Date().getFullYear()}`, fontSize: 12 }),
    ];
    return layoutBlocks([
      ...parties('#f2a33a'),
      ...clauses({ headColor: '#1f55a6', headFont: 'montserrat' }),
    ], { firstPageTop: 190, extras });
  }
  return blankDoc();
}

// ---------- Blocos prontos (inseridos na página aberta no editor) ----------
export function headerBlock(orientation) {
  const { w: PW } = pageSize(orientation);
  return [
    newElement('shape', { x: 0, y: 0, w: PW, h: 110, fill: INK, radius: 0 }),
    newElement('text', { x: MARGIN, y: 34, w: PW - MARGIN * 2, text: 'NOME DA SUA EMPRESA', fontFamily: 'montserrat', fontSize: 24, bold: true, color: '#ffffff', align: 'left', lineHeight: 1.2 }),
    newElement('text', { x: MARGIN, y: 70, w: PW - MARGIN * 2, text: 'CNPJ 00.000.000/0001-00  ·  (00) 00000-0000', fontSize: 12, color: '#c5d2e2', align: 'left', lineHeight: 1.3 }),
  ];
}

export function signaturesBlock(orientation, y) {
  const { w: PW } = pageSize(orientation);
  const colW = Math.round((PW - MARGIN * 2) * 0.4);
  const xs = [MARGIN, PW - MARGIN - colW];
  return ['CONTRATANTE', 'CONTRATADO(A)'].flatMap((label, i) => [
    newElement('line', { x: xs[i], y, w: colW, h: 1, color: '#14202e' }),
    newElement('text', { x: xs[i], y: y + 8, w: colW, text: label, fontSize: 13, align: 'center', lineHeight: 1.3 }),
  ]);
}

export function footerBlock(orientation) {
  const { w: PW, h: PH } = pageSize(orientation);
  return [
    newElement('line', { x: MARGIN, y: PH - 72, w: PW - MARGIN * 2, h: 1, color: '#dce2ea' }),
    newElement('text', { x: MARGIN, y: PH - 60, w: PW - MARGIN * 2, text: 'Nome da empresa  ·  endereço  ·  telefone  ·  e-mail', fontSize: 11, color: '#566779', align: 'center', lineHeight: 1.3 }),
  ];
}

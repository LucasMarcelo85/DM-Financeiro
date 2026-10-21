// Pontos de partida do portfólio. São exemplos: o usuário troca textos, cores, imagens e links no editor.
import { blankDoc, newBlock, THEME_PRESETS } from './model.js';

const preset = (key) => { const { primary, bg, text } = THEME_PRESETS.find((p) => p.key === key); return { primary, bg, text }; };
const wa = () => ({ kind: 'whatsapp', url: '', phone: '', message: 'Olá! Vi sua página e gostaria de saber mais.', email: '' });

export const TEMPLATES = [
  { key: 'blank', label: 'Em branco', desc: 'Comece do zero e adicione os blocos que quiser.' },
  { key: 'links', label: 'Cartão de links', desc: 'Logo, apresentação curta e botões: WhatsApp, Instagram e site.' },
  { key: 'services', label: 'Serviços e portfólio', desc: 'Banner, sobre você, serviços, galeria de trabalhos e contato.' },
  { key: 'company', label: 'Apresentação da empresa', desc: 'Quem somos, diferenciais, vídeo institucional e contato.' },
];

// `name`: nome da pessoa ou empresa (vem do cadastro) para já aparecer na página.
export function buildTemplate(key, name = 'Sua empresa') {
  const doc = blankDoc();
  if (key === 'links') {
    doc.theme = { ...doc.theme, ...preset('grafite'), width: 'narrow', radius: 'pill' };
    doc.blocks = [
      newBlock('spacer', { height: 24 }),
      newBlock('logo', { size: 96 }),
      newBlock('heading', { text: name, size: 'lg', align: 'center' }),
      newBlock('text', { text: 'Uma frase curta sobre o que você faz e como as pessoas podem falar com você.', align: 'center' }),
      newBlock('button', { label: 'Chamar no WhatsApp', link: wa(), full: true, size: 'lg' }),
      newBlock('button', { label: 'Instagram', link: { kind: 'link', url: '', phone: '', message: '', email: '' }, style: 'outline', full: true, size: 'lg' }),
      newBlock('button', { label: 'Nosso site', link: { kind: 'link', url: '', phone: '', message: '', email: '' }, style: 'soft', full: true, size: 'lg' }),
    ];
  } else if (key === 'services') {
    doc.theme = { ...doc.theme, ...preset('oceano') };
    doc.seo = { title: name, description: `Conheça o trabalho de ${name}.` };
    doc.blocks = [
      newBlock('banner', { title: name, subtitle: 'Soluções sob medida para o seu negócio.', height: 'lg', bgColor: '#1f55a6', buttonLabel: 'Peça um orçamento', link: wa() }),
      newBlock('heading', { text: 'Sobre nós', align: 'center' }),
      newBlock('text', { text: 'Conte aqui a sua história, há quanto tempo atua e o que torna o seu trabalho diferente.', align: 'center' }),
      newBlock('heading', { text: 'O que fazemos', align: 'center' }),
      newBlock('text', { text: '• Serviço 1: descreva em uma linha\n• Serviço 2: descreva em uma linha\n• Serviço 3: descreva em uma linha' }),
      newBlock('heading', { text: 'Trabalhos recentes', align: 'center' }),
      newBlock('gallery', { cols: 3 }),
      newBlock('divider'),
      newBlock('heading', { text: 'Vamos conversar?', align: 'center' }),
      newBlock('button', { label: 'Falar no WhatsApp', link: wa(), size: 'lg' }),
      newBlock('spacer', { height: 40 }),
    ];
  } else if (key === 'company') {
    doc.theme = { ...doc.theme, ...preset('floresta'), headingFont: 'montserrat' };
    doc.seo = { title: name, description: `Conheça ${name}.` };
    doc.blocks = [
      newBlock('logo', { size: 64, align: 'left' }),
      newBlock('banner', { title: `Somos a ${name}`, subtitle: 'Qualidade, compromisso e atendimento de verdade.', height: 'md', bgColor: '#137a52', align: 'left', showButton: false }),
      newBlock('heading', { text: 'Quem somos', size: 'lg' }),
      newBlock('text', { text: 'Apresente a empresa: missão, valores e o que você entrega aos clientes.' }),
      newBlock('heading', { text: 'Nossos diferenciais', size: 'lg' }),
      newBlock('text', { text: '• Atendimento próximo\n• Prazo e transparência\n• Equipe especializada' }),
      newBlock('video', { width: 'lg', caption: 'Cole o link de um vídeo do YouTube ou Vimeo no painel ao lado.' }),
      newBlock('divider'),
      newBlock('heading', { text: 'Fale com a gente', size: 'lg', align: 'center' }),
      newBlock('button', { label: 'Chamar no WhatsApp', link: wa(), size: 'lg' }),
      newBlock('button', { label: 'Enviar e-mail', link: { kind: 'email', url: '', phone: '', message: '', email: '' }, style: 'outline', size: 'lg' }),
      newBlock('spacer', { height: 40 }),
    ];
  }
  return doc;
}

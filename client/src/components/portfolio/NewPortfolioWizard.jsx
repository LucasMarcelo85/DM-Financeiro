import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon.jsx';
import { api } from '../../api.js';
import CatalogSettings from '../CatalogSettings.jsx';
import { useToast } from '../Toast.jsx';
import { formatStoredPhone, maskPhone } from '../../lib/format.js';
import { THEME_PRESETS } from '../../lib/portfolio/model.js';

const TYPES = [
  { id: 'links', template: 'links', title: 'Cartão de links', description: 'Uma página curta para reunir seus contatos e redes sociais.', icon: 'link', preset: 'grafite' },
  { id: 'services', template: 'services', title: 'Portfólio de serviços', description: 'Apresente sua empresa, seu trabalho e formas de contato.', icon: 'globe', preset: 'oceano' },
  { id: 'catalog', template: 'catalog', title: 'Página de catálogo', description: 'Mostre produtos com busca, categorias e pedidos pelo WhatsApp.', icon: 'box', preset: 'floresta', catalog: true },
  { id: 'ecommerce', template: 'catalog-editorial', title: 'Página de e-commerce', description: 'Uma vitrine de loja com carrinho, entrega e finalização do pedido.', icon: 'cart', preset: 'rosa', catalog: true },
];

const STEPS = ['Modelo', 'Identidade', 'Produtos'];

function MiniPreview({ type, theme }) {
  const isShop = type.catalog;
  return (
    <div className={`nw-preview nw-preview-type-${type.id}`} style={{ '--nw-primary': theme.primary, '--nw-bg': theme.bg, '--nw-text': theme.text }}>
      <div className={`nw-preview-banner nw-preview-${type.id}`}>
        <span className="nw-preview-mark" />
        <span className="nw-preview-title" />
        <span className="nw-preview-line" />
        {!isShop && <span className="nw-preview-button" />}
      </div>
      <div className="nw-preview-content">
        {isShop
          ? <div className="nw-preview-products">{[1, 2, 3].map((item) => <i key={item}><b /><span /><em /></i>)}</div>
          : <div className="nw-preview-links"><i /><i /><i /></div>}
      </div>
      <span className="nw-preview-label">{isShop ? 'Produtos' : type.id === 'links' ? 'Seus links em um só lugar' : 'Apresentação e serviços'}</span>
    </div>
  );
}

function OptionCard({ checked, title, description, children, onClick, className = '' }) {
  return (
    <button type="button" className={`nw-choice ${checked ? 'is-selected' : ''} ${className}`} aria-pressed={checked} onClick={onClick}>
      <span className="nw-choice-check"><Icon name={checked ? 'check' : 'right'} size={18} /></span>
      <span className="nw-choice-content">
        <strong>{title}</strong>
        <span className="muted small">{description}</span>
        {children}
      </span>
    </button>
  );
}

function ColorInput({ label, value, onChange }) {
  return (
    <label className="nw-color">
      <span>{label}</span>
      <span className="nw-color-control"><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><code>{value.toUpperCase()}</code></span>
    </label>
  );
}

export default function NewPortfolioWizard({ catalogOk, busy, onClose, onCreate }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [typeId, setTypeId] = useState('services');
  const [name, setName] = useState('');
  const [theme, setTheme] = useState(() => {
    const preset = THEME_PRESETS.find((item) => item.key === 'oceano');
    return { primary: preset.primary, bg: preset.bg, text: preset.text };
  });
  const [themePreset, setThemePreset] = useState('oceano');
  const [orderMode, setOrderMode] = useState('cart');
  const [display, setDisplay] = useState('category');
  const [cardLayout, setCardLayout] = useState('vertical');
  const [cardStyle, setCardStyle] = useState('soft');
  const [cartLayout, setCartLayout] = useState('standard');
  const [cardColors, setCardColors] = useState({ bg: '#ffffff', text: '#14202e', accent: '#137a52' });
  const [cardInfo, setCardInfo] = useState({ showImage: true, showCategory: true, showName: true, showDescription: false, showPrice: true, showButton: true });
  const [siteWhatsapp, setSiteWhatsapp] = useState('');
  const [catalogWhatsapp, setCatalogWhatsapp] = useState('');
  const [catalogSettingsOpen, setCatalogSettingsOpen] = useState(false);
  const [catalogSettingsLoading, setCatalogSettingsLoading] = useState(false);
  const [catalogSettingsError, setCatalogSettingsError] = useState('');

  const type = TYPES.find((item) => item.id === typeId) || TYPES[1];
  useEffect(() => {
    if (!catalogOk) return undefined;
    let active = true;
    setCatalogSettingsLoading(true);
    api.get('/catalog/settings')
      .then(({ config }) => { if (active) setCatalogWhatsapp(formatStoredPhone(config.whatsapp || '')); })
      .catch((error) => { if (active) { setCatalogSettingsError(error.message); toast(error.message, 'error'); } })
      .finally(() => { if (active) setCatalogSettingsLoading(false); });
    return () => { active = false; };
  }, [catalogOk, toast]);
  const updateTheme = (key, value) => {
    setTheme((current) => ({ ...current, [key]: value }));
    setThemePreset('');
  };
  const choosePreset = (preset) => {
    setThemePreset(preset.key);
    setTheme({ primary: preset.primary, bg: preset.bg, text: preset.text });
    setCardColors((current) => ({ ...current, accent: preset.primary }));
  };
  const toggleInfo = (key) => setCardInfo((current) => ({ ...current, [key]: !current[key] }));

  function submit() {
    onCreate({
      template: type.template,
      name: name.trim() || type.title,
      theme,
      whatsapp: siteWhatsapp.replace(/\D/g, ''),
      catalogWhatsapp: catalogWhatsapp.replace(/\D/g, ''),
      catalog: type.catalog ? {
        orderMode,
        display,
        cardStyle,
        card: { layout: cardLayout, bg: cardColors.bg, text: cardColors.text, accent: cardColors.accent, ...cardInfo },
        cartLayout,
        addLabel: orderMode === 'direct' ? 'Pedir pelo WhatsApp' : 'Adicionar ao carrinho',
      } : null,
    });
  }

  return (
    <section className="nw-shell mx-auto w-full max-w-7xl">
      <header className="nw-header">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="left" size={17} /> Voltar</button>
        <div><span className="nw-eyebrow">CRIADOR DE PÁGINAS</span><h1>Vamos montar sua página</h1></div>
        <span className="nw-header-spacer" />
      </header>

      <nav className="nw-progress" aria-label="Etapas da criação">
        {STEPS.map((label, index) => (
          <button key={label} type="button" className={`nw-progress-step ${index === step ? 'is-current' : ''} ${index < step ? 'is-done' : ''}`} onClick={() => index < step && setStep(index)} aria-current={index === step ? 'step' : undefined}>
            <span>{index < step ? <Icon name="check" size={14} /> : index + 1}</span><strong>{label}</strong>
          </button>
        ))}
      </nav>

      <main className="nw-main">
        {step === 0 && (
          <section className="nw-step">
            <div className="nw-step-intro"><span className="nw-step-icon"><Icon name="star" size={22} /></span><div><h2>O que você quer criar?</h2><p>Escolha um modelo para começar. Você poderá personalizar os detalhes depois.</p></div></div>
            {!catalogOk && <p className="nw-plan-hint">O catálogo digital não está incluído no seu plano. <Link to="/plano">Ver planos com catálogo</Link>.</p>}
            <div className="nw-template-grid grid grid-cols-1 gap-4 md:grid-cols-2">
              {TYPES.map((item) => {
                const preset = THEME_PRESETS.find((option) => option.key === item.preset);
                const disabled = item.catalog && !catalogOk;
                return (
                  <button key={item.id} type="button" className={`nw-template ${typeId === item.id ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`} onClick={() => { if (!disabled) { setTypeId(item.id); choosePreset(preset); } }} disabled={disabled} aria-pressed={typeId === item.id}>
                    <MiniPreview type={item} theme={preset} />
                    <span className="nw-template-copy"><span><strong>{item.title}</strong>{typeId === item.id && <Icon name="check" size={18} />}</span><small>{item.description}</small>{disabled && <em>Disponível em planos com catálogo digital</em>}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="nw-step">
            <div className="nw-step-intro"><span className="nw-step-icon"><Icon name="edit" size={22} /></span><div><h2>Defina a identidade da página</h2><p>Escolha um nome e um tema. As cores podem ser ajustadas individualmente.</p></div></div>
            <div className="nw-identity-layout">
              <div className="nw-identity-form">
                <label className="field"><span>Nome da página</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder={type.title} autoFocus /><small>Esse nome ajuda você a identificar a página no painel.</small></label>
                <fieldset className="nw-presets"><legend>Escolha uma combinação de cores</legend><div className="nw-preset-grid">
                  {THEME_PRESETS.map((preset) => (
                    <button key={preset.key} type="button" className={`nw-preset ${themePreset === preset.key ? 'is-selected' : ''}`} onClick={() => choosePreset(preset)} aria-pressed={themePreset === preset.key}>
                      <span><i style={{ background: preset.primary }} /><i style={{ background: preset.bg, borderColor: preset.text }} /><i style={{ background: preset.text }} /></span><strong>{preset.label}</strong>
                    </button>
                  ))}
                </div></fieldset>
                <fieldset className="nw-custom-colors"><legend>Personalize as cores</legend><div className="nw-color-grid">
                  <ColorInput label="Destaque" value={theme.primary} onChange={(value) => updateTheme('primary', value)} />
                  <ColorInput label="Fundo" value={theme.bg} onChange={(value) => updateTheme('bg', value)} />
                  <ColorInput label="Textos" value={theme.text} onChange={(value) => updateTheme('text', value)} />
                </div></fieldset>
              </div>
              <div className="nw-live-preview"><span>PRÉVIA DO TEMA</span><MiniPreview type={type} theme={theme} /><strong>{name.trim() || type.title}</strong><small>As cores e o nome aparecem na página final.</small></div>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="nw-step">
            <div className="nw-step-intro"><span className="nw-step-icon"><Icon name={type.catalog ? 'box' : 'list'} size={22} /></span><div><h2>{type.catalog ? 'Como a vitrine vai funcionar?' : 'Tudo pronto para personalizar'}</h2><p>{type.catalog ? 'Veja as opções e escolha como seus clientes vão encontrar e pedir os produtos.' : 'Seu modelo já está preparado para celular, tablet e computador. Continue para abrir o editor.'}</p></div></div>
            {type.catalog ? (
              <div className="nw-commerce-layout">
                <div className="nw-commerce-options">
                  <fieldset className="nw-option-section"><legend>Como seus clientes vão fazer o pedido?</legend><div className="nw-choice-grid grid grid-cols-1 gap-3 md:grid-cols-2">
                    <OptionCard checked={orderMode === 'cart'} title="Carrinho e finalização" description="O cliente escolhe produtos, informa a entrega e envia o pedido." onClick={() => setOrderMode('cart')}><span className="nw-option-detail"><Icon name="cart" size={16} /> Ideal para pedidos organizados.</span></OptionCard>
                    <OptionCard checked={orderMode === 'direct'} title="Pedido direto pelo WhatsApp" description="O cliente escolhe a opção do produto e envia a mensagem para sua loja." onClick={() => setOrderMode('direct')}><span className="nw-option-detail"><Icon name="chat" size={16} /> Configure o número logo abaixo.</span></OptionCard>
                  </div></fieldset>
                  <fieldset className="nw-option-section"><legend>Como organizar os produtos?</legend><div className="nw-choice-grid">
                    <OptionCard checked={display === 'category'} title="Separados por categoria" description="Cada categoria ganha seu próprio título." onClick={() => setDisplay('category')} />
                    <OptionCard checked={display === 'mixed'} title="Todos misturados" description="Uma única vitrine, em ordem alfabética." onClick={() => setDisplay('mixed')} />
                  </div></fieldset>
                  <fieldset className="nw-option-section"><legend>Modelo dos cartões</legend><div className="nw-choice-grid nw-card-layout-choices">
                    <OptionCard checked={cardLayout === 'vertical'} title="Foto em cima" description="Cartão clássico para catálogos." onClick={() => setCardLayout('vertical')}><span className="nw-card-demo is-vertical"><i /><b /><em /></span></OptionCard>
                    <OptionCard checked={cardLayout === 'horizontal'} title="Foto ao lado" description="Mais compacto, com imagem lateral." onClick={() => setCardLayout('horizontal')}><span className="nw-card-demo is-horizontal"><i /><b /><em /></span></OptionCard>
                  </div></fieldset>
                  <fieldset className="nw-option-section"><legend>Informações para mostrar</legend><div className="nw-info-options">
                    {[['showImage', 'Foto do produto'], ['showCategory', 'Categoria'], ['showName', 'Nome'], ['showDescription', 'Descrição'], ['showPrice', 'Preço'], ['showButton', orderMode === 'direct' ? 'Botão para pedir' : 'Botão adicionar']].map(([key, label]) => (
                      <label key={key} className="nw-check"><input type="checkbox" checked={cardInfo[key]} onChange={() => toggleInfo(key)} /><span>{label}</span></label>
                    ))}
                  </div></fieldset>
                  <fieldset className="nw-option-section"><legend>Estilo e cores dos cartões</legend><div className="nw-card-style-row">
                    {[
                      ['soft', 'Suave'], ['flat', 'Limpo'], ['outline', 'Contorno'],
                    ].map(([style, label]) => <button key={style} type="button" className={`nw-style-option ${cardStyle === style ? 'is-selected' : ''}`} onClick={() => setCardStyle(style)} aria-pressed={cardStyle === style}>{label}</button>)}
                  </div><div className="nw-color-grid nw-card-colors">
                    <ColorInput label="Fundo do cartão" value={cardColors.bg} onChange={(value) => setCardColors((current) => ({ ...current, bg: value }))} />
                    <ColorInput label="Texto do cartão" value={cardColors.text} onChange={(value) => setCardColors((current) => ({ ...current, text: value }))} />
                    <ColorInput label="Destaque e botão" value={cardColors.accent} onChange={(value) => setCardColors((current) => ({ ...current, accent: value }))} />
                  </div></fieldset>
                  {orderMode === 'cart' && <fieldset className="nw-option-section"><legend>Visual do carrinho</legend><div className="nw-choice-grid">
                    <OptionCard checked={cartLayout === 'standard'} title="Profissional" description="Resumo claro com etapas de entrega e contato." onClick={() => setCartLayout('standard')} />
                    <OptionCard checked={cartLayout === 'compact'} title="Compacto" description="Mais direto e com menos elementos na tela." onClick={() => setCartLayout('compact')} />
                    <OptionCard checked={cartLayout === 'split'} title="Resumo em destaque" description="Dá mais espaço ao resumo do pedido." onClick={() => setCartLayout('split')} />
                  </div></fieldset>}
                </div>
                <aside className="nw-product-preview-panel"><span>PRÉVIA DO CARTÃO</span><article className={`nw-product-preview ${cardStyle === 'flat' ? 'is-flat' : cardStyle === 'outline' ? 'is-outline' : ''} ${cardLayout === 'horizontal' ? 'is-horizontal' : ''}`} style={{ '--nw-card-bg': cardColors.bg, '--nw-card-text': cardColors.text, '--nw-card-accent': cardColors.accent }}>
                  {cardInfo.showImage && <div className="nw-product-art"><Icon name="box" size={36} /></div>}<div className="nw-product-details">
                    {cardInfo.showCategory && <small>COLEÇÃO</small>}
                    {cardInfo.showName && <strong>Produto em destaque</strong>}
                    {cardInfo.showDescription && <p>Uma descrição breve e atraente para o seu produto.</p>}
                    {cardInfo.showPrice && <b>R$ 49,90</b>}
                    {cardInfo.showButton && <span>{orderMode === 'direct' ? 'Pedir pelo WhatsApp' : 'Adicionar ao carrinho'}</span>}
                  </div>
                </article><p>Prévia ilustrativa. Os produtos reais serão exibidos no seu catálogo.</p></aside>
              </div>
            ) : (
              <div className="nw-ready-card"><MiniPreview type={type} theme={theme} /><div><strong>{name.trim() || type.title}</strong><p>O editor já inclui os blocos principais deste modelo. Você poderá adicionar menus, imagens, vídeos, carrosséis e seções extras.</p></div></div>
            )}
            {type.catalog ? (
              <section className="nw-contact-settings">
                <span className="nw-contact-icon"><Icon name="chat" size={20} /></span>
                <div><strong>WhatsApp e entregas da loja</strong>
                  <p>{orderMode === 'cart' ? 'Configure o número que receberá o resumo do pedido e as formas de entrega.' : 'Configure o número que abrirá quando o cliente pedir um produto.'}</p>
                  {catalogSettingsError && <small className="form-error">{catalogSettingsError}</small>}
                  {catalogSettingsLoading ? <small className="muted">Verificando as configurações atuais...</small> : (
                    <small className={catalogWhatsapp.replace(/\D/g, '').length >= 10 ? 'nw-configured' : 'nw-needs-config'}>
                      {catalogWhatsapp.replace(/\D/g, '').length >= 10 ? `WhatsApp configurado: ${catalogWhatsapp}` : orderMode === 'cart' ? 'Defina o número de WhatsApp junto às formas de entrega e frete.' : 'Defina o número que receberá os pedidos no WhatsApp.'}
                    </small>
                  )}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCatalogSettingsOpen(true)} disabled={catalogSettingsLoading}>
                  {catalogWhatsapp.replace(/\D/g, '').length >= 10 ? 'Editar número e entregas' : 'Configurar número e entregas'}
                </button>
              </section>
            ) : (
              <label className="field nw-site-whatsapp"><span>WhatsApp para contato</span>
                <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={siteWhatsapp} onChange={(event) => setSiteWhatsapp(maskPhone(event.target.value))} placeholder="(85) 99999-9999" />
                <small>Este número será usado nos botões de WhatsApp do seu site. Inclua o DDD.</small>
                {siteWhatsapp.replace(/\D/g, '').length > 0 && siteWhatsapp.replace(/\D/g, '').length < 10 && <small className="form-error">Informe um telefone com DDD e 10 ou 11 dígitos.</small>}
              </label>
            )}
          </section>
        )}
      </main>

      <footer className="nw-footer">
        <button type="button" className="btn btn-ghost" onClick={() => step === 0 ? onClose() : setStep((current) => current - 1)} disabled={busy}><Icon name="left" size={16} /> {step === 0 ? 'Cancelar' : 'Voltar'}</button>
        <span>{step + 1} de {STEPS.length}</span>
        {step < STEPS.length - 1
          ? <button type="button" className="btn btn-primary" onClick={() => setStep((current) => current + 1)}>Continuar <Icon name="right" size={16} /></button>
          : <button type="button" className="btn btn-primary" onClick={submit}
            disabled={busy || (type.catalog ? catalogSettingsLoading || catalogWhatsapp.replace(/\D/g, '').length < 10 : siteWhatsapp.replace(/\D/g, '').length < 10)}>
            {busy ? 'Criando página...' : 'Criar e abrir o editor'} <Icon name="right" size={16} />
          </button>}
      </footer>
      {catalogSettingsOpen && <CatalogSettings onClose={() => setCatalogSettingsOpen(false)} onSaved={(result) => {
        setCatalogWhatsapp(formatStoredPhone(result.config.whatsapp || ''));
        setCatalogSettingsError('');
      }} />}
    </section>
  );
}

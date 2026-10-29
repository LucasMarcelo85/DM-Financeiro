import { useEffect, useState } from 'react';
import { api, getActiveStore, isShopMode } from '../api.js';
import Modal from './Modal.jsx';
import InfinitePayMark from './InfinitePayMark.jsx';
import { Check, Seg, TextField } from './portfolio/Fields.jsx';
import { useToast } from './Toast.jsx';
import { brl, centsToMasked, formatStoredPhone, maskMoney, maskPhone, moneyToCents } from '../lib/format.js';

// Entregas e frete do catálogo digital.
const cepMask = (v) => { const d = v.replace(/\D/g, '').slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
const num = (v) => (v === '' || v === null || v === undefined ? '' : String(v));

const toForm = (c) => ({
  storeName: c.storeName, whatsapp: c.whatsapp ? formatStoredPhone(c.whatsapp) : '',
  orderNotifications: { enabled: Boolean(c.orderNotifications?.enabled), instanceId: String(c.orderNotifications?.instanceId || ''), recipient: c.orderNotifications?.recipient === 'creator' ? 'creator' : 'store' },
  checkout: { minItems: String(c.checkout?.minItems || 1), minSubtotal: centsToMasked(c.checkout?.minSubtotalCents || 0) },
  pickup: { ...c.pickup },
  excursion: { ...c.excursion },
  motoboy: { ...c.motoboy, fixed: centsToMasked(c.motoboy.fixedCents), perKm: centsToMasked(c.motoboy.perKmCents), min: centsToMasked(c.motoboy.minCents), maxKm: num(c.motoboy.maxKm), originZip: cepMask(c.motoboy.originZip) },
  correios: { ...c.correios, originZip: cepMask(c.correios.originZip), heightCm: num(c.correios.heightCm), widthCm: num(c.correios.widthCm), lengthCm: num(c.correios.lengthCm), weightG: num(c.correios.weightG) },
});

const toConfig = (f) => ({
  storeName: f.storeName, whatsapp: f.whatsapp.replace(/\D/g, ''),
  orderNotifications: { enabled: f.orderNotifications.enabled, instanceId: f.orderNotifications.instanceId || null, recipient: f.orderNotifications.recipient },
  checkout: { minItems: Number(f.checkout.minItems) || 1, minSubtotalCents: moneyToCents(f.checkout.minSubtotal) },
  pickup: f.pickup,
  excursion: { enabled: f.excursion.enabled },
  motoboy: {
    enabled: f.motoboy.enabled, mode: f.motoboy.mode, fixedCents: moneyToCents(f.motoboy.fixed), perKmCents: moneyToCents(f.motoboy.perKm), minCents: moneyToCents(f.motoboy.min),
    maxKm: Number(f.motoboy.maxKm) || 0, originZip: f.motoboy.originZip, originStreet: f.motoboy.originStreet, originNumber: f.motoboy.originNumber,
    originDistrict: f.motoboy.originDistrict, originCity: f.motoboy.originCity, originState: f.motoboy.originState,
  },
  correios: {
    enabled: f.correios.enabled, originZip: f.correios.originZip, heightCm: f.correios.heightCm, widthCm: f.correios.widthCm, lengthCm: f.correios.lengthCm,
    weightG: f.correios.weightG, sandbox: f.correios.sandbox,
  },
});

export default function CatalogSettings({ onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [info, setInfo] = useState({ hasSuperfreteToken: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [zip, setZip] = useState('');
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [paymentProviders, setPaymentProviders] = useState([]);
  const [infiniteHandle, setInfiniteHandle] = useState('');
  const [paymentBusy, setPaymentBusy] = useState('');
  const [instances, setInstances] = useState([]);

  useEffect(() => {
    api.get('/catalog/settings').then((r) => { setF(toForm(r.config)); setInfo(r); }).catch((e) => setError(e.message));
    api.get('/catalog/payments').then((r) => {
      setPaymentProviders(r.providers || []);
      setInfiniteHandle(r.providers?.find((p) => p.provider === 'infinitepay')?.handle || '');
    }).catch((e) => setError(e.message));
    const activeStore = !isShopMode() ? getActiveStore() : null;
    const instanceQuery = new URLSearchParams({ includeOwner: '1' });
    if (activeStore) instanceQuery.set('store', activeStore);
    api.get(`/instances?${instanceQuery}`).then((r) => setInstances(r.instances || [])).catch((e) => setError(e.message));
  }, []);

  if (!f) return <Modal title="Entregas e frete" onClose={onClose}><p className="muted">{error || 'Carregando...'}</p></Modal>;

  const setTop = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setMo = (k) => (v) => setF((x) => ({ ...x, motoboy: { ...x.motoboy, [k]: v } }));
  const setCo = (k) => (v) => setF((x) => ({ ...x, correios: { ...x.correios, [k]: v } }));
  const digits = (n) => (v) => setCo(n)(v.replace(/[^\d.,]/g, ''));

  async function fillOrigin() {
    try {
      const { address } = await api.get(`/public/cep/${f.motoboy.originZip.replace(/\D/g, '')}`);
      setF((x) => ({ ...x, motoboy: { ...x.motoboy, originStreet: address.street, originDistrict: address.district, originCity: address.city, originState: address.state } }));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const r = await api.put('/catalog/settings', { config: toConfig(f) });
      setInfo(r); setF(toForm(r.config));
      toast('Configurações do catálogo salvas.');
      onSaved?.(r);
      onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function testShipping() {
    setTesting(true); setTest(null);
    try {
      setTest((await api.post('/catalog/settings/test-shipping', { zip })).options);
    } catch (e) { setTest({ error: e.message }); } finally { setTesting(false); }
  }

  async function saveInfiniteHandle() {
    setPaymentBusy('infinitepay');
    try {
      await api.put('/catalog/payments/infinitepay', { handle: infiniteHandle });
      setPaymentProviders((rows) => rows.map((row) => row.provider === 'infinitepay' ? { ...row, connected: true, handle: infiniteHandle.replace(/^\$/, '') } : row));
      toast('InfinitePay conectada.');
    } catch (e) { toast(e.message, 'error'); } finally { setPaymentBusy(''); }
  }

  async function disconnectInfinitePay() {
    setPaymentBusy('infinitepay');
    try {
      await api.del('/catalog/payments/infinitepay');
      setPaymentProviders((rows) => rows.map((row) => ({ ...row, connected: false, handle: '' })));
      setInfiniteHandle('');
      toast('Forma de pagamento desconectada.');
    } catch (e) { toast(e.message, 'error'); } finally { setPaymentBusy(''); }
  }

  const infinitePayConnection = paymentProviders.find((p) => p.provider === 'infinitepay');

  return (
    <Modal title="Entregas e frete do catálogo" onClose={onClose} wide
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button></>}>
      <div className="form cs-form">
        <TextField label="Nome da loja" value={f.storeName} onChange={setTop('storeName')} maxLength={80} id="cs-store" />
        <TextField label="WhatsApp da loja" value={f.whatsapp} onChange={(v) => setTop('whatsapp')(maskPhone(v))} placeholder="(85) 99999-9999" id="cs-wa" hint="Após finalizar o pedido, o cliente poderá enviar o resumo para este número. Inclua o DDD." />
        <fieldset className="cs-box">
          <Check
            label="Ativar notificações automáticas de pedidos"
            checked={f.orderNotifications.enabled}
            onChange={(enabled) => setF((current) => ({ ...current, orderNotifications: { ...current.orderNotifications, enabled } }))}
          />
          {f.orderNotifications.enabled && <>
            <label className="field">
              <span>Número que receberá as notificações</span>
              <select
                className="input"
                value={f.orderNotifications.recipient}
                onChange={(e) => setF((current) => ({ ...current, orderNotifications: { ...current.orderNotifications, recipient: e.target.value } }))}
              >
                <option value="store">WhatsApp da loja ({f.whatsapp || 'configure o número da loja acima'})</option>
                {(info.creatorWhatsapp || f.orderNotifications.recipient === 'creator') && <option value="creator" disabled={!info.creatorWhatsapp}>WhatsApp da agência/criador ({info.creatorWhatsapp ? formatStoredPhone(info.creatorWhatsapp) : 'não configurado'})</option>}
              </select>
            </label>
            {f.orderNotifications.recipient === 'creator' && !info.creatorWhatsapp && <p className="form-error">O WhatsApp do criador ainda não está configurado. Peça ao administrador para informá-lo nas configurações do aplicativo.</p>}
            <label className="field">
              <span>Instância que enviará as notificações</span>
              <select
                className="input"
                value={f.orderNotifications.instanceId}
                onChange={(e) => setF((current) => ({ ...current, orderNotifications: { ...current.orderNotifications, instanceId: e.target.value } }))}
              >
                <option value="">Selecione uma instância</option>
                {instances.filter((instance) => instance.connected || String(instance.id) === f.orderNotifications.instanceId).map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.label || instance.metaPhoneDisplay || instance.name}{instance.storeId ? ' · loja' : ' · conta do criador'}{instance.connected ? '' : ' · desconectada'}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              A notificação será enviada para o número escolhido acima usando a instância conectada à conta do criador ou a esta loja. Pedidos novos e pagamentos confirmados pela InfinitePay serão notificados; marcar um pedido como pago manualmente não envia aviso de pagamento.
            </p>
            {!instances.some((instance) => instance.connected) && <p className="muted small">Conecte um WhatsApp na conta do criador ou na loja para habilitar o envio.</p>}
          </>}
        </fieldset>
        <fieldset className="cs-box">
          <div className="cs-payment-row">
            <span><InfinitePayMark /><small>{infinitePayConnection?.connected ? `Recebimentos ativos para a InfiniteTag ${infinitePayConnection.handle}.` : 'Receba pagamentos online diretamente na conta InfinitePay da sua loja.'}</small></span>
            {infinitePayConnection?.connected && <button type="button" className="btn btn-ghost btn-sm" onClick={disconnectInfinitePay} disabled={Boolean(paymentBusy)}>{paymentBusy ? 'Desconectando...' : 'Desconectar'}</button>}
          </div>
          <div className="cs-payment-row">
            <TextField label="InfiniteTag / handle da sua loja" value={infiniteHandle} onChange={setInfiniteHandle} placeholder="minhaloja" id="cs-infinitepay" hint="Este identificador direciona os pagamentos para sua conta InfinitePay; não informe senha ou token." />
            <button type="button" className="btn btn-ghost btn-sm" onClick={saveInfiniteHandle} disabled={Boolean(paymentBusy) || !infiniteHandle.trim()}>{paymentBusy === 'infinitepay' ? 'Salvando...' : 'Salvar handle'}</button>
          </div>
          <p className="muted small">Use a InfiniteTag da sua própria loja. Não informe senha nem dados bancários. Os pagamentos são confirmados pela InfinitePay.</p>
        </fieldset>
        <fieldset className="cs-box">
          <strong>Regras mínimas para finalizar um pedido</strong>
          <div className="grid-2">
            <TextField label="Quantidade mínima de itens" value={f.checkout.minItems} onChange={(v) => setF((x) => ({ ...x, checkout: { ...x.checkout, minItems: v.replace(/\D/g, '').slice(0, 3) } }))} id="cs-min-items" />
            <TextField label="Subtotal mínimo (R$)" value={f.checkout.minSubtotal} onChange={(v) => setF((x) => ({ ...x, checkout: { ...x.checkout, minSubtotal: maskMoney(v) } }))} id="cs-min-subtotal" hint="Use 0 para não exigir valor mínimo." />
          </div>
        </fieldset>
        <p className="muted small">Marque as formas de entrega que você oferece. O cliente sempre informa <strong>nome</strong> e <strong>telefone</strong>.</p>

        <fieldset className="cs-box">
          <Check label="Retirada no local" checked={f.pickup.enabled} onChange={(v) => setF((x) => ({ ...x, pickup: { ...x.pickup, enabled: v } }))} />
          {f.pickup.enabled && <>
            <TextField label="Nome do local (opcional)" value={f.pickup.name} onChange={(v) => setF((x) => ({ ...x, pickup: { ...x.pickup, name: v } }))} maxLength={80} id="cs-pickup-name" placeholder={f.storeName || 'Loja'} />
            <TextField label="Endereço ou instruções para retirada *" value={f.pickup.address} onChange={(v) => setF((x) => ({ ...x, pickup: { ...x.pickup, address: v } }))} maxLength={240} id="cs-pickup-address" multiline rows={2} />
          </>}
        </fieldset>

        <fieldset className="cs-box">
          <Check label="Excursão" checked={f.excursion.enabled} onChange={(v) => setF((x) => ({ ...x, excursion: { enabled: v } }))} />
          <p className="muted small">O cliente informa o <strong>nome do galpão</strong>, a <strong>cidade</strong> e o <strong>endereço do galpão</strong>. O frete fica a combinar com você.</p>
        </fieldset>

        <fieldset className="cs-box">
          <Check label="Motoboy" checked={f.motoboy.enabled} onChange={setMo('enabled')} />
          {f.motoboy.enabled && (
            <>
              <p className="muted small">O cliente informa o <strong>CEP</strong> ou o <strong>endereço</strong> de entrega (o endereço é preenchido sozinho pelo CEP).</p>
              <Seg label="Como cobrar" value={f.motoboy.mode} options={[['fixed', 'Valor fixo'], ['km', 'Por km']]} onChange={setMo('mode')} id="cs-mode" />
              {f.motoboy.mode === 'fixed' ? (
                <TextField label="Valor da entrega (R$)" value={f.motoboy.fixed} onChange={(v) => setMo('fixed')(maskMoney(v))} id="cs-fixed" />
              ) : (
                <>
                  <div className="grid-2">
                    <TextField label="Valor por km (R$)" value={f.motoboy.perKm} onChange={(v) => setMo('perKm')(maskMoney(v))} id="cs-perkm" />
                    <TextField label="Valor mínimo (R$)" value={f.motoboy.min} onChange={(v) => setMo('min')(maskMoney(v))} id="cs-min" />
                  </div>
                  <TextField label="Distância máxima em km (0 = sem limite)" value={f.motoboy.maxKm} onChange={(v) => setMo('maxKm')(v.replace(/\D/g, '').slice(0, 4))} id="cs-maxkm" />
                  <p className="muted small"><strong>De onde o motoboy sai</strong> (CEP ou endereço, necessário para calcular os km):</p>
                  <div className="cs-zip">
                    <TextField label="CEP de saída" value={f.motoboy.originZip} onChange={(v) => setMo('originZip')(cepMask(v))} placeholder="00000-000" id="cs-ozip" />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={fillOrigin} disabled={f.motoboy.originZip.replace(/\D/g, '').length !== 8}>Buscar endereço</button>
                  </div>
                  <div className="grid-2">
                    <TextField label="Rua" value={f.motoboy.originStreet} onChange={setMo('originStreet')} maxLength={120} id="cs-ostreet" />
                    <TextField label="Número" value={f.motoboy.originNumber} onChange={setMo('originNumber')} maxLength={20} id="cs-onum" />
                    <TextField label="Bairro" value={f.motoboy.originDistrict} onChange={setMo('originDistrict')} maxLength={80} id="cs-odist" />
                    <TextField label="Cidade" value={f.motoboy.originCity} onChange={setMo('originCity')} maxLength={80} id="cs-ocity" />
                    <TextField label="Estado (sigla)" value={f.motoboy.originState} onChange={(v) => setMo('originState')(v.toUpperCase().slice(0, 2))} id="cs-ostate" />
                  </div>
                  <p className="muted small">Os km são calculados pela rota de carro (mapa OpenStreetMap). Se a rota não responder, usamos a distância em linha reta com um acréscimo.</p>
                </>
              )}
            </>
          )}
        </fieldset>

        <fieldset className="cs-box">
          <Check label="Correios (PAC, SEDEX e outros)" checked={f.correios.enabled} onChange={setCo('enabled')} />
          <p className="muted small">A simulação do frete é feita pelo <strong>SuperFrete</strong>. O cliente informa o CEP de destino e escolhe entre as opções que o SuperFrete devolver.</p>
          {f.correios.enabled && (
            <>
              <TextField label="CEP de origem (de onde o pacote sai) *" value={f.correios.originZip} onChange={(v) => setCo('originZip')(cepMask(v))} placeholder="00000-000" id="cs-czip" />
              <p className="muted small"><strong>Medidas e peso do pacote</strong> (obrigatórios para simular):</p>
              <div className="grid-2">
                <TextField label="Altura (cm) *" value={f.correios.heightCm} onChange={digits('heightCm')} id="cs-h" />
                <TextField label="Largura (cm) *" value={f.correios.widthCm} onChange={digits('widthCm')} id="cs-w" />
                <TextField label="Comprimento (cm) *" value={f.correios.lengthCm} onChange={digits('lengthCm')} id="cs-l" />
                <TextField label="Peso (gramas) *" value={f.correios.weightG} onChange={(v) => setCo('weightG')(v.replace(/\D/g, '').slice(0, 5))} id="cs-g" />
              </div>
              <p className="muted small">{info.hasSuperfreteToken ? 'O SuperFrete já está configurado pela administração do sistema.' : 'O SuperFrete ainda não está configurado no servidor. Avise o administrador para preencher SUPERFRETE_TOKEN.'}</p>
              {/* <Check label="Usar o ambiente de testes do SuperFrete (sandbox)" checked={f.correios.sandbox} onChange={setCo('sandbox')} /> */}
              {info.hasSuperfreteToken && (
                <div className="cs-test">
                  <TextField label="Testar com um CEP de destino" value={zip} onChange={(v) => setZip(cepMask(v))} placeholder="00000-000" id="cs-tzip" />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={testShipping} disabled={testing || zip.replace(/\D/g, '').length !== 8}>{testing ? 'Simulando...' : 'Simular frete'}</button>
                  {Array.isArray(test) && <ul className="cs-test-list">{test.map((o) => <li key={o.id}><strong>{o.name}</strong> {brl(o.priceCents)}{o.days ? ` · ${o.days.max} dias` : ''}</li>)}</ul>}
                  {test?.error && <p className="form-error">{test.error}</p>}
                  <p className="muted small">Frete simulado pelo SuperFrete.</p>
                </div>
              )}
            </>
          )}
        </fieldset>
        {!f.excursion.enabled && !f.motoboy.enabled && !f.correios.enabled && <p className="banner banner-amber">Marque pelo menos uma forma de entrega para os clientes conseguirem finalizar o pedido.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

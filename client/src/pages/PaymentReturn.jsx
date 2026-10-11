import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Lamp from '../components/Lamp.jsx';
import { useToast } from '../components/Toast.jsx';

// Página para onde a InfinitePay devolve o cliente depois do pagamento.
export default function PaymentReturn() {
  const [params] = useSearchParams();
  const { setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', message: '' });
  const started = useRef(false);

  const confirm = useCallback(async () => {
    const order = params.get('order_nsu');
    if (!order) return setState({ status: 'error', message: 'Não encontramos os dados do pagamento neste endereço.' });
    setState({ status: 'loading', message: '' });
    try {
      const { user } = await api.post('/billing/confirm', {
        order_nsu: order,
        transaction_nsu: params.get('transaction_nsu'),
        slug: params.get('slug'),
        receipt_url: params.get('receipt_url'),
      });
      setUser(user);
      setState({ status: 'ok', message: '' });
      toast('Pagamento confirmado. Acesso liberado!');
      setTimeout(() => navigate('/', { replace: true }), 1800);
    } catch (e) {
      setState({ status: 'error', message: e.message });
    }
  }, [params, setUser, toast, navigate]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    confirm();
  }, [confirm]);

  return (
    <section className="empty-hero">
      <Lamp on={state.status === 'ok'} pending={state.status === 'loading'} size="xl" />
      {state.status === 'loading' && (<><h2>Confirmando seu pagamento...</h2><p>Só um instante, estamos falando com a InfinitePay.</p></>)}
      {state.status === 'ok' && (<><h2>Pagamento confirmado</h2><p>Seu acesso foi liberado. Levando você para o início.</p></>)}
      {state.status === 'error' && (
        <>
          <h2>Ainda não conseguimos confirmar</h2>
          <p>{state.message}</p>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={confirm}>Verificar de novo</button>
            <Link to="/plano" className="btn btn-ghost">Voltar ao plano</Link>
          </div>
        </>
      )}
    </section>
  );
}

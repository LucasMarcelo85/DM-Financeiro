import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

// Atalho para comprar limite extra de um recurso (a configuração de valor e quantidade é do admin em "Gerir planos").
export default function BuyMore({ resource, label = 'Adquirir mais', className = 'btn btn-primary btn-sm' }) {
  const { user } = useAuth() || {};
  if (user?.role === 'admin') return null;
  return <Link className={className} to={`/plano?extra=${resource}#extras`}>{label}</Link>;
}

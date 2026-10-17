import { useAuth } from '../auth.jsx';
import InstanceManager from '../components/InstanceManager.jsx';
import { plural } from '../lib/format.js';

export default function WhatsApp() {
  const { user } = useAuth();
  return (
    <>
      <header className="page-head">
        <h1>WhatsApp</h1>
        <p className="muted">
          WhatsApps que enviam suas cobranças e lembretes. Seu plano permite {plural(user.limits.instances, 'conexão', 'conexões')}: por QR Code ou pela API oficial da Meta.
        </p>
      </header>
      <InstanceManager purpose="envio" />
    </>
  );
}

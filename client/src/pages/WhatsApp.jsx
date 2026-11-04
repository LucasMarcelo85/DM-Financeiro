import { useAuth } from '../auth.jsx';
import HelpNote from '../components/HelpNote.jsx';
import InstanceManager from '../components/InstanceManager.jsx';
import { plural } from '../lib/format.js';

export default function WhatsApp() {
  const { user } = useAuth();
  return (
    <>
      <header className="page-head">
        <h1>WhatsApp</h1>
        <HelpNote topic="whatsapp">Seu plano permite {plural(user.limits.instances, 'conexão', 'conexões')}.</HelpNote>
      </header>
      <InstanceManager purpose="envio" />
    </>
  );
}

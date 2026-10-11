// Luz de status: verde = conectado, vermelha = desconectado, âmbar = verificando.
export default function Lamp({ on, size = 'md', pending = false, label }) {
  const state = pending ? 'is-pending' : on ? 'is-on' : 'is-off';
  const text = label || (pending ? 'Verificando' : on ? 'Conectado' : 'Desconectado');
  return <span className={`lamp lamp-${size} ${state}`} role="img" aria-label={text} />;
}

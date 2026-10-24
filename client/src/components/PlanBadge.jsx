import { planLabel } from '../lib/format.js';

// Etiqueta do plano. O nome e a cor vêm do plano cadastrado pelo administrador (`name` e `color`).
export default function PlanBadge({ plan, name, color }) {
  return <span className={`badge ${color ? '' : `plan-${plan}`}`} style={color ? { background: color } : undefined}>{name || planLabel(plan)}</span>;
}

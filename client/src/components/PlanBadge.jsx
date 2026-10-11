import { planLabel } from '../lib/format.js';

export default function PlanBadge({ plan }) {
  return <span className={`badge plan-${plan}`}>{planLabel(plan)}</span>;
}

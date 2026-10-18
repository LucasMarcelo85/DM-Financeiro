import { VARIABLE_GROUPS, variableToken } from '../../lib/contract/variables.js';

// Lista de variáveis: um clique insere no texto selecionado (ou numa nova caixa de texto).
export default function VariablePicker({ onPick, groups = VARIABLE_GROUPS }) {
  return (
    <div className="vp">
      {groups.map((g) => (
        <div key={g.group} className="vp-group">
          <h4>{g.title}</h4>
          <div className="vp-chips">
            {g.items.map(([name, label]) => (
              <button key={name} type="button" className="vp-chip" onClick={() => onPick(`${g.group}.${name}`)} title={variableToken(g.group, name)}>{label}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

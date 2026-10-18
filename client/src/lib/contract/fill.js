// Variáveis nos textos do contrato: {{cliente.nome}}, {{empresa.documento}}, {{data.hoje}}...
// Sem dependências (usado pelo model.js, pela tela e pela impressão).
export const VAR_RE = /\{\{\s*([a-z]+\.[a-z_]+)\s*\}\}/gi;
export const EMPTY_MARK = '________'; // campo conhecido mas sem dado: sai uma linha para preencher à mão

// Devolve o valor (string, '' se vazio) ou undefined se a variável não existe.
export function lookup(ctx, key) {
  const [group, name] = String(key).toLowerCase().split('.');
  const v = ctx?.[group]?.[name];
  return typeof v === 'string' ? v : undefined;
}

// Troca as variáveis pelos dados. Sem `ctx` devolve o texto como está (modo edição).
// Variável que não existe (erro de digitação) fica visível; a que existe mas está vazia vira uma linha.
export function fillText(text, ctx) {
  if (!ctx || !text || !text.includes('{{')) return text;
  return text.replace(VAR_RE, (whole, key) => {
    const v = lookup(ctx, key);
    return v === undefined ? whole : v || EMPTY_MARK;
  });
}

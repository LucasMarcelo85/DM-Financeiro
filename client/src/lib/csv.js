const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/;

export function stringifyCsv(columns, rows, format) {
  const delimiter = ';';
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const values = rows.map((row) => [
    format,
    ...columns.map(({ key, type }) => {
      const value = row[key];
      if (value === null || value === undefined) return '';
      if (type === 'json') return JSON.stringify(value);
      if (type === 'date') return value ? new Date(value).toISOString() : '';
      if (type === 'boolean') return value ? 'true' : 'false';
      if (type === 'string' && FORMULA_PREFIX.test(String(value))) return `'${value}`;
      return String(value);
    }),
  ]);
  return [
    ['_dm_format', ...columns.map(({ key }) => key)],
    ...values,
  ].map((row) => row.map(escape).join(delimiter)).join('\r\n');
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let i = 0; i < firstLine.length; i += 1) {
    if (firstLine[i] === '"') {
      if (quoted && firstLine[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted && firstLine[i] === ',') commas += 1;
    else if (!quoted && firstLine[i] === ';') semicolons += 1;
  }
  return semicolons > commas ? ';' : ',';
}

export function parseCsv(text) {
  const delimiter = detectDelimiter(text.replace(/^\uFEFF/, ''));
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('O CSV tem aspas sem fechamento.');
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

export function parseCsvRows(text, columns, format) {
  const rows = parseCsv(text);
  const expectedHeaders = ['_dm_format', ...columns.map(({ key }) => key)];
  if (!rows.length || rows[0].length !== expectedHeaders.length || expectedHeaders.some((key, index) => rows[0][index] !== key)) {
    throw new Error('As colunas deste CSV não correspondem ao formato de exportação desta área.');
  }
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== expectedHeaders.length) throw new Error(`A linha ${index + 2} tem uma quantidade diferente de colunas.`);
    if (cells[0] !== format) throw new Error(`A linha ${index + 2} não pertence a este formato de CSV.`);
    return Object.fromEntries(columns.map(({ key, type }, columnIndex) => {
      let value = cells[columnIndex + 1];
      if (type === 'json') {
        try { value = value ? JSON.parse(value) : null; } catch { throw new Error(`O campo "${key}" da linha ${index + 2} não contém JSON válido.`); }
      } else if (type === 'number') {
        value = value === '' ? null : Number(value);
        if (value !== null && !Number.isFinite(value)) throw new Error(`O campo "${key}" da linha ${index + 2} não contém um número válido.`);
      } else if (type === 'boolean') {
        if (value !== 'true' && value !== 'false') throw new Error(`O campo "${key}" da linha ${index + 2} deve ser true ou false.`);
        value = value === 'true';
      } else if (type === 'date') value = value || null;
      else if (value.startsWith("'") && FORMULA_PREFIX.test(value.slice(1))) value = value.slice(1);
      return [key, value];
    }));
  });
}

export async function importCsvBatches(rows, submit, batchSize = 500, maxBatchBytes = Infinity) {
  const summary = { created: 0, updated: 0, skipped: 0, errors: [] };
  for (let offset = 0; offset < rows.length;) {
    let end = offset;
    let bytes = 2;
    while (end < rows.length && end - offset < batchSize) {
      const rowBytes = JSON.stringify(rows[end]).length + 1;
      if (end > offset && bytes + rowBytes > maxBatchBytes) break;
      bytes += rowBytes;
      end += 1;
    }
    const batch = rows.slice(offset, end);
    try {
      const result = await submit(batch);
      summary.created += result.created || 0;
      summary.updated += result.updated || 0;
      summary.skipped += result.skipped || 0;
      summary.errors.push(...(result.errors || []).map((error) => ({ ...error, row: error.row + offset })));
    } catch (error) {
      summary.errors.push({ row: offset + 2, message: `Falha ao importar este lote de ${batch.length} registro(s): ${error.message}` });
      summary.skipped += batch.length;
    }
    offset = end;
  }
  return summary;
}

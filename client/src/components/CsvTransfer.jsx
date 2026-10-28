import { useState } from 'react';
import { api } from '../api.js';
import { parseCsvRows, stringifyCsv } from '../lib/csv.js';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';

const FORMAT_PREFIX = 'dm-financeiro';
const FILE_LIMIT = (resource) => {
  if (resource === 'orders') return 10;
  if (resource === 'contacts' || resource === 'order-customers') return 4;
  return 100;
};
const MAX_ROWS = 10000;

function download(filename, contents) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', contents], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function CsvTransfer({ resource, title, filename, exportUrl, columns, description, dateDescription = 'criação', onImport }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('export');
  const [range, setRange] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const format = `${FORMAT_PREFIX}:${resource}:v1`;

  function close() {
    if (busy) return;
    setOpen(false);
    setRows(null);
    setFileName('');
    setError('');
  }

  async function exportFile() {
    if (range && (!from || !to || from > to)) {
      setError('Escolha um período válido, com a data inicial antes da data final.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (range) { params.set('from', from); params.set('to', to); }
      const result = await api.get(`${exportUrl}?${params}`);
      if (!result.rows.length) {
        setError('Não há dados para exportar nesse período.');
        return;
      }
      download(filename, stringifyCsv(columns, result.rows, format));
      toast(`Arquivo CSV de ${title.toLocaleLowerCase('pt-BR')} gerado com ${result.rows.length} registro(s).`);
      setOpen(false);
      setRows(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setRows(null);
    setFileName('');
    setError('');
    if (!file) return;
    const maxFileMb = FILE_LIMIT(resource);
    if (file.size > maxFileMb * 1024 * 1024) {
      setError(`O arquivo ultrapassa o limite de ${maxFileMb} MB. Exporte em períodos menores e tente novamente.`);
      return;
    }
    try {
      const parsed = parseCsvRows(await file.text(), columns, format);
      if (!parsed.length) throw new Error('O arquivo não contém registros para importar.');
      if (parsed.length > MAX_ROWS) throw new Error(`O arquivo pode ter no máximo ${MAX_ROWS.toLocaleString('pt-BR')} registros por importação.`);
      setRows(parsed);
      setFileName(file.name);
    } catch (e) {
      setError(e.message);
    }
  }

  async function importFile() {
    if (!rows?.length) return;
    setBusy(true);
    setError('');
    try {
      const result = await onImport(rows);
      const failures = result.errors || [];
      const message = `${result.created} importado(s)${result.updated ? `, ${result.updated} atualizado(s)` : ''}${result.skipped ? `, ${result.skipped} ignorado(s)` : ''}${failures.length ? `, ${failures.length} com erro` : ''}.`;
      if (failures.length) {
        setError(`${message} ${failures.slice(0, 3).map((item) => `Linha ${item.row}: ${item.message}`).join(' ')}`);
        setRows(null);
      } else {
        toast(message);
        setOpen(false);
        setRows(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        <Icon name="file" size={18} /> Importar / exportar
      </button>
      {open && (
        <Modal title={`Importar e exportar ${title.toLocaleLowerCase('pt-BR')}`} onClose={close} wide>
          <div className="seg" role="tablist" aria-label="Importar ou exportar">
            <button type="button" role="tab" aria-selected={tab === 'export'} className={tab === 'export' ? 'is-on' : ''} onClick={() => { setTab('export'); setError(''); }}>Exportar CSV</button>
            <button type="button" role="tab" aria-selected={tab === 'import'} className={tab === 'import' ? 'is-on' : ''} onClick={() => { setTab('import'); setError(''); }}>Importar CSV</button>
          </div>
          {tab === 'export' ? (
            <div className="csv-transfer-body">
              <p className="muted">{description}</p>
              <label className="sender"><input type="checkbox" checked={!range} onChange={(e) => setRange(!e.target.checked)} /> Exportar todos os registros</label>
              {range && (
                <div className="form-row">
                  <label className="field"><span>Data inicial</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                  <label className="field"><span>Data final</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
                </div>
              )}
              <p className="muted small">O arquivo CSV usa o mesmo formato aceito na importação. As datas filtram pela {dateDescription} do registro.</p>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={exportFile} disabled={busy}><Icon name="download" size={18} /> {busy ? 'Preparando...' : 'Baixar CSV'}</button>
              </div>
            </div>
          ) : (
            <div className="csv-transfer-body">
              <p className="muted">{description} Escolha um CSV exportado nesta área. A importação não apaga registros.</p>
              <label className="field">
                <span>Arquivo CSV</span>
                <input className="input" type="file" accept=".csv,text/csv" onChange={chooseFile} disabled={busy} />
              </label>
              {rows && (
                <div className="csv-preview">
                  <strong>{fileName} · {rows.length} registro(s)</strong>
                  <div className="table-scroll">
                    <table><thead><tr>{columns.slice(0, 5).map((column) => <th key={column.key}>{column.key}</th>)}</tr></thead>
                      <tbody>{rows.slice(0, 3).map((row, index) => <tr key={index}>{columns.slice(0, 5).map((column) => <td key={column.key}>{column.type === 'json' ? '[dados]' : String(row[column.key] ?? '')}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                  {rows.length > 3 && <small className="muted">Exibindo os 3 primeiros registros.</small>}
                </div>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={importFile} disabled={busy || !rows?.length}><Icon name="upload" size={18} /> {busy ? 'Importando...' : 'Importar registros'}</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

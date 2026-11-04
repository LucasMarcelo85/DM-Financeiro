import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toast.jsx';

const KIND_LABEL = { image: 'Foto', video: 'Vídeo', document: 'Documento' };
const ACCEPT = {
  all: 'image/jpeg,image/png,image/webp,video/mp4,video/3gpp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv',
  document: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,application/pdf',
};

const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const readBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
  reader.readAsDataURL(file);
});

// Biblioteca de arquivos reutilizáveis: envia uma vez, escolhe sempre que precisar.
// onlyDocuments: cobrança aceita só documentos; lembrete aceita foto, vídeo e documento.
export default function MediaPicker({ value, onChange, onlyDocuments = false }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/media${onlyDocuments ? '?kind=document' : ''}`).then((r) => setItems(r.media)).catch(() => setItems([]));
  }, [onlyDocuments]);

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const data = await readBase64(file);
      const { media } = await api.post('/media', { name: file.name, mimeType: file.type, data });
      setItems((list) => [media, ...(list || [])]);
      onChange(media.id);
      toast('Arquivo salvo na biblioteca.');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(item) {
    if (!window.confirm(`Excluir "${item.name}" da biblioteca? Itens que usam este arquivo deixam de enviá-lo.`)) return;
    try {
      await api.del(`/media/${item.id}`);
      setItems((list) => list.filter((m) => m.id !== item.id));
      if (value === item.id) onChange(null);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <div className="field media-picker">
      <span>{onlyDocuments ? 'Documento (opcional)' : 'Foto, vídeo ou documento (opcional)'}</span>
      <div className="media-list" role="radiogroup" aria-label="Arquivos da biblioteca">
        <button type="button" role="radio" aria-checked={value == null} className={`media-item ${value == null ? 'is-on' : ''}`} onClick={() => onChange(null)}>Sem arquivo</button>
        {(items || []).map((m) => (
          <span key={m.id} className={`media-item ${value === m.id ? 'is-on' : ''}`}>
            <button type="button" role="radio" aria-checked={value === m.id} onClick={() => onChange(m.id)}>
              <b>{KIND_LABEL[m.kind]}</b> {m.name} <small>{sizeText(m.size)}</small>
            </button>
            <button type="button" className="media-del" aria-label={`Excluir ${m.name}`} onClick={() => remove(m)}>×</button>
          </span>
        ))}
      </div>
      <input ref={inputRef} type="file" hidden accept={onlyDocuments ? ACCEPT.document : ACCEPT.all} onChange={upload} />
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Enviando...' : 'Enviar novo arquivo'}
      </button>
      <small>
        {onlyDocuments ? 'PDF, Word, Excel, PowerPoint, TXT ou CSV até 16 MB.' : 'Foto até 5 MB; vídeo MP4 e documentos até 16 MB.'} Fica salvo para reutilizar. O texto da mensagem vai como legenda do arquivo.
      </small>
      {items === null && <small>Carregando biblioteca...</small>}
    </div>
  );
}

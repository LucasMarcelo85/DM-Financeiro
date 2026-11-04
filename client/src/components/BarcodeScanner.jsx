import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';

const FORMATS = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF];

export default function BarcodeScanner({ onDetected, onClose }) {
  const video = useRef(null);
  const last = useRef({ code: '', at: 0 });
  const handler = useRef(onDetected);
  const [error, setError] = useState('');
  const [lastCode, setLastCode] = useState('');
  handler.current = onDetected;

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('A câmera só funciona em conexão segura (HTTPS) e em navegadores compatíveis.');
      return undefined;
    }
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, FORMATS], [DecodeHintType.TRY_HARDER, true]]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
    let controls = null;
    let stopped = false;
    reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current, (result) => {
      if (!result) return;
      const code = result.getText();
      const now = Date.now();
      if (code === last.current.code && now - last.current.at < 1800) return;
      last.current = { code, at: now };
      setLastCode(code);
      handler.current(code);
    }).then((c) => { if (stopped) c.stop(); else controls = c; })
      .catch((e) => setError(e?.name === 'NotAllowedError' ? 'Permita o acesso à câmera no navegador para bipar.' : 'Não foi possível abrir a câmera.'));
    return () => { stopped = true; controls?.stop(); };
  }, []);

  return (
    <Modal title="Bipar com a câmera" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Concluir</button>}>
      {error ? <p className="form-error" role="alert">{error}</p> : <>
        <div className="scan-frame"><video ref={video} muted playsInline /><span className="scan-line" /></div>
        <p className="muted"><Icon name="camera" size={14} /> Aponte para o código de barras. Cada leitura adiciona o item; continue bipando e toque em Concluir.</p>
        {lastCode && <p>Último código: <strong>{lastCode}</strong></p>}
      </>}
    </Modal>
  );
}

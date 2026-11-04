import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// Renderiza o conteúdo fora do app e abre o diálogo de impressão; o CSS @media print esconde todo o resto.
export default function PrintPortal({ pageCss, children, onDone }) {
  useEffect(() => {
    let finished = false;
    const done = () => { if (!finished) { finished = true; onDone?.(); } };
    const images = [...document.querySelectorAll('.print-root img')];
    const loaded = Promise.race([
      Promise.all(images.map((img) => (img.complete ? null : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; })))),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    const timer = setTimeout(() => {
      loaded.then(() => {
        window.addEventListener('afterprint', done, { once: true });
        window.print();
      });
    }, 150);
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', done); };
  }, [onDone]);

  return createPortal(
    <div className="print-root">
      <style>{`@page { ${pageCss} }`}</style>
      {children}
    </div>,
    document.body,
  );
}

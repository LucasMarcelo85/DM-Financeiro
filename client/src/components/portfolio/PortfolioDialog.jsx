import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { readableOn } from '../../lib/portfolio/model.js';

export default function PortfolioDialog({ title, theme, onClose, children }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = `portfolio-dialog-${useId().replace(/:/g, '')}`;
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const primary = theme?.primary || '#f2a33a';
  const style = {
    '--pv-dialog-bg': theme?.bg || '#ffffff',
    '--pv-dialog-text': theme?.text || '#14202e',
    '--pv-dialog-primary': primary,
    '--pv-dialog-on-primary': readableOn(primary),
  };

  return createPortal(
    <div className="pv-dialog-backdrop" style={style}>
      <section ref={dialogRef} className="pv-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button ref={closeRef} type="button" className="pv-dialog-close" onClick={() => onCloseRef.current()} aria-label="Fechar">×</button>
        <h2 id={titleId} className="pv-dialog-title">{title}</h2>
        <div className="pv-dialog-content">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

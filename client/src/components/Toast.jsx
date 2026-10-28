import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const announcedError = useRef(0);

  const toast = useCallback((message, type = 'ok') => {
    const id = ++seq.current;
    setItems((list) => [...list, { id, message, type }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), type === 'error' ? 6500 : 4000);
  }, []);

  useEffect(() => {
    const error = [...items].reverse().find((item) => item.type === 'error');
    if (!error || error.id === announcedError.current) return;
    announcedError.current = error.id;
    const notification = document.getElementById(`toast-${error.id}`);
    notification?.focus({ preventScroll: true });
    notification?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [items]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            id={`toast-${t.id}`}
            className={`toast toast-${t.type}`}
            role={t.type === 'error' ? 'alert' : undefined}
            aria-live={t.type === 'error' ? 'assertive' : undefined}
            tabIndex={t.type === 'error' ? -1 : undefined}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

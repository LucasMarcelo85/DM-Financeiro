import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

// Carrega os WhatsApps do usuário e atualiza o estado (luz verde/vermelha) de tempos em tempos.
export function useInstances(intervalMs = 8000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.get('/instances'));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);

  return { data, error, reload: load };
}

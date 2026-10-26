import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setPinToken } from './api.js';
import { setTimezone } from './lib/format.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pinUntil, setPinUntilState] = useState(null); // até quando as abas com PIN ficam destravadas nesta tela (ms)
  const setPinUntil = useCallback((until, token) => {
    setPinUntilState(until || null);
    setPinToken(until ? token : null);
  }, []);

  // Mantém o fuso do sistema disponível para formatar datas e horários.
  useEffect(() => {
    if (user?.timezone) setTimezone(user.timezone);
  }, [user]);

  const refresh = useCallback(async () => {
    try {
      const { user: u, pinUnlockedUntil } = await api.get('/auth/me');
      setUser(u);
      if (!pinUnlockedUntil) setPinUntil(null);
      return u;
    } catch {
      setUser(null);
      return null;
    }
  }, [setPinUntil]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Quando a API avisa que o teste acabou, atualiza o usuário e o guard redireciona para o plano.
  useEffect(() => {
    window.addEventListener('dm:payment-required', refresh);
    return () => window.removeEventListener('dm:payment-required', refresh);
  }, [refresh]);

  // Trava de novo quando o tempo do PIN acaba ou quando o servidor avisa que a aba pede o PIN.
  useEffect(() => {
    if (!pinUntil) return undefined;
    const t = setTimeout(() => setPinUntil(null), Math.max(0, pinUntil - Date.now()));
    return () => clearTimeout(t);
  }, [pinUntil]);
  useEffect(() => {
    const lock = () => setPinUntil(null);
    window.addEventListener('dm:pin-required', lock);
    return () => window.removeEventListener('dm:pin-required', lock);
  }, []);

  const pinUnlocked = Boolean(pinUntil && pinUntil > Date.now());

  const value = useMemo(
    () => ({
      user,
      loading,
      refresh,
      setUser,
      pinUnlocked,
      pinUntil,
      // Digita o PIN: se estiver certo, as abas protegidas abrem por alguns minutos.
      unlockPin: async (pin) => {
        const r = await api.post('/auth/pin/verify', { pin });
        setPinUntil(r.pinUnlockedUntil, r.pinToken);
      },
      lockPin: async () => {
        await api.post('/auth/pin/lock').catch(() => {});
        setPinUntil(null);
      },
      // Aplica a resposta das telas de PIN/perfil (usuário atualizado e estado do desbloqueio).
      applyPin: (r) => {
        if (r.user) setUser(r.user);
        if ('pinUnlockedUntil' in r) setPinUntil(r.pinUnlockedUntil, r.pinToken);
      },
      login: async (identifier, password) => {
        const { user: u } = await api.post('/auth/login', { identifier, password });
        setUser(u);
        setPinUntil(null);
        return u;
      },
      register: async (payload) => {
        const { user: u } = await api.post('/auth/register', payload);
        setUser(u);
        return u;
      },
      logout: async () => {
        await api.post('/auth/logout').catch(() => {});
        setUser(null);
        setPinUntil(null);
      },
    }),
    [user, loading, refresh, pinUnlocked, pinUntil]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

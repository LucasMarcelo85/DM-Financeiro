import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { setTimezone } from './lib/format.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Mantém o fuso do sistema disponível para formatar datas e horários.
  useEffect(() => {
    if (user?.timezone) setTimezone(user.timezone);
  }, [user]);

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api.get('/auth/me');
      setUser(u);
      return u;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Quando a API avisa que o teste acabou, atualiza o usuário e o guard redireciona para o plano.
  useEffect(() => {
    window.addEventListener('dm:payment-required', refresh);
    return () => window.removeEventListener('dm:payment-required', refresh);
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      loading,
      refresh,
      setUser,
      login: async (identifier, password) => {
        const { user: u } = await api.post('/auth/login', { identifier, password });
        setUser(u);
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
      },
    }),
    [user, loading, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { ToastProvider } from './components/Toast.jsx';
import PortfolioPublic from './pages/PortfolioPublic.jsx';
import ShopApp from './pages/ShopApp.jsx';
import './styles.css';

// Domínio próprio de um portfólio (meusite.com.br): o servidor marca o HTML com o dono do site.
// Aí só existe a página pública: "/" = página principal e "/<página>" = as demais. Sem login, sem menu.
const siteOwner = document.querySelector('meta[name="pf-user"]')?.getAttribute('content') || '';
// Aplicativo do lojista (/app): tela própria, sem login do painel nem menu.
const shopApp = /^\/app(\/|$)/.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {shopApp ? (
        <ToastProvider>
          <Routes>
            <Route path="/app" element={<ShopApp />} />
            <Route path="/app/:slug" element={<ShopApp />} />
          </Routes>
        </ToastProvider>
      ) : siteOwner ? (
        <Routes>
          <Route path="/" element={<PortfolioPublic fixedUser={siteOwner} />} />
          <Route path=":pageSlug" element={<PortfolioPublic fixedUser={siteOwner} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      )}
    </BrowserRouter>
  </React.StrictMode>
);

// server/services/easypanel.js
import fetch from 'node-fetch';
import { config } from '../config.js';

export async function addDomainToEasypanel(domain) {
    if (!config.easypanel.url || !config.easypanel.apiKey) {
        console.warn('[easypanel] API não configurada. Domínio não adicionado automaticamente.');
        return;
    }

    try {
        const response = await fetch(`${config.easypanel.url}/projects/${config.easypanel.projectName}/services/${config.easypanel.serviceName}/domains`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.easypanel.apiKey}`
            },
            body: JSON.stringify({ domain })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[easypanel] Erro ao adicionar domínio (${domain}):`, errText);
        }
    } catch (error) {
        console.error('[easypanel] Falha de conexão com a API:', error);
    }
}

export async function removeDomainFromEasypanel(domain) {
    if (!config.easypanel.url || !config.easypanel.apiKey) return;

    try {
        const response = await fetch(`${config.easypanel.url}/projects/${config.easypanel.projectName}/services/${config.easypanel.serviceName}/domains`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.easypanel.apiKey}`
            },
            body: JSON.stringify({ domain })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[easypanel] Erro ao remover domínio (${domain}):`, errText);
        }
    } catch (error) {
        console.error('[easypanel] Falha de conexão com a API:', error);
    }
}
import * as evo from './evolution.js';
import * as meta from './meta.js';

// Camada única para falar com um WhatsApp, seja ele conectado por QR Code (Evolution) ou pela API oficial (Meta).
export const getState = (inst) => (inst.provider === 'meta' ? meta.getState(inst) : evo.getState(inst.name));

// `to`: número com DDI (ex.: 5585999999999) ou, em grupos, o identificador do grupo.
export const sendText = (inst, to, text) => (inst.provider === 'meta' ? meta.sendText(inst, to, text) : evo.sendText(inst.name, to, text));

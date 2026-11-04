import { Router } from 'express';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';

// Biblioteca de arquivos do usuário (foto, vídeo, documento) para reutilizar em cobranças e lembretes.
const router = Router();
const MAX_BYTES = 16 * 1024 * 1024; // limite do WhatsApp para vídeo e documento
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 60;

const TYPES = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'video/mp4': 'video', 'video/3gpp': 'video',
  'application/pdf': 'document', 'text/plain': 'document', 'text/csv': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
};

const dto = (m) => ({ id: m.id, kind: m.kind, name: m.name, mimeType: m.mimeType, size: m.size, createdAt: m.createdAt.getTime() });
const select = { id: true, kind: true, name: true, mimeType: true, size: true, createdAt: true };

router.get('/', async (req, res) => {
  const kind = ['image', 'video', 'document'].includes(req.query.kind) ? req.query.kind : undefined;
  const rows = await prisma.savedMedia.findMany({ where: { userId: req.user.id, ...(kind ? { kind } : {}) }, select, orderBy: { id: 'desc' }, take: MAX_FILES });
  res.json({ media: rows.map(dto), maxFiles: MAX_FILES });
});

router.post('/', async (req, res) => {
  const mimeType = String(req.body?.mimeType || '').toLowerCase();
  const kind = TYPES[mimeType];
  if (!kind) throw new AppError(400, 'Tipo de arquivo não suportado. Use foto (JPG, PNG, WebP), vídeo MP4 ou documento (PDF, Word, Excel, PowerPoint, TXT, CSV).');
  const name = String(req.body?.name || '').replace(/[\\/\r\n\0]/g, '_').trim().slice(0, 120) || 'arquivo';
  const raw = String(req.body?.data || '').replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new AppError(400, 'Arquivo inválido.');
  const data = Buffer.from(raw, 'base64');
  if (!data.length) throw new AppError(400, 'O arquivo está vazio.');
  if (data.length > (kind === 'image' ? MAX_IMAGE_BYTES : MAX_BYTES)) {
    throw new AppError(413, kind === 'image' ? 'A foto pode ter até 5 MB.' : 'O arquivo pode ter até 16 MB.');
  }
  if (await prisma.savedMedia.count({ where: { userId: req.user.id } }) >= MAX_FILES) {
    throw new AppError(403, `Sua biblioteca já tem ${MAX_FILES} arquivos. Exclua algum para enviar outro.`, 'LIMIT_REACHED');
  }
  const row = await prisma.savedMedia.create({ data: { userId: req.user.id, kind, name, mimeType, size: data.length, data }, select });
  res.status(201).json({ media: dto(row) });
});

router.delete('/:id', async (req, res) => {
  const r = await prisma.savedMedia.deleteMany({ where: { id: Number(req.params.id) || 0, userId: req.user.id } });
  if (!r.count) throw new AppError(404, 'Arquivo não encontrado.');
  res.json({ ok: true });
});

export default router;

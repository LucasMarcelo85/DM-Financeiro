import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config.js';

if (!config.databaseUrl) {
  throw new Error(
    'DATABASE_URL não está definida. Exemplo: DATABASE_URL=postgres://usuario:senha@host:5432/banco?sslmode=disable'
  );
}
// O Prisma lê esta variável (já sem aspas) em algumas operações internas.
process.env.DATABASE_URL = config.databaseUrl;

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.databaseUrl }),
});

// O banco pode demorar a ficar pronto quando tudo sobe junto (ex.: após um deploy).
export async function connectWithRetry(tries = 8, waitMs = 3000) {
  for (let i = 1; i <= tries; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (e) {
      if (i === tries) throw e;
      console.warn(`[banco] sem conexão (tentativa ${i}/${tries}): ${e.message.split('\n')[0]}`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

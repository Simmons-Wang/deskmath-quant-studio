import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { QuantDatabase } from './db.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Works from both src/index.ts (dev) and dist/server/src/index.js (prod)
const clientDistDir = path.resolve(
  __dirname.includes(`${path.sep}dist${path.sep}`)
    ? path.join(__dirname, '..', '..', '..', '..', 'client', 'dist')
    : path.join(__dirname, '..', '..', 'client', 'dist'),
);

const port = Number(process.env.PORT ?? 3001);
const db = new QuantDatabase(process.env.DATABASE_PATH);
const app = createApp(db, process.env.NODE_ENV === 'production' ? clientDistDir : undefined);

const server = app.listen(port, () => {
  console.log(`Quant Mental Math API listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

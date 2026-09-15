import path from 'node:path';
import { createLocalApp } from './app';

const production = process.argv.includes('--production');
const projectDirectory = process.cwd();
const { app, close } = await createLocalApp({ storageDirectory: path.join(projectDirectory, '.mopai'), initialDirectory: path.resolve(process.env.ARTICLES_DIR || path.join(projectDirectory, 'articles')), projectDirectory, watch: true, distDirectory: production ? path.join(projectDirectory, 'dist') : undefined });
const port = Number(process.env.PORT) || 3001;
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`\n  墨排 · 本地文章服务 http://127.0.0.1:${port}`);
  console.log(production ? '  在浏览器打开上面的地址，开始排版。\n' : '  网页工作台 http://127.0.0.1:5173\n');
});
server.on('error', (error: NodeJS.ErrnoException) => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请先关闭已有的墨排服务。` : error); process.exitCode = 1; void close(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void close().then(() => server.close(() => process.exit(0))); });

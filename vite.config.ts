import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** In `npm run dev`, serve the Vercel functions in api/ too (on Vercel they run on their own). */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/menu-scan', async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const mod = await server.ssrLoadModule('/api/menu-scan.ts');
        const request = new Request(`http://localhost${req.originalUrl ?? req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        });
        const response: Response = req.method === 'POST' ? await mod.POST(request) : new Response(null, { status: 405 });
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  server: { port: 5173, host: true },
});

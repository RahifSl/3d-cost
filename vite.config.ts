import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { defineConfig, Plugin } from 'vite';

const imageProxyPlugin = (): Plugin => ({
  name: 'image-proxy-middleware',
  configureServer(server) {
    server.middlewares.use('/api/proxy-image', async (req, res) => {
      try {
        const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const targetUrl = parsedUrl.searchParams.get('url');
        if (!targetUrl) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing url query parameter' }));
          return;
        }

        const resp = await fetch(targetUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          }
        });

        if (!resp.ok) {
          res.statusCode = resp.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Image server responded with ${resp.status} ${resp.statusText}` }));
          return;
        }

        const contentType = resp.headers.get('content-type') || 'image/jpeg';
        const buffer = await resp.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const dataUrl = `data:${contentType};base64,${base64}`;

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ dataUrl, mimeType: contentType, sizeBytes: buffer.byteLength }));
      } catch (err: any) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message || 'Failed to fetch image URL' }));
      }
    });

    // OrcaSlicer Live Sliced Plate Detection Endpoint
    server.middlewares.use('/api/latest-slice', async (_req, res) => {
      try {
        const tempBase = path.join(os.tmpdir(), 'orcaslicer_model');
        const foundFiles: { file: string; mtime: number }[] = [];

        if (fs.existsSync(tempBase)) {
          const days = fs.readdirSync(tempBase);
          for (const day of days) {
            const dayDir = path.join(tempBase, day);
            try {
              if (fs.statSync(dayDir).isDirectory()) {
                const sessions = fs.readdirSync(dayDir);
                for (const session of sessions) {
                  const metaDir = path.join(dayDir, session, 'Metadata');
                  if (fs.existsSync(metaDir)) {
                    const metaFiles = fs.readdirSync(metaDir);
                    for (const f of metaFiles) {
                      if (f.toLowerCase().endsWith('.gcode')) {
                        const full = path.join(metaDir, f);
                        const stat = fs.statSync(full);
                        foundFiles.push({ file: full, mtime: stat.mtimeMs });
                      }
                    }
                  }
                }
              }
            } catch {
              // Ignore locked/unreadable subfolders
            }
          }
        }

        foundFiles.sort((a, b) => b.mtime - a.mtime);
        if (foundFiles.length > 0) {
          const newest = foundFiles[0];
          const fd = fs.openSync(newest.file, 'r');
          const maxRead = Math.min(6 * 1024 * 1024, fs.statSync(newest.file).size);
          const buf = Buffer.alloc(maxRead);
          fs.readSync(fd, buf, 0, maxRead, 0);
          fs.closeSync(fd);
          const gcode = buf.toString('utf-8');

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(
            JSON.stringify({
              status: 'ok',
              slice: {
                filename: path.basename(newest.file),
                path: newest.file,
                gcode,
                timestamp: newest.mtime
              }
            })
          );
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ status: 'no_slice', slice: null }));
      } catch (err: any) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }
});

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      imageProxyPlugin()
    ],
    optimizeDeps: {
      entries: ['index.html']
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.')
      }
    },
    build: {
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {}
    }
  };
});

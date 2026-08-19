/**
 * Worker build script.
 *
 * Bundles src/worker.ts into a single Cloudflare Worker JS file, redirecting
 * Node-bound modules to their worker-safe twins via an esbuild onResolve plugin
 * (so the Node source tree stays untouched and type-checked by tsc).
 *
 *   node scripts/build-worker.mjs          → dist-worker/worker.js
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// node-bound module → worker-safe twin. Keys are canonical module paths
// (e.g. "modules/queue/service") matched against the *resolved* file path so
// any relative import depth is caught.
const REDIRECTS = {
  'config': './src/config-worker.ts',
  'config/index': './src/config-worker.ts',
  'shared/logger': './src/shared/logger-worker.ts',
  'shared/prisma': './src/shared/prisma-d1.ts',
  'shared/sse': './src/shared/sse-worker.ts',
  'modules/queue/service': './src/modules/queue/service-worker.ts',
  'modules/automation/registry': './src/modules/automation/registry-worker.ts',
  'modules/whatsapp/rate-limit-store': './src/modules/whatsapp/rate-limit-store-worker.ts',
  'modules/google_sheets/service': './src/modules/google_sheets/service-worker.ts',
  'modules/scheduler/service': './src/modules/scheduler/service-worker.ts',
  'modules/whatsapp/controller': './src/modules/whatsapp/controller-worker.ts',
};

const resolvePlugin = {
  name: 'founder-worker-redirects',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.importer && !args.importer.includes('node_modules')) {
        // Absolute node built-ins used anywhere in our source → crypto shim / stub
        if (args.path === 'crypto' || args.path === 'node:crypto') {
          return { path: join(root, 'src/shared/crypto-worker.ts'), namespace: 'file' };
        }
        if (args.path === 'fs' || args.path === 'node:fs') {
          return { path: join(root, 'src/shared/empty-module.ts'), namespace: 'file' };
        }
        if (args.path === 'path' || args.path === 'node:path') {
          return { path: join(root, 'src/shared/empty-module.ts'), namespace: 'file' };
        }
        // Relative module redirect: match on the canonical suffix of the resolved path.
        if (args.path.startsWith('.') && args.resolveDir) {
          const candidate = join(args.resolveDir, args.path).replace(/\\/g, '/');
          const base = candidate.split('/src/')[1]?.replace(/\.ts$/, '');
          if (base) {
            for (const [from, to] of Object.entries(REDIRECTS)) {
              if (base === from || base.endsWith('/' + from)) {
                // Never redirect the worker twins themselves (e.g. controller-worker
                // importing ./controller would loop back onto itself).
                if (args.importer.includes(to.replace('./src/', '').replace('.ts', ''))) {
                  return undefined;
                }
                return { path: join(root, to), namespace: 'file' };
              }
            }
          }
        }
      }
      return undefined;
    });
  },
};

// Stub for node built-ins that may be referenced by our source at import time.
writeFileSync(join(root, 'src/shared/empty-module.ts'), 'export default {};\nexport const existsSync = () => false;\n');

mkdirSync(join(root, 'dist-worker'), { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/worker.ts')],
  bundle: true,
  outfile: join(root, 'dist-worker/worker.js'),
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  external: ['__STATIC_CONTENT_MANIFEST'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [resolvePlugin],
  logLevel: 'info',
});

if (result.errors.length) {
  process.exit(1);
}

console.log('Worker bundle written to dist-worker/worker.js');
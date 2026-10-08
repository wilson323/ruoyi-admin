import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { GraphDatabase } from '@ruvector/graph-node';
const require = createRequire(import.meta.url);
const adbRoot = resolve(require.resolve('agentdb/package.json'), '..');
const { GraphDatabaseAdapter } = await import(pathToFileURL(join(adbRoot, 'dist/src/backends/graph/GraphDatabaseAdapter.js')));
const { SemanticQueryRouter } = await import(pathToFileURL(join(adbRoot, 'dist/src/backends/rvf/SemanticQueryRouter.js')));

// Use the official adapter with strict existing-file open; upstream catches an
// ESM require error and may recreate an existing graph instead of reading it.
export async function createGraphController({ agentdb, cwd }) {
  const directory = join(resolve(cwd), '.swarm');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const storagePath = join(directory, 'agentdb-graph.db');
  const dimensions = agentdb.embedder?.config?.dimension ?? 384;
  const adapter = new GraphDatabaseAdapter({ storagePath, dimensions, distanceMetric: 'Cosine' }, agentdb.embedder);
  adapter.db = existsSync(storagePath)
    ? GraphDatabase.open(storagePath)
    : new GraphDatabase({ storagePath, dimensions, distanceMetric: 'Cosine' });
  await adapter.db.stats(); // Do not register a handle whose initialization failed.
  adapter.execute = (cypher) => adapter.db.query(cypher);
  adapter.storagePath = storagePath;
  return adapter;
}

const initialRoutes = [
  ['coding', 'Implement a new feature and write application code'],
  ['debugging', 'Diagnose and fix an error, crash, or failing software behavior'],
  ['testing', 'Write and run tests to verify application behavior'],
  ['reviewing', 'Review code for security vulnerabilities and correctness'],
  ['documentation', 'Write documentation and explain software architecture'],
  ['research', 'Research technical solutions and compare available approaches'],
];
export async function createSemanticController({ agentdb, cwd }) {
  const embedder = agentdb.embedder;
  if (!embedder || typeof embedder.embedQuery !== 'function' || typeof embedder.embedPassage !== 'function')
    throw new Error('Semantic routing requires AgentDB query/passage embedder');
  if (!(embedder.config?.provider === 'transformers' && embedder.pipeline) &&
      !(embedder.config?.provider === 'openai' && embedder.config?.apiKey))
    throw new Error('Semantic routing refused: AgentDB embedding backend is mock/unavailable');
  const dimension = embedder.config.dimension;
  // CJS package exposes SemanticRouter through module.exports; Node's ESM
  // named-export detection exposes only VectorDb, breaking upstream create().
  const { SemanticRouter } = require('@ruvector/router');
  if (typeof SemanticRouter !== 'function') throw new Error('Native SemanticRouter export missing');
  const native = new SemanticQueryRouter({ dimension });
  native.router = new SemanticRouter({ dimension, threshold: 0 });
  native._useNative = true;
  const directory = join(resolve(cwd), '.swarm');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const statePath = join(directory, 'semantic-router-intents.json');
  // Upstream JSON restore fills only fallbackIntents even in native mode.
  // Restore centroids explicitly through addIntent to populate the native index.
  const records = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : [];
  if (!Array.isArray(records)) throw new Error('Invalid semantic router intent state');
  const register = (record) => {
    if (!record.name || !Array.isArray(record.centroid) || record.centroid.length !== dimension || record.centroid.some(v => !Number.isFinite(v)))
      throw new Error('Invalid persisted semantic intent');
    native.addIntent({ name: record.name, exemplars: [Float32Array.from(record.centroid)], metadata: record.metadata ?? {} });
  };
  for (const record of records) register(record);
  const persist = () => {
    const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(records), { mode: 0o600 });
    renameSync(temporary, statePath);
  };
  const controller = {
    isNative: true, statePath,
    async addRoute(name, description, metadata = {}) {
      const centroid = Array.from(await embedder.embedPassage(description));
      const record = { name, centroid, metadata };
      register(record);
      const index = records.findIndex(r => r.name === name);
      if (index < 0) records.push(record); else records[index] = record;
      persist();
    },
    async route(text) {
      if (typeof text !== 'string' || !text.trim()) throw new Error('Routing requires non-empty text');
      const matches = native.route(await embedder.embedQuery(text), 1);
      const match = matches[0];
      return match ? { route: match.intent, confidence: match.score, metadata: match.metadata, engine: 'native-semantic' } : null;
    },
    getRoutes() { return native.getIntents(); },
    getStats() { return native.getStats(); },
    close() { native.destroy(); },
  };
  if (!records.length) for (const [name, description] of initialRoutes) await controller.addRoute(name, description);
  return controller;
}
export async function createGraphRouterControllers({ agentdb, registry, cwd }) {
  const graphAdapter = await createGraphController({ agentdb, cwd });
  let semanticRouter;
  try {
    semanticRouter = await createSemanticController({ agentdb, cwd });
  } catch (error) {
    await graphAdapter.close();
    throw error;
  }
  registry?.set('graphAdapter', graphAdapter);
  registry?.set('semanticRouter', semanticRouter);
  return { graphAdapter, semanticRouter };
}

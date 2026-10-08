import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGraphController, createSemanticController } from './graph-router.mjs';
import { EmbeddingService } from 'agentdb';
const child = process.argv[2];
if (child?.startsWith('router-')) {
  const embedder = new EmbeddingService({ model: 'Xenova/all-MiniLM-L6-v2', dimension: 384, provider: 'transformers' });
  await embedder.initialize();
  const router = await createSemanticController({ agentdb: { embedder }, cwd: process.argv[3] });
  if (child === 'router-write') await router.addRoute('cross-process', 'Analyze software errors and repair the underlying defect');
  else assert.equal((await router.route('Analyze software errors and repair the underlying defect')).route, 'cross-process');
  router.close();
  console.log(child + ':pass');
  process.exit(0);
}
if (child) {
  const graph = await createGraphController({ agentdb: { embedder: { config: { dimension: 3 } } }, cwd: process.argv[3] });
  if (child === 'write') await graph.createNode({ id: 'durable-node', embedding: new Float32Array([1, 0, 0]), labels: ['Evidence'], properties: { value: 'persisted' } });
  else { const result = await graph.execute('MATCH (n) RETURN n'); assert(result.nodes.some(n => n.id === 'durable-node' && n.properties.value === 'persisted')); }
  console.log(child + ':pass');
  process.exit(0);
}
const directory = mkdtempSync(join(tmpdir(), 'ruflo-graph-router-'));
let corrupt;
try {
for (const action of ['write', 'read']) console.log(execFileSync(process.execPath, [import.meta.filename, action, directory], { encoding: 'utf8' }).trim());
corrupt = mkdtempSync(join(tmpdir(), 'ruflo-corrupt-'));
mkdirSync(join(corrupt, '.swarm'));
const path = join(corrupt, '.swarm/agentdb-graph.db');
writeFileSync(path, 'invalid-existing-graph');
await assert.rejects(createGraphController({ agentdb: {}, cwd: corrupt }));
assert.equal(readFileSync(path, 'utf8'), 'invalid-existing-graph');
console.log('corrupt-existing-graph:rejected-without-rebuild');
await assert.rejects(createSemanticController({ agentdb: { embedder: { config: { provider: 'mock', dimension: 384 }, embedQuery() {}, embedPassage() {} } }, cwd: directory }), /mock\/unavailable/);
console.log('mock-embedding:rejected');
const embedder = new EmbeddingService({ model: 'Xenova/all-MiniLM-L6-v2', dimension: 384, provider: 'transformers' });
await embedder.initialize();
const router = await createSemanticController({ agentdb: { embedder }, cwd: directory });
await router.addRoute('routing-evidence', 'Diagnose a database connection failure and fix the root cause');
const match = await router.route('Diagnose a database connection failure and fix the root cause');
assert.equal(match.route, 'routing-evidence');
assert.equal(match.engine, 'native-semantic');
await assert.rejects(router.route(''), /non-empty/);
router.close();
const restored = await createSemanticController({ agentdb: { embedder }, cwd: directory });
assert.equal((await restored.route('Diagnose a database connection failure and fix the root cause')).route, 'routing-evidence');
restored.close();
console.log('native-semantic:real-embedding-match-and-restored-intents:pass');

for (const action of ['router-write', 'router-read']) console.log(execFileSync(process.execPath, [import.meta.filename, action, directory], { encoding: 'utf8' }).trim());
} finally {
  rmSync(directory, { recursive: true, force: true });
  if (corrupt) rmSync(corrupt, { recursive: true, force: true });
}

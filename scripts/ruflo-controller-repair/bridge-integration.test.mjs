import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const bridge = await import(new URL('./node_modules/@claude-flow/cli/dist/src/memory/memory-bridge.js', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'ruflo-bridge-integration-'));
const prior = process.cwd();
process.chdir(root);
try {
  const registry = await bridge.getControllerRegistry();
  assert.ok(registry, 'Native registry failed');
  for (const name of ['mutationGuard', 'gnnService', 'attestationLog', 'semanticRouter',
    'rvfOptimizer', 'guardedVectorBackend', 'graphAdapter']) assert.ok(registry.get(name), name);
  const result = await bridge.bridgeStoreEntry({key:'bridge-positive', namespace:'integration-test',
    value:'real bridge persistence proof', generateEmbeddingFlag:false});
  assert.equal(result.success, true);
  const rejected = await bridge.bridgeStoreEntry({key:'invalid\x00key', namespace:'integration-test',
    value:'must not be written', generateEmbeddingFlag:false});
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /MutationGuard rejected/);
  const db = registry.getAgentDB().database;
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_entries WHERE key=?').get('invalid\x00key').n, 0);
  const audit = registry.get('attestationLog').query({namespace:'integration-test'});
  assert.ok(audit.some(row => row.operation === 'store' && row.status === 'proved'));
  assert.ok(audit.some(row => row.operation === 'store' && row.status === 'denied'));
  assert.equal(registry.get('attestationLog').count(), audit.length);
  console.log('bridge-integration: 7 real controllers, write proof, rejected invalid write, persisted audit: PASS');
  await bridge.shutdownBridge();
  const broken = join(root, 'broken-workspace');
  mkdirSync(join(broken, '.swarm'), {recursive:true});
  const graph = join(broken, '.swarm/agentdb-graph.db');
  writeFileSync(graph, 'invalid-existing-graph');
  process.chdir(broken);
  await assert.rejects(() => bridge.getControllerRegistry(), error => error.code === 'RUFLO_CONTROLLER_REPAIR_FAILED');
  assert.equal(readFileSync(graph, 'utf8'), 'invalid-existing-graph');
  console.log('bridge-integration: corrupt controller state fails bootstrap without fallback/rebuild: PASS');
} finally {
  await bridge.shutdownBridge();
  process.chdir(prior);
  rmSync(root, {recursive:true, force:true});
}

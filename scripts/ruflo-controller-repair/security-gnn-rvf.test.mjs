import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentDB } from 'agentdb';
import { createRestoredControllers } from './security-gnn-rvf.mjs';
// Native RuVector uses a cwd-relative backing file even for SQLite :memory:.
// Each probe owns its directory so concurrent MCP/tests cannot share its lock.
const previous = process.cwd();
const directory = mkdtempSync(join(tmpdir(), 'ruflo-security-probe-'));
process.chdir(directory);
const agentdb = new AgentDB({ dbPath: ':memory:', vectorDimension: 384, vectorBackend: 'ruvector' });
try {
  await agentdb.initialize();
  const c = await createRestoredControllers({ agentdb, registry: new Map(), cwd: process.cwd() });
  const vector = Float32Array.from({ length: 384 }, (_, i) => .1 + i / 384);
  const token = c.mutationGuard.createToken('probe', 'ruflo', 'write');
  await c.guardedVectorBackend.insert('probe-valid', vector, { purpose: 'real-native-probe' }, token);
  assert.equal((await c.guardedVectorBackend.search(vector, 1))[0].id, 'probe-valid');
  await assert.rejects(() => c.guardedVectorBackend.insert('probe-invalid', new Float32Array(2), {}, token));
  await assert.rejects(() => c.guardedVectorBackend.insert('probe-expired', vector, {}, { ...token, expiresAt: Date.now()-1 }));
  await assert.rejects(() => c.guardedVectorBackend.insert('probe-nan', new Float32Array(384).fill(NaN), {}, token));
  assert.equal(c.attestationLog.getStats().denied, 3);
  assert.equal(c.attestationLog.query({ status: 'proved' }).length, 2);
  const output = c.gnnService.gnn.forward(vector, [], []);
  assert.equal(output.length, 128);
  assert.ok(Array.from(output).every(Number.isFinite));
  assert.throws(() => c.gnnService.gnn.forward(new Float32Array(2), [], []));
  await assert.rejects(() => c.gnnService.classifyIntent('search', new Float32Array(2)));
  const classified = await c.gnnService.classifyIntent('search', vector);
  assert.ok(classified.logits?.length >= 5, 'No silent keyword fallback');
  const compressed = c.rvfOptimizer.zeroCopyCompress4Bit(vector);
  assert.equal(compressed.byteLength, 192);
  const restored = c.rvfOptimizer.quantize4Bit(Array.from(vector));
  assert.ok(restored.metrics.qualityScore > .99);
  assert.ok(c.rvfOptimizer.measureQuality(Array.from(vector), Array(384).fill(0)).mse > 0);
  console.log(JSON.stringify({ verdict: 'pass', proof: c.mutationGuard.getStats(), audit: c.attestationLog.getStats(), gnn: c.gnnService.getStats(), rvf: restored.metrics }));
} finally {
  try { await agentdb.close(); }
  finally { process.chdir(previous); rmSync(directory, { recursive: true, force: true }); }
}

import { MutationGuard } from './copied-agentdb/security-gnn-rvf/security/MutationGuard.js';
import { AttestationLog } from './copied-agentdb/security-gnn-rvf/security/AttestationLog.js';
import { GuardedVectorBackend } from './copied-agentdb/security-gnn-rvf/backends/ruvector/GuardedVectorBackend.js';
import { GNNService } from './copied-agentdb/security-gnn-rvf/services/GNNService.js';
import { RVFOptimizer } from './copied-agentdb/security-gnn-rvf/optimizations/RVFOptimizer.js';

// Keep the official restored implementation unchanged. Adapt its positional
// native calls at the boundary, and reject unavailable native implementations.
export async function createRestoredControllers({ agentdb, registry, cwd }) {
  if (!agentdb.database || !agentdb.vectorBackend) throw new Error('Initialized AgentDB database and vectorBackend required');
  const dimension = agentdb.config?.vectorDimension ?? 384;
  const backend = agentdb.vectorBackend;
  // Match the effective default in alpha20 RuVectorBackend.initialize (line 247).
  const maxElements = backend.config.maxElements || 100000;
  const guard = new MutationGuard({ dimension, maxElements, enableWasmProofs: true, enableAttestationLog: true, defaultNamespace: 'ruflo' });
  await guard.initialize();
  if (!guard.getStats().wasmAvailable) throw new Error('Native/WASM proof engine required');
  const log = new AttestationLog(agentdb.database);
  // Ruflo health consumes count(); AgentDB's official log exposes getStats().
  log.count = () => log.getStats().total;
  const guarded = new GuardedVectorBackend(agentdb.vectorBackend, guard, log);
  // This wrapper borrows AgentDB's backend. Its owner closes the native handle;
  // registering both must not close it twice during registry shutdown.
  guarded.close = undefined;
  // alpha20's sync facade drops native async insert/search promises. Await the
  // real native object here; never pass a Promise into its sync result loop.
  for (const [operation, prove] of [['insert','proveInsert'],['insertBatch','proveBatchInsert'],['search','proveSearch'],['remove','proveRemove'],['save','proveSave'],['load','proveLoad']]) {
    guarded[operation] = async (...args) => {
      const token = args[operation === 'insert' || operation === 'search' ? 3 : 1];
      const countBefore = guard.getVectorCount();
      guarded.requireProof(guard[prove](...args), operation, token);
      try {
        if (operation === 'insert') {
          const [id, vector, metadata] = args;
          const result = await backend.db.insert({ id, vector, metadata });
          if (metadata) backend.metadata.set(id, metadata);
          return result;
        }
        if (operation === 'insertBatch') {
          const results = [];
          for (const item of args[0]) {
            results.push(await backend.db.insert({ id: item.id, vector: item.embedding, metadata: item.metadata }));
            if (item.metadata) backend.metadata.set(item.id, item.metadata);
          }
          return results;
        }
        if (operation === 'search') {
          const [vector, k, options = {}] = args;
          const results = await backend.db.search({ vector, k, threshold: options.threshold, filter: options.filter });
          return results.map(r => ({ ...r, similarity: backend.distanceToSimilarity(r.distance), metadata: backend.metadata.get(r.id) }));
        }
        if (operation === 'remove') {
          const result = await backend.db.delete(args[0]);
          backend.metadata.delete(args[0]); return result;
        }
        return await backend[operation](args[0]);
      } catch (error) {
        guard.setVectorCount(countBefore);
        guarded.wrapBackendError(error, operation, token);
      }
    };
  }
  const gnn = new GNNService({ inputDim: dimension, hiddenDim: 128, layers: 4 });
  await gnn.initialize();
  if (gnn.getStats().engineType !== 'native') throw new Error('Native GNN required');
  const nativeLayer = gnn.gnn;
  gnn.gnn = new Proxy(nativeLayer, { get(target, name) {
    if (name === 'forward') return (node, neighbors = [], weights = []) => {
      if (node.length !== dimension || neighbors.some(v => v.length !== dimension)) throw new RangeError(`GNN input dimension must be ${dimension}`);
      if (![...node, ...neighbors.flatMap(v => Array.from(v)), ...weights].every(Number.isFinite)) throw new TypeError('GNN inputs must be finite');
      return target.forward(Float32Array.from(node), neighbors.map(v => Float32Array.from(v)), Float32Array.from(weights));
    };
    const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const classify = gnn.classifyIntent.bind(gnn);
  gnn.classifyIntent = async (query, embedding) => {
    if (!embedding || embedding.length !== dimension || !Array.from(embedding).every(Number.isFinite))
      throw new RangeError(`GNN classification requires ${dimension} finite values`);
    const result = await classify(query, embedding);
    if (!result.logits?.length) throw new Error('Native GNN inference failed; keyword fallback refused');
    return result;
  };
  const optimizer = new RVFOptimizer();
  const controllers = { mutationGuard: guard, attestationLog: log, guardedVectorBackend: guarded, gnnService: gnn, rvfOptimizer: optimizer };
  if (registry instanceof Map) for (const [name, value] of Object.entries(controllers)) registry.set(name, value);
  return controllers;
}

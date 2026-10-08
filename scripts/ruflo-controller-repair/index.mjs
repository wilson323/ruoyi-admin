import { createHash } from 'node:crypto';
import { createRestoredControllers } from './security-gnn-rvf.mjs';
import { createGraphRouterControllers } from './graph-router.mjs';

export const requiredControllers = ['mutationGuard', 'gnnService', 'attestationLog',
  'semanticRouter', 'rvfOptimizer', 'guardedVectorBackend', 'graphAdapter'];

export async function installControllers(registry, cwd) {
  const agentdb = registry.getAgentDB();
  if (!agentdb) throw new Error('Controller repair requires initialized native AgentDB');
  const instances = new Map();
  await createRestoredControllers({ agentdb, registry: instances, cwd });
  await createGraphRouterControllers({ agentdb, registry: instances, cwd });
  for (const name of requiredControllers) {
    const instance = instances.get(name);
    if (!instance) throw new Error(`Controller initialization incomplete: ${name}`);
    const prior = registry.controllers.get(name);
    await registry.closePriorIfAny(name);
    registry.controllers.set(name, { ...prior, name, instance, enabled: true, error: undefined });
    registry.emit('controller:initialized', { name, level: prior?.level, source: 'verified-controller-repair' });
  }
}

// A key/value write is not a vector insertion. Extend the official proof
// envelope with checks for the actual bridge operation and hash its inputs.
// This validates engineering storage input; project authorization stays in IPD.
export function validateBridgeMutation(registry, operation, params) {
  const guard = registry.get('mutationGuard');
  if (!guard) throw new Error('MutationGuard unavailable');
  const checks = [];
  const reject = (reason) => {
    const denial = { operation, reason, code: 'INVALID_BRIDGE_MUTATION', timestamp: Date.now() };
    registry.get('attestationLog').recordDenial(denial, 'ruflo-engineering', params.namespace ?? 'default');
    return { allowed: false, reason };
  };
  if (!['store', 'delete', 'purge'].includes(operation)) return reject('Unsupported bridge mutation');
  for (const field of operation === 'purge' ? ['namespace'] : ['namespace', 'key']) {
    const value = params[field];
    if (typeof value !== 'string' || !value.length || /[\x00-\x1f\x7f]/.test(value))
      return reject(`${field} must be non-empty text without control characters`);
    checks.push({ check: `${field}_valid`, passed: true });
  }
  if (operation === 'store' && (!Number.isSafeInteger(params.size) || params.size < 0))
    return reject('Invalid storage size');
  const token = guard.createToken('ruflo-engineering', params.namespace, 'write');
  const tokenError = guard.validateToken(token);
  if (tokenError) return reject(tokenError.reason);
  const hash = createHash('sha256').update(JSON.stringify({ operation, params })).digest('hex');
  const proof = guard.buildProof(operation, hash, token, checks);
  return { allowed: proof.valid === true, proof };
}

export function recordBridgeAttestation(registry, operation, entryId, metadata, proof) {
  if (!proof || proof.operation !== operation || proof.valid !== true)
    throw new Error('Bridge write has no matching validation proof');
  const log = registry.get('attestationLog');
  if (!log) throw new Error('AttestationLog unavailable');
  log.record({ ...proof, invariantChecks: [...proof.invariantChecks,
    { check: 'bridge_write_completed', passed: true, entryId, metadata }] });
}

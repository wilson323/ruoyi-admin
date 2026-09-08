/**
 * Shared real-HTTP test infrastructure (Wave 7 / agent A31).
 *
 * This module extracts the pioneer pattern from
 * `apps/web-antd/src/views/ipd/auth/auth-live.test.ts` into a reusable helper
 * so that downstream agents (A32, A33, A34, ...) can convert mock-based
 * business tests into real HTTP loopback tests without re-implementing the
 * transport, the persona fixture loader, or the event log.
 *
 * ## Design contract
 *
 * 1. **Tree-shakeable**: importing this module with `IPD_LIVE_ACCEPTANCE` unset
 *    has zero side effects — no `vi.stubGlobal`, no globalThis mutation, no
 *    socket open. The only module-level value is a lazy empty `liveEvents`
 *    array (no I/O, no listeners).
 *
 * 2. **Security boundary**: `installLiveFetch` THROWS on any path outside the
 *    caller-supplied `endpointAllowlist` BEFORE opening a socket. A
 *    misconfigured test cannot accidentally route an unmocked call to live
 *    infrastructure.
 *
 * 3. **Origin pinned to loopback**: traffic flows only through
 *    `127.0.0.1:15666` (the Vite dev proxy → Java backend at
 *    `127.0.0.1:16039`). Path validation happens BEFORE the network call.
 *
 * 4. **Strict no-dependency**: uses only `node:http`, `node:fs`, plus
 *    globals already provided by Node 18+/happy-dom (`fetch`, `Response`,
 *    `describe`).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { describe } from 'vitest';

const PROXY_BASE = 'http://127.0.0.1:15666';
const REQUEST_TIMEOUT_MS = 5_000;
const FIXTURE_ROOT = '/Users/mac/Documents/ruoyi-ai/.codex/ruflo/swarm-20260905-decisions/frontend/auth/private';

/* ================================================================== *
 *  1. Live-mode gate
 * ================================================================== */

/**
 * True iff `process.env.IPD_LIVE_ACCEPTANCE` is set to any non-empty value.
 * Per the wave-7 governance decision, live tests must be an explicit opt-in:
 * exporting this helper does NOT itself enable live mode. The canonical gate
 * pattern is `describe.skipIf(!liveModeEnabled())` or, for tree-shaken
 * silence, `liveGateDescribe(...)`.
 */
export function liveModeEnabled(): boolean {
  const flag = process.env.IPD_LIVE_ACCEPTANCE;
  return typeof flag === 'string' && flag.length > 0;
}

/**
 * Drop-in replacement for `describe` that silently no-ops when live mode is
 * off. Tests gated this way are NOT enumerated by vitest at all — there is
 * no "skipped" line in the output, matching the intent of
 * `describe.skipIf(!live)` but without polluting the report.
 *
 * Usage:
 *
 *   import { liveGateDescribe, installLiveFetch, ... } from '../_shared/test-helpers/live-http';
 *
 *   liveGateDescribe('real-Java business tests for /auth/me', () => {
 *     it('returns the identity envelope', async () => { ... });
 *   });
 */
export const liveGateDescribe = (name: string, fn: () => void): void => {
  if (!liveModeEnabled()) return;
  describe(name, fn);
};

/* ================================================================== *
 *  2. Persona fixture loader
 * ================================================================== */

export interface PersonaFixture {
  personId: string;
  username: string;
  currentPassword: string;
  phase: 'VERIFIED';
  scope: 'FULL';
  mustChangePwd: false;
}

/**
 * Currently-provisioned personas. The right-hand side encodes the on-disk
 * fixture location and the username the backend is expected to know, so that
 * `loadPersonaFixture` can fail loud if a fixture drifts (wrong username,
 * missing file, wrong mode) before the test reaches the network. Adding a
 * new persona = drop a JSON file at `FIXTURE_ROOT/<slug>.json` and add an
 * entry here.
 */
const PROVISIONED_PERSONAS: Readonly<Record<string, { path: string; expectedUsername: string }>> = Object.freeze({
  '900103': { path: `${FIXTURE_ROOT}/market-current.json`, expectedUsername: 'ipd-market' },
});

/**
 * Load a verified-persona credential fixture. The fixture file must exist,
 * have mode `0o600`, parse as JSON with the expected shape, and match the
 * caller-requested `personId`. Scope and `mustChangePwd` are not stored in
 * the fixture — the `auth-live.test.ts` pioneer explicitly pins these to
 * `FULL` / `false` for the market persona, and that contract is locked in
 * here for all currently-provisioned personas.
 *
 * Throws with an actionable message for any of:
 *   - personId not in `PROVISIONED_PERSONAS` ("not yet provisioned")
 *   - missing file
 *   - wrong file mode (not 0o600)
 *   - JSON parse error
 *   - field drift (wrong personId / username / phase / missing currentPassword)
 */
export function loadPersonaFixture(personId: '900103'): PersonaFixture;
export function loadPersonaFixture(personId: string): PersonaFixture;
export function loadPersonaFixture(personId: string): PersonaFixture {
  const entry = PROVISIONED_PERSONAS[personId];
  if (!entry) {
    const known = Object.keys(PROVISIONED_PERSONAS).join(', ');
    throw new Error(
      `Persona '${personId}' is not yet provisioned for live tests. ` +
      `Currently supported: [${known}]. ` +
      `To enable, drop a JSON fixture at ${FIXTURE_ROOT}/<slug>.json (mode 0o600) ` +
      `and extend PROVISIONED_PERSONAS in apps/web-antd/src/views/ipd/_shared/test-helpers/live-http.ts.`,
    );
  }
  if (!existsSync(entry.path)) {
    throw new Error(`Live persona fixture missing at ${entry.path}. Run the Java-side auth setup script first.`);
  }
  const mode = statSync(entry.path).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`Live persona fixture at ${entry.path} must be mode 0o600 (current is 0o${mode.toString(8)}). Re-run the setup script to fix permissions.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(entry.path, 'utf8'));
  } catch (error) {
    throw new Error(`Live persona fixture at ${entry.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Live persona fixture at ${entry.path} must be a JSON object, got ${typeof parsed}.`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.personId !== personId) {
    throw new Error(`Live persona fixture at ${entry.path} declares personId '${String(obj.personId)}', expected '${personId}'.`);
  }
  if (obj.username !== entry.expectedUsername) {
    throw new Error(`Live persona fixture at ${entry.path} declares username '${String(obj.username)}', expected '${entry.expectedUsername}'.`);
  }
  if (obj.phase !== 'VERIFIED') {
    throw new Error(`Live persona fixture at ${entry.path} declares phase '${String(obj.phase)}', expected 'VERIFIED'.`);
  }
  if (typeof obj.currentPassword !== 'string' || obj.currentPassword.length === 0) {
    throw new Error(`Live persona fixture at ${entry.path} is missing a non-empty 'currentPassword' field.`);
  }
  return {
    personId,
    username: entry.expectedUsername,
    currentPassword: obj.currentPassword,
    phase: 'VERIFIED',
    scope: 'FULL',
    mustChangePwd: false,
  };
}

/* ================================================================== *
 *  3. Network event log + live fetch
 * ================================================================== */

export interface LiveHttpEvent {
  path: string;
  /** HTTP status code returned by the proxy; `0` if the call failed before reaching the server. */
  http: number;
  /** IPD envelope `code` field; `0` if not present (non-JSON body, transport failure). */
  code: number;
  /** True iff the response body carried all five IPD envelope keys: `code`, `message`, `data`, `timestamp`, `traceId`. */
  envelopeComplete: boolean;
  /** ISO-8601 timestamp at which the response (or error) was observed. */
  at: string;
  /** Populated iff the request threw before a Response was produced (transport failure, allowlist rejection, parse error). */
  error?: string;
}

let liveEvents: LiveHttpEvent[] = [];

/**
 * Returns a snapshot of all HTTP events captured since the last `clear`.
 * The returned array is a shallow copy (`slice`) so test assertions cannot
 * accidentally mutate the live log.
 */
export function getLiveHttpEvents(): readonly LiveHttpEvent[] {
  return liveEvents.slice();
}

/** Reset the event log. Tests should call this in `beforeEach` to isolate runs. */
export function clearLiveHttpEvents(): void {
  liveEvents = [];
}

/**
 * Returns a `fetch`-compatible function that:
 *   - Routes the request through `127.0.0.1:15666` (the Vite dev proxy),
 *     preserving the IPD `/api/v1` prefix so the Java backend sees the
 *     same path the framework sees in production.
 *   - THROWS BEFORE opening a socket if `input` is not in
 *     `endpointAllowlist`. This is the security boundary that prevents a
 *     misconfigured test from accidentally routing unmocked calls to live
 *     infrastructure. The error message echoes the allowlist contents.
 *   - Applies a 5 s socket timeout (`req.setTimeout`) so a wedged backend
 *     cannot stall the suite indefinitely.
 *   - Captures a structured event into the module-scoped log so the test
 *     can later assert patterns such as "after login, exactly 1 POST
 *     /auth/login + 1 GET /auth/me was issued".
 *
 * Typical usage:
 *
 *   const liveFetch = installLiveFetch(['/api/v1/auth/login', '/api/v1/auth/me']);
 *   vi.stubGlobal('fetch', liveFetch);
 *   try {
 *     // ... test body ...
 *   } finally {
 *     vi.unstubAllGlobals();
 *     clearLiveHttpEvents();
 *   }
 */
export function installLiveFetch(endpointAllowlist: readonly string[]): typeof fetch {
  const allow = new Set<string>(endpointAllowlist);
  const nativeFetch = (url: string, init?: RequestInit): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const req = httpRequest(
        url,
        { method: init?.method ?? 'GET', headers: init?.headers as Record<string, string> },
        response => {
          const chunks: Buffer[] = [];
          response.on('data', chunk => chunks.push(Buffer.from(chunk)));
          response.on('end', () =>
            resolve(
              new Response(Buffer.concat(chunks).toString('utf8'), {
                status: response.statusCode,
                headers: { 'Content-Type': String(response.headers['content-type'] ?? '') },
              }),
            ),
          );
        },
      );
      req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject);
      if (typeof init?.body === 'string') req.write(init.body);
      req.end();
    });

  const liveFetch: typeof fetch = async (input, init) => {
    const path = String(input);
    if (!allow.has(path)) {
      throw new Error(`Live test refuses endpoint '${path}' — not in allowlist [${[...allow].join(', ')}]`);
    }
    const attempt: LiveHttpEvent = {
      path,
      http: 0,
      code: 0,
      envelopeComplete: false,
      at: new Date().toISOString(),
    };
    try {
      const response = await nativeFetch(`${PROXY_BASE}${path}`, init);
      attempt.http = response.status;
      try {
        const payload = await response.clone().json() as Record<string, unknown>;
        attempt.envelopeComplete = ['code', 'message', 'data', 'timestamp', 'traceId'].every(key => key in payload);
        if (typeof payload.code === 'number') attempt.code = payload.code;
      } catch {
        // Non-JSON or empty body — envelopeComplete stays false.
      }
      liveEvents.push(attempt);
      return response;
    } catch (error) {
      attempt.error = error instanceof Error ? error.name : 'unknown';
      liveEvents.push(attempt);
      throw error;
    }
  };
  return liveFetch;
}
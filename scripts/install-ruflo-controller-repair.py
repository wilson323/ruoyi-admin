#!/usr/bin/env python3
"""Install fingerprinted Ruflo 3.55.0 controller wiring; refuse unknown upstream builds."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import platform
import tarfile
import tomllib

home = Path.home()
source = Path(__file__).resolve().parent / 'ruflo-controller-repair'
destination = home / '.local/share/ruflo/controller-repair'
config = tomllib.loads((home / '.codex/config.toml').read_text())['mcp_servers']['ruflo']
entry = Path(config['args'][0]).resolve()
package = entry.parent.parent
metadata = json.loads((package / 'package.json').read_text())
assert metadata['name'] == 'ruflo' and metadata['version'] == '3.55.0', metadata['version']
dependencies = package / 'node_modules'
expected = {'agentdb': '3.0.0-alpha.20', '@claude-flow/memory': '3.0.1',
            '@ruvector/gnn': '0.1.25', '@ruvector/router': '0.1.32',
            '@ruvector/graph-node': '2.1.1', '@ruvector/graph-transformer': '2.0.4'}
for name, version in expected.items():
    actual = json.loads((dependencies / name / 'package.json').read_text())['version']
    assert actual == version, f'{name} changed to {actual}: review native contracts before applying'
manifest = json.loads((source / 'upstream-sha256.json').read_text())
relative = '@claude-flow/cli/dist/src/memory/memory-bridge.js'
bridge = dependencies / relative
backup = bridge.with_suffix('.js.before-controller-repair')
marker = '// RUFLO_VERIFIED_CONTROLLER_REPAIR_20261008'
current = bridge.read_text()
if marker in current:
    assert backup.exists(), 'Original upstream backup missing'
    original = backup.read_text()
else:
    original = current
assert hashlib.sha256(original.encode()).hexdigest() == manifest[relative], 'Unknown upstream bridge: audit before applying'
official = source / 'copied-agentdb/security-gnn-rvf'
for relative_file, digest in json.loads((official / 'official-sha256.json').read_text()).items():
    assert hashlib.sha256((official / relative_file).read_bytes()).hexdigest() == digest, f'Official implementation changed: {relative_file}'
native = json.loads((source / 'native-dependency.json').read_text())
assert platform.system().lower() == native['platform'] and platform.machine() == native['architecture'], 'Native repair requires macOS ARM64'
native_target = dependencies / native['package']
if not (native_target / 'package.json').exists():
    cache = destination.parent
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / native['archive']
    if not archive.exists():
        subprocess.run(['npm', 'pack', f"{native['package']}@{native['version']}",
                        '--registry=https://registry.npmjs.org', '--silent',
                        '--pack-destination', str(cache)], check=True, capture_output=True)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == native['sha256'], 'Native archive checksum mismatch'
    native_target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as packed:
        for member in packed.getmembers():
            parts = Path(member.name).parts
            assert parts[0] == 'package' and '..' not in parts and not member.issym() and not member.islnk()
            target = native_target.joinpath(*parts[1:])
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(packed.extractfile(member).read())
assert json.loads((native_target / 'package.json').read_text())['version'] == native['version']
destination.mkdir(parents=True, exist_ok=True)
for item in source.iterdir():
    target = destination / item.name
    if item.is_dir():
        shutil.copytree(item, target, dirs_exist_ok=True)
    else:
        shutil.copy2(item, target)
link = destination / 'node_modules'
if not link.exists():
    link.symlink_to(dependencies, target_is_directory=True)
assert link.resolve() == dependencies.resolve(), 'Repair dependency tree differs from Ruflo'

text = original
# The reviewed sidecar is the single owner of these seven controllers. Remove
# the fingerprinted legacy best-effort branch, which silently skipped missing
# files and wrote to the wrong registry instead of maintaining a second path.
legacy_start = text.index('                        // ADR-093 F9: probe multiple router class names')
legacy_end_marker = '                        catch { /* G7 wiring optional */ }\n'
assert text.count(legacy_end_marker) == 1
legacy_end = text.index(legacy_end_marker, legacy_start) + len(legacy_end_marker)
text = text[:legacy_start] + '                        // Seven extension controllers are wired by the verified sidecar below.\n' + text[legacy_end:]
import_line = f"{marker}\nimport {{ installControllers, validateBridgeMutation, recordBridgeAttestation }} from '{(destination / 'index.mjs').as_uri()}';\n"
import_line += "import { mkdirSync as ensureControllerDirectory } from 'node:fs';\n"
text = import_line + text
needle = '                    await registry.initialize({'
assert text.count(needle) == 1
text = text.replace(needle, """                    if (resolvedPath !== ':memory:') {
                        try { ensureControllerDirectory(path.dirname(resolvedPath), { recursive: true, mode: 0o700 }); }
                        catch (error) { error.code = 'RUFLO_CONTROLLER_REPAIR_FAILED'; throw error; }
                    }
""" + needle)
needle = '                registryInstances.set(resolvedPath, registry);'
assert text.count(needle) == 1
text = text.replace(needle, """                try {
                    await installControllers(registry, process.cwd());
                } catch (error) {
                    error.code = 'RUFLO_CONTROLLER_REPAIR_FAILED';
                    throw error;
                }
""" + needle)
needle = '                bridgeFailureReasons.set(resolvedPath, err instanceof Error ? err.message : String(err));'
assert text.count(needle) == 1
text = text.replace(needle, needle + "\n                if (err?.code === 'RUFLO_CONTROLLER_REPAIR_FAILED') throw err;")
start = text.index('async function guardValidate(')
end = text.index('// Tracks db handles', start)
text = text[:start] + """async function guardValidate(registry, operation, params) {
    const result = validateBridgeMutation(registry, operation, params);
    const context = operationContext.getStore();
    if (!context) throw new Error('Mutation validation requires operation context');
    context.controllerMutationProof = result.proof;
    return result;
}
async function logAttestation(registry, operation, entryId, metadata) {
    const proof = operationContext.getStore()?.controllerMutationProof;
    recordBridgeAttestation(registry, operation, entryId, metadata, proof);
}
""" + text[end:]
needle = "guardValidate(registry, 'store', { key, namespace, size: value.length })"
assert text.count(needle) == 1
text = text.replace(needle, "guardValidate(registry, 'store', { key, namespace, size: value.length, contentHash: crypto.createHash('sha256').update(value).digest('hex') })")
if not backup.exists():
    shutil.copy2(bridge, backup)
temporary = bridge.with_name('memory-bridge.repair-tmp.js')
temporary.write_text(text)
subprocess.run([config['command'], '--check', str(temporary)], check=True, capture_output=True)
temporary.replace(bridge)
print(json.dumps({'ruflo': metadata['version'], 'bridge': str(bridge),
                  'repair': str(destination), 'sha256': hashlib.sha256(text.encode()).hexdigest()}, indent=2))

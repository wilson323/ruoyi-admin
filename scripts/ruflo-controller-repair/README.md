# Ruflo controller repair

Runtime remains Ruflo 3.55.0 and AgentDB 3.0.0-alpha.20. Five removed implementations are restored from the official `agentdb@3.0.0-alpha.9` npm archive (SHA-256 `8f6256b8043221729be68867a395b2ee281760913f4c58594fda234b4fb2110a`), with original files verified by `official-sha256.json`. Original package metadata declaring MIT is retained in `copied-agentdb/SOURCE-METADATA.json`; the archive contains no standalone LICENSE file. These are sidecar implementations, not a downgrade of the installed AgentDB package.

The boundary adapters correct constructor contracts, CommonJS export resolution, native async vector calls, GNN typed-array validation, graph persistence, registry metadata, and proof/audit consumer contracts. A key/value bridge proof validates its actual inputs and completed write; it does not claim a vector insertion proof or grant IPD business authority.

Install from the repository with `python3 scripts/install-ruflo-controller-repair.py`. The installer verifies exact upstream versions and the original bridge SHA-256, preserves a backup, verifies restored source hashes, and installs the pinned macOS ARM64 proof dependency if absent. Unknown versions fail instead of receiving an unreviewed patch. Restart existing MCP connections after installation. Run tests from the installed directory so they resolve the same dependency tree as Ruflo:

```sh
node /Users/mac/.local/share/ruflo/controller-repair/security-gnn-rvf.test.mjs
node /Users/mac/.local/share/ruflo/controller-repair/graph-router-test.mjs
node /Users/mac/.local/share/ruflo/controller-repair/bridge-integration.test.mjs
python3 scripts/verify-ruflo.py
```

The current acceptance covers the configured 384-dimensional embedding pipeline, native security/GNN execution, real compression, graph/semantic persistence, and MCP key/value restart persistence. It does not certify every advertised Ruflo tool, authenticated cloud service, model inference, arbitrary vector dimensions, or other pre-existing controllers such as the upstream consolidation stub.

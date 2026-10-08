#!/usr/bin/env python3
"""Verify installed Ruflo over actual stdio MCP, including process restart persistence."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import sqlite3
import threading
import time
import uuid
import tomllib


def payload(result):
    texts = [item['text'] for item in result.get('content', []) if item.get('type') == 'text']
    return json.loads(texts[0]) if texts else result


class Client:
    def __init__(self):
        config = tomllib.loads((Path.home() / '.codex/config.toml').read_text())
        server = config['mcp_servers']['ruflo']
        env = dict(os.environ)
        for key in ('NODE_OPTIONS', 'VSCODE_INSPECTOR_OPTIONS'):
            env.pop(key, None)
        self.process = subprocess.Popen(
            [server['command'], *server.get('args', [])], cwd=Path(__file__).resolve().parents[1],
            env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.messages = queue.Queue()
        self.sequence = 0
        def read():
            for line in self.process.stdout:
                try:
                    self.messages.put(json.loads(line))
                except json.JSONDecodeError:
                    pass
        threading.Thread(target=read, daemon=True).start()
        self.request('initialize', {'protocolVersion': '2024-11-05',
                     'capabilities': {}, 'clientInfo': {'name': 'ipd-ruflo-verifier', 'version': '1'}})
        self.send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})

    def send(self, message):
        self.process.stdin.write(json.dumps(message) + '\n')
        self.process.stdin.flush()

    def request(self, method, params):
        self.sequence += 1
        identifier = self.sequence
        self.send({'jsonrpc': '2.0', 'id': identifier, 'method': method, 'params': params})
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            message = self.messages.get(timeout=max(.01, deadline - time.monotonic()))
            if message.get('id') == identifier:
                if 'error' in message:
                    raise RuntimeError(message['error'])
                return message['result']
        raise TimeoutError(method)

    def call(self, name, arguments):
        result = self.request('tools/call', {'name': name, 'arguments': arguments})
        if result.get('isError'):
            raise RuntimeError(result)
        return result

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def main():
    namespace = 'installation-verification'
    key = 'smoke-' + uuid.uuid4().hex
    value = 'restart-persistence-' + uuid.uuid4().hex
    report = {}
    client = Client()
    try:
        tools = client.request('tools/list', {})['tools']
        names = {tool['name'] for tool in tools}
        required = {'memory_store', 'memory_retrieve', 'memory_delete', 'swarm_init',
                    'swarm_status', 'agentdb_health', 'aidefence_scan'}
        assert required <= names, required - names
        report['advertised_tools'] = len(tools)
        report['system'] = client.call('system_info', {})
        report['controllers'] = client.call('agentdb_health', {})
        controllers = payload(report['controllers'])
        required_controllers = {'mutationGuard', 'gnnService', 'attestationLog', 'semanticRouter',
                                'rvfOptimizer', 'guardedVectorBackend', 'graphAdapter'}
        active = {item['name'] for item in controllers['controllers'] if item['enabled']}
        assert required_controllers <= active, required_controllers - active
        report['extension_controllers'] = '7/7 ACTIVE'
        report['security'] = client.call('aidefence_scan', {'input': 'Ruflo installation smoke test'})
        client.call('memory_store', {'namespace': namespace, 'key': key, 'value': value,
                                    'provenance_type': 'tool_result'})
        health = payload(client.call('agentdb_health', {}))
        assert health['attestationCount'] > controllers['attestationCount'], 'MCP write did not produce an attestation'
        database = Path(__file__).resolve().parents[1] / '.swarm/agentdb-memory.db'
        with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
            rows = connection.execute(
                "SELECT id, metadata FROM mutation_attestations WHERE namespace=? AND operation='store' AND status='proved'",
                (namespace,)).fetchall()
        matching = [identifier for identifier, metadata in rows
                    if any(check.get('metadata', {}).get('key') == key
                           for check in json.loads(metadata)['invariantChecks'])]
        assert matching, 'The specific MCP write has no persisted audit row'
        report['mcp_write_attestation'] = 'PASS'
        report['mcp_write_audit_row'] = matching[-1]
        assert 'agentdb_semantic-route' in names, 'Semantic route tool missing'
        routed = payload(client.call('agentdb_semantic-route', {'input': 'Write and run tests to verify application behavior'}))
        assert routed['controller'] == 'semanticRouter' and routed['route']['engine'] == 'native-semantic', routed
        report['native_semantic_route'] = routed
    finally:
        if sys.exc_info()[0] is not None:
            client.call('memory_delete', {'namespace': namespace, 'key': key})
        client.close()
    client = Client()
    try:
        result = client.call('memory_retrieve', {'namespace': namespace, 'key': key})
        assert value in json.dumps(result), 'Value did not survive MCP process restart'
        report['restart_persistence'] = 'PASS'
        client.call('memory_delete', {'namespace': namespace, 'key': key})
        report['test_entry_cleanup'] = 'PASS'
    finally:
        try:
            if sys.exc_info()[0] is not None:
                client.call('memory_delete', {'namespace': namespace, 'key': key})
        finally:
            client.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

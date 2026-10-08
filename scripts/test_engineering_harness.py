#!/usr/bin/env python3
"""Independent fixture regression; no real project build, database or network."""
import contextlib
import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('engineering_harness', Path(__file__).with_name('engineering_harness.py'))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
BACKEND_ROOT = None
INTEGRATION_CASES = ('test_C36_gate_missing_script_refused',
                     'test_C37_gate_legal_failure_history_allowed',
                     'test_C38_gate_invalid_failure_history_refused')

class HarnessCases(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ipd-harness-fixture-')
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        self.cmd('init', '-q')
        (self.root / 'README-IPD.md').write_text('fixture')
        (self.root / 'apps/web-antd').mkdir(parents=True)
        (self.root / 'input.txt').write_text('initial')
        self.cmd('add', '.')
        self.cmd('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
        self.addCleanup(self.temp.cleanup)
        registry = 'CASE-1 OTHER CASE-EMPTY CASE-FE CASE-ZERO CASE-MISSING'
        self.registry_patch = patch.object(h, 'task_registry', return_value=registry)
        self.registry_patch.start(); self.addCleanup(self.registry_patch.stop)
        self.authority = Path(self.temp.name) / 'existing-master'
        self.authority.write_text('fixture authority')
        p = patch.object(h, 'authority_paths', return_value=[self.authority])
        p.start(); self.addCleanup(p.stop)
    def cmd(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')})
    def foreign_git(self, repo, *args):
        return subprocess.check_output(['git', '-C', str(repo), *args], env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')})
    def execute(self, code, timeout=3):
        return h.execute(self.root, [sys.executable, '-c', code], self.root / '.harness/runs/raw.log', timeout)
    def run_receipt(self, code="print('actual execution')", profile='governance', task='CASE-1'):
        steps=[('fixture', [sys.executable, '-c', code], 3)]
        with patch.object(h, 'profiles', return_value=steps), contextlib.redirect_stdout(io.StringIO()):
            r=h.verify(self.root, profile, task)
        return r, self.root / '.harness/runs' / r['run_id'] / 'receipt.json', steps
    def check(self, path, steps):
        with patch.object(h, 'profiles', return_value=steps):
            return h.checked_receipt(self.root, path)
    def test_C01_real_nonzero_even_PASS(self):
        s=self.execute("print('PASS'); raise SystemExit(1)")
        self.assertEqual((s['exit_code'], s['reason']), (1, 'PROCESS_FAILED'))
    def test_C02_zero_empty_refused(self):
        self.assertEqual(self.execute('pass')['reason'], 'EMPTY_EVIDENCE')
    def test_C03_missing_executable(self):
        s=h.execute(self.root, [str(self.root/'missing')], self.root/'.harness/runs/raw.log', 1)
        self.assertEqual(s['reason'], 'MISSING_TOOL')
    def test_C04_timeout_child_cleanup(self):
        code="import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); print(p.pid,flush=True); time.sleep(30)"
        s=self.execute(code, .2)
        self.assertEqual(s['reason'],'TIMEOUT')
        pid=int(Path(s['log']).read_text().strip())
        for _ in range(30):
            state=subprocess.run(['ps','-o','stat=','-p',str(pid)],capture_output=True,text=True).stdout.strip()
            if not state or state.startswith('Z'): break
            time.sleep(.02)
        self.assertTrue(not state or state.startswith('Z'),state)
    def test_C05_dirty_delete_snapshot(self):
        a=h.snapshot(self.root)
        (self.root/'input.txt').write_text('changed')
        b=h.snapshot(self.root)
        (self.root/'input.txt').unlink()
        c=h.snapshot(self.root)
        self.assertEqual(len({x['input_hash'] for x in (a,b,c)}),3)
    def test_C06_leaf_symlink_external_not_read(self):
        out=Path(self.temp.name)/'outside';out.write_text('private')
        (self.root/'link').symlink_to(out)
        a=h.snapshot(self.root);out.write_text('other private')
        self.assertEqual(a,h.snapshot(self.root))
    def test_C07_parent_symlink_external_not_read(self):
        d=self.root/'tracked';d.mkdir();(d/'file').write_text('original');self.cmd('add','tracked/file')
        (d/'file').unlink();d.rmdir()
        out=Path(self.temp.name)/'external';out.mkdir();(out/'file').write_text('private')
        d.symlink_to(out,target_is_directory=True)
        try:a=h.snapshot(self.root)
        except h.HarnessError:return
        (out/'file').write_text('different private')
        self.assertEqual(a,h.snapshot(self.root),'snapshot dereferenced external parent')
    def test_C08_git_environment_clean(self):
        with patch.dict(os.environ, {'GIT_DIR':'/missing','GIT_WORK_TREE':'/missing','GIT_INDEX_FILE':'/missing'}):
            self.assertEqual(h.project(self.root),'ipd-frontend')
            s=self.execute("import os; print('clean' if not any(k.startswith('GIT_') for k in os.environ) else 'polluted')")
        self.assertEqual(Path(s['log']).read_text().strip(),'clean')
    def test_C09_input_drift(self):
        r,_,_=self.run_receipt("from pathlib import Path; Path('input.txt').write_text('changed'); print('PASS')")
        self.assertEqual(r['status'],'STALE_INPUT')
    def test_C10_missing_artifact(self):
        r,_,_=self.run_receipt(profile='frontend')
        self.assertEqual(r['status'],'FAILED')
    def test_C11_nonempty_vitest(self):
        p=self.root/'report.json'
        for n in (0,1):
            p.write_text(json.dumps({'success':True,'numTotalTests':n,'numPassedTests':n,'numFailedTests':0,'numFailedTestSuites':0,'testResults':[] if n==0 else [{'status':'passed'}]}))
            self.assertEqual(h.validate_vitest(p),n==1)
    def test_C12_crossroot_receipt(self):
        _,p,steps=self.run_receipt();r=json.loads(p.read_text());r['root']='/wrong';p.write_text(json.dumps(r))
        with self.assertRaises(h.HarnessError):self.check(p,steps)
    def test_C13_missing_step(self):
        _,p,steps=self.run_receipt();r=json.loads(p.read_text());r['steps']=[];p.write_text(json.dumps(r))
        with self.assertRaises(h.HarnessError):self.check(p,steps)
    def test_C14_modified_log(self):
        r,p,steps=self.run_receipt();Path(r['steps'][0]['log']).write_text('edited')
        with self.assertRaises(h.HarnessError):self.check(p,steps)
    def test_C15_stale_receipt(self):
        _,p,steps=self.run_receipt();(self.root/'input.txt').write_text('after')
        with self.assertRaises(h.HarnessError):self.check(p,steps)
    def test_C16_same_common_git_lock(self):
        wt=Path(self.temp.name)/'worktree';self.cmd('worktree','add','--detach',str(wt),'HEAD')
        with h.lease(self.root):
            with self.assertRaises(h.HarnessError):
                with h.lease(wt):pass
        with h.lease(wt):pass
    def test_C17_wrong_profile_and_subroot(self):
        with self.assertRaises(h.HarnessError):h.profiles(self.root,'backend',self.root/'runs')
        with self.assertRaises(h.HarnessError):h.project(self.root/'apps')
    def test_C18_reflection_unconfirmed(self):
        r,_,_=self.run_receipt("print('PASS');raise SystemExit(1)")
        packet=json.loads((self.root/'.harness/evolve'/f"{r['run_id']}.json").read_text())
        self.assertEqual(packet['root_cause'],'UNCONFIRMED');self.assertFalse(packet['automatic_model_reflection'])
    def test_C19_learn_fixed_check_after_real_pass(self):
        f,fp,steps=self.run_receipt("print('PASS');raise SystemExit(1)")
        p,pp,_=self.run_receipt()
        with patch.object(h,'profiles',return_value=steps):lesson=h.learn(self.root,fp,pp)
        self.assertEqual(lesson['checks'],['PROCESS_FAILED']);self.assertEqual(lesson['root_cause'],'UNCONFIRMED')
    def test_C20_learn_different_task_rejected(self):
        _,fp,steps=self.run_receipt("print('failure');raise SystemExit(1)")
        _,pp,_=self.run_receipt(task='OTHER')
        with patch.object(h,'profiles',return_value=steps),self.assertRaises(h.HarnessError):h.learn(self.root,fp,pp)
    def test_C21_learn_pass_before_failure_rejected(self):
        _,pp,steps=self.run_receipt();_,fp,_=self.run_receipt("print('failure');raise SystemExit(1)")
        with patch.object(h,'profiles',return_value=steps),self.assertRaises(h.HarnessError):h.learn(self.root,fp,pp)
    def test_C22_invalid_arbitrary_rule_rejected(self):
        h.write_json(self.root/'.harness/evolve/learned-forged.json',{'schema':1,'checks':['RUN_ANY_SHELL']})
        with self.assertRaises(h.HarnessError):h.intake(self.root)
    def test_C23_empty_profile_refused(self):
        with patch.object(h,'profiles',return_value=[]),contextlib.redirect_stdout(io.StringIO()):
            try:r=h.verify(self.root,'governance','CASE-EMPTY')
            except h.HarnessError:return
        self.assertNotEqual(r['status'],'PASSED')
    def test_C24_forged_learned_registry_refused(self):
        h.write_json(self.root/'.harness/evolve/learned-forged.json',{'schema':1,'checks':['PROCESS_FAILED']})
        with self.assertRaises(h.HarnessError):h.intake(self.root)
    def test_C25_old_verifier_refused(self):
        _,p,steps=self.run_receipt();r=json.loads(p.read_text());r['harness_version']='obsolete';p.write_text(json.dumps(r))
        with self.assertRaises(h.HarnessError):self.check(p,steps)
    def test_C26_changed_validator_hash_refused(self):
        _,p,steps=self.run_receipt();r=json.loads(p.read_text());r['validator_hash']='obsolete';p.write_text(json.dumps(r))
        with self.assertRaises(h.HarnessError):self.check(p,steps)
    def test_C27_same_task_different_profile_refused(self):
        _,fp,steps=self.run_receipt("print('failed');raise SystemExit(1)")
        _,pp,_=self.run_receipt();r=json.loads(pp.read_text());r['profile']='other';pp.write_text(json.dumps(r))
        with patch.object(h,'profiles',return_value=steps),self.assertRaises(h.HarnessError):h.learn(self.root,fp,pp)
    def test_C28_redacts_sensitive_log(self):
        s=self.execute("print('password=fixture-private token=fixture-token')")
        text=Path(s['log']).read_text()
        self.assertNotIn('fixture-private',text);self.assertNotIn('fixture-token',text)
    def test_C29_diagnostic_exit_zero_refused(self):
        r,_,_=self.run_receipt("print('error TS1234: compiler global error')")
        self.assertEqual(r['status'],'FAILED');self.assertEqual(r['steps'][0]['reason'],'DIAGNOSTICS')
    def test_C30_auto_learning_after_success(self):
        f,_,_=self.run_receipt("print('failed');raise SystemExit(1)")
        p,_,steps=self.run_receipt()
        self.assertIn(f['run_id'],p['learned_from'])
        with patch.object(h,'profiles',return_value=steps):
            self.assertEqual(h.intake(self.root)['checks'][0]['id'],'PROCESS_FAILED')
    def test_C31_frontend_actual_report_and_artifact(self):
        (self.root/'.gitignore').write_text('apps/web-antd/dist/\n')
        def fixture_profile(root,profile,run_dir):
            report={'success':True,'numTotalTests':1,'numPassedTests':1,'numFailedTests':0,'numFailedTestSuites':0,'testResults':[{'status':'passed'}]}
            testcode=f"from pathlib import Path; Path({str(run_dir/'vitest.json')!r}).write_text({json.dumps(report)!r}); print('1 actual test passed')"
            buildcode="from pathlib import Path; p=Path('apps/web-antd/dist');p.mkdir(parents=True,exist_ok=True);(p/'index.html').write_text('<html>fixture</html>');(p/'app.js').write_text('fixture');print('build produced files')"
            return [('vitest',[sys.executable,'-c',testcode],3),('build',[sys.executable,'-c',buildcode],3)]
        with patch.object(h,'profiles',side_effect=fixture_profile),contextlib.redirect_stdout(io.StringIO()):
            r=h.verify(self.root,'frontend','CASE-FE')
            self.assertEqual(r['status'],'PASSED')
            p=self.root/'.harness/runs'/r['run_id']/'receipt.json'
            h.checked_receipt(self.root,p)
    def test_C32_artifact_external_link_refused(self):
        d=self.root/'apps/web-antd/dist';d.mkdir();(d/'index.html').write_text('fixture')
        out=Path(self.temp.name)/'private';out.write_text('private')
        (d/'app.js').symlink_to(out)
        with self.assertRaises(h.HarnessError):h.artifact(self.root)
    def test_C33_harness_zero_tests_refused(self):
        steps=[('harness-regression',[sys.executable,'-c',"print('Ran 0 tests\\nOK')"],3)]
        with patch.object(h,'profiles',return_value=steps),contextlib.redirect_stdout(io.StringIO()):
            r=h.verify(self.root,'governance','CASE-ZERO')
        self.assertEqual(r['status'],'FAILED');self.assertEqual(r['steps'][0]['reason'],'EMPTY_EVIDENCE')
    def test_C34_typecheck_zero_tests_refused(self):
        steps=[('typecheck-regression',[sys.executable,'-c',"print('# tests 0\\n# pass 0')"],3)]
        with patch.object(h,'profiles',return_value=steps),contextlib.redirect_stdout(io.StringIO()):
            r=h.verify(self.root,'governance','CASE-ZERO')
        self.assertEqual(r['status'],'FAILED');self.assertEqual(r['steps'][0]['reason'],'EMPTY_EVIDENCE')
    def test_C35_missing_dependencies_receipt_and_reflection(self):
        with contextlib.redirect_stdout(io.StringIO()):r=h.verify(self.root,'frontend','CASE-MISSING')
        self.assertEqual(r['status'],'FAILED');self.assertEqual(r['steps'][0]['id'],'preflight')
        self.assertTrue((self.root/'.harness/runs'/r['run_id']/'receipt.json').is_file())
        self.assertEqual(json.loads((self.root/'.harness/evolve'/f"{r['run_id']}.json").read_text())['root_cause'],'UNCONFIRMED')
    def gate_fixture(self, key):
        source=BACKEND_ROOT/'.harness/gate.sh'
        target=self.root/'.harness/gate.sh';target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(source.read_bytes())
        return subprocess.run(['bash',str(target),'--gate='+key],cwd=self.root,capture_output=True,text=True)
    def test_C36_gate_missing_script_refused(self):
        r=self.gate_fixture('drift_1');self.assertNotEqual(r.returncode,0);self.assertIn('FAIL=1',r.stdout)
    def test_C37_gate_legal_failure_history_allowed(self):
        p=self.root/'.harness/evolve/failures.jsonl';p.parent.mkdir(parents=True);p.write_text('{"exit":1,"stage":"fixture"}\n')
        r=self.gate_fixture('failurehistory_7');self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        self.assertIn('failure history records: 1',r.stdout)
    def test_C38_gate_invalid_failure_history_refused(self):
        p=self.root/'.harness/evolve/failures.jsonl';p.parent.mkdir(parents=True);p.write_text('invalid JSON\n')
        r=self.gate_fixture('failurehistory_7');self.assertNotEqual(r.returncode,0)
    def test_C39_snapshot_manifest_matches_receipt(self):
        r,p,steps=self.run_receipt()
        for stage in ('before','after'):
            manifest=json.loads((p.parent/(stage+'-inputs.json')).read_text())
            self.assertTrue(manifest)
        self.check(p,steps)
    def test_C40_modified_input_manifest_refused(self):
        _,p,steps=self.run_receipt()
        manifest=p.parent/'before-inputs.json'
        data=json.loads(manifest.read_text());data['files']=[['invented.txt','forged']]
        manifest.write_text(json.dumps(data))
        with self.assertRaises(h.HarnessError):self.check(p,steps)
    def test_C41_history_validator_mismatch_refused(self):
        # This case corrupts an already learned history, not a verifier change
        # during execution. Freeze the fixture's verifier identity so concurrent
        # edits in the real checkout cannot prevent the learning prerequisite.
        verifier = h.validator_hash(self.root)
        with patch.object(h, 'validator_hash', return_value=verifier):
            failed, path, steps = self.run_receipt("print('failed');raise SystemExit(1)")
            passed, _, _ = self.run_receipt()
            self.assertEqual(passed['status'], 'PASSED')
            self.assertIn(failed['run_id'], passed['learned_from'])
            self.assertTrue((self.root / '.harness/evolve' / f"learned-{failed['run_id']}.json").is_file())
            data = json.loads(path.read_text())
            data['validator_hash'] = 'different-verifier'
            path.write_text(json.dumps(data))
            with patch.object(h, 'profiles', return_value=steps), self.assertRaisesRegex(h.HarnessError, 'Learning is not supported by its evidence'):
                h.intake(self.root)

    def test_C42_invented_task_refused_before_execution(self):
        with patch.object(h, 'execute') as execute, self.assertRaises(h.HarnessError):
            h.verify(self.root, 'governance', 'MADE-UP-NO-CARD')
        execute.assert_not_called()

    def test_C43_task_substring_is_not_registration(self):
        with patch.object(h, 'task_registry', return_value='CASE-10'), self.assertRaises(h.HarnessError):
            h.validate_task(self.root, 'CASE-1')
        h.validate_task(self.root, 'CASE-1')

    def test_C44_external_authority_change_invalidates_receipt(self):
        _, path, steps = self.run_receipt()
        self.authority.write_text('scope changed after verification')
        with self.assertRaises(h.HarnessError): self.check(path, steps)

    def test_C45_external_authority_change_during_execution_refused(self):
        code = f"from pathlib import Path; Path({str(self.authority)!r}).write_text('changed'); print('PASS')"
        receipt, _, _ = self.run_receipt(code)
        self.assertEqual(receipt['status'], 'STALE_INPUT')

    def test_C46_canvas_entrypoints_share_contract(self):
        path = Path(__file__).resolve().parents[1] / '.cursor/hooks/check-execution-cut.py'
        valid = 'const CUT_STATE = "OPEN"; const CUT_ACTION = "repair";'
        invalid = valid + ' const CUT_UNBLOCK = "other authority";'
        for text, expected in ((valid, 0), (invalid, 2), ('const CUT_STATE = "CLOSED";', 2)):
            result = subprocess.run([sys.executable, str(path), '--stdin-text'], input=text, text=True, capture_output=True)
            self.assertEqual(result.returncode, expected, result.stderr)

    def test_C47_canvas_malformed_payload_refused(self):
        path = Path(__file__).resolve().parents[1] / '.cursor/hooks/check-execution-cut.py'
        for raw in ('invalid-json', '[]'):
            result = subprocess.run([sys.executable, str(path)], input=raw, text=True, capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(result.stdout)['permission'], 'deny')

    def test_C48_completion_current_task_profile_allowed(self):
        _, path, steps = self.run_receipt()
        with patch.object(h, 'profiles', return_value=steps):
            result = h.checked_receipt(self.root, path, expected_task='CASE-1', expected_profile='governance')
        self.assertEqual(result['status'], 'PASSED')

    def test_C49_completion_other_task_pass_refused(self):
        _, path, steps = self.run_receipt()
        with patch.object(h, 'profiles', return_value=steps), self.assertRaisesRegex(h.HarnessError, 'different task'):
            h.checked_receipt(self.root, path, expected_task='OTHER', expected_profile='governance')

    def test_C50_completion_other_profile_pass_refused(self):
        _, path, steps = self.run_receipt()
        with patch.object(h, 'profiles', return_value=steps), self.assertRaisesRegex(h.HarnessError, 'different verification profile'):
            h.checked_receipt(self.root, path, expected_task='CASE-1', expected_profile='frontend')

    def test_C51_completion_matching_identity_still_checks_freshness(self):
        _, path, steps = self.run_receipt()
        (self.root / 'input.txt').write_text('changed after validation')
        with patch.object(h, 'profiles', return_value=steps), self.assertRaisesRegex(h.HarnessError, 'inputs have changed'):
            h.checked_receipt(self.root, path, expected_task='CASE-1', expected_profile='governance')

    def test_C53_governance_includes_evidence_chain(self):
        steps = h.profiles(self.root, 'governance', self.root / '.harness/runs/test')
        matches = [argv for name, argv, _ in steps if name == 'engineering-evidence']
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0][0], 'bash')
        self.assertTrue(matches[0][1].endswith('/scripts/check-engineering-evidence.sh'))

    def test_C54_evidence_validator_change_invalidates_identity(self):
        backend = Path(self.temp.name) / 'backend'
        target = backend / 'scripts/check-engineering-evidence.sh'
        target.parent.mkdir(parents=True)
        target.write_text('first')
        with patch.object(h, 'project', return_value='ipd-backend'):
            original = h.validator_hash(backend)
            target.write_text('changed')
            self.assertNotEqual(original, h.validator_hash(backend))

    def test_C59_foreign_uncommitted_validator_edit_does_not_invalidate(self):
        backend = Path(self.temp.name) / 'foreign'
        (backend / 'scripts').mkdir(parents=True)
        target = backend / 'scripts/check-engineering-evidence.sh'
        target.write_text('committed')
        self.foreign_git(backend, 'init', '-q')
        self.foreign_git(backend, 'add', '-A')
        self.foreign_git(backend, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                         'commit', '-qm', 'foreign')
        with patch.object(h, 'project', return_value='ipd-backend'):
            before = h.validator_hash(backend)
            target.write_text('dirty sibling edit')
            self.assertEqual(before, h.validator_hash(backend),
                             'uncommitted edit in another repository must not decide this verification')
            self.foreign_git(backend, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                             'commit', '-qam', 'foreign')
            self.assertNotEqual(before, h.validator_hash(backend),
                                'a committed foreign validator change must still invalidate identity')

    def test_C60_foreign_untracked_validator_still_fingerprinted(self):
        backend = Path(self.temp.name) / 'foreign-untracked'
        (backend / 'scripts').mkdir(parents=True)
        target = backend / 'scripts/check-engineering-evidence.sh'
        target.write_text('first')
        self.foreign_git(backend, 'init', '-q')
        with patch.object(h, 'project', return_value='ipd-backend'):
            before = h.validator_hash(backend)
            target.write_text('changed')
            self.assertNotEqual(before, h.validator_hash(backend),
                                'an untracked foreign validator must still be read from the working tree')

    def test_C52_completion_cli_forwards_current_identity(self):
        path = self.root / '.harness/runs/example/receipt.json'
        argv = ['engineering_harness.py', '--root', str(self.root), 'check', '--receipt', str(path), '--task', 'CASE-1', '--profile', 'frontend']
        with patch.object(sys, 'argv', argv), patch.object(h, 'checked_receipt', return_value={}) as check, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(h.main(), 0)
        check.assert_called_once_with(self.root.resolve(), path, expected_task='CASE-1', expected_profile='frontend')

    def test_C55_evolved_profile_history_stale_not_enabled(self):
        verifier = h.validator_hash(self.root)
        with patch.object(h, 'validator_hash', return_value=verifier):
            failed, _, steps = self.run_receipt("print('failed');raise SystemExit(1)")
            passed, _, _ = self.run_receipt()
            self.assertIn(failed['run_id'], passed['learned_from'])
        evolved = steps + [('new-required-check', ['fixture'], 3)]
        with patch.object(h, 'validator_hash', return_value='evolved-verifier'), patch.object(h, 'profiles', return_value=evolved):
            result = h.intake(self.root)
        self.assertEqual(result['stale_learning'], [failed['run_id']])
        self.assertEqual(result['checks'], [])

    def test_C56_evolved_history_modified_log_still_refused(self):
        receipt, path, steps = self.run_receipt()
        Path(receipt['steps'][0]['log']).write_text('tampered historical log')
        with patch.object(h, 'validator_hash', return_value='evolved-verifier'), patch.object(h, 'profiles', return_value=steps + [('new', ['fixture'], 3)]), self.assertRaisesRegex(h.HarnessError, 'Evidence missing or modified'):
            h.checked_receipt(self.root, path, fresh=False)

    def test_C57_evolved_history_not_current_completion(self):
        _, path, steps = self.run_receipt()
        with patch.object(h, 'validator_hash', return_value='evolved-verifier'), patch.object(h, 'profiles', return_value=steps + [('new', ['fixture'], 3)]), self.assertRaisesRegex(h.HarnessError, 'inputs have changed'):
            h.checked_receipt(self.root, path, expected_task='CASE-1', expected_profile='governance')

    def test_C58_same_verifier_historical_missing_steps_refused(self):
        _, path, steps = self.run_receipt()
        with patch.object(h, 'profiles', return_value=steps + [('required', ['fixture'], 3)]), self.assertRaisesRegex(h.HarnessError, 'Required checks missing or reordered'):
            h.checked_receipt(self.root, path, fresh=False)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend-root',type=Path)
    args=parser.parse_args()
    if args.backend_root is not None:
        BACKEND_ROOT=args.backend_root.resolve()
        if not (BACKEND_ROOT/'.harness/gate.sh').is_file():
            parser.error('Explicit backend root must contain the real .harness/gate.sh')
        print('Scope: core 55 cases + explicit backend adapter integration 3 cases; isolated fixtures only',flush=True)
    else:
        print('Scope: core 55 cases only; backend adapter integration was not selected',flush=True)
    names=unittest.defaultTestLoader.getTestCaseNames(HarnessCases)
    suite=unittest.TestSuite(HarnessCases(name) for name in names
                            if BACKEND_ROOT is not None or name not in INTEGRATION_CASES)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)

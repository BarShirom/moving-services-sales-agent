"""Offline completion integration: no sockets, subprocesses or real host calls."""
from contextlib import redirect_stdout
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.request

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location('offline_completion_' + name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


M = load('complete_release')
C = load('historical_capture')
COLLECTOR_SHA = M.sha((HERE / 'historical_capture.py').read_bytes())
PREVIOUS_SHA = 'a' * 64
CANDIDATE_SHA = 'b' * 64
IMAGE = 'registry.invalid/server@sha256:' + 'c' * 64
CONTEXT = 'd' * 64
MARKER = 'result=module.update(ports,previous,PREVIOUS_SHA,candidate,CANDIDATE_SHA,modules)'


class CompletionTests(unittest.TestCase):
    def setUp(self):
        for owner, name in ((socket, 'socket'), (socket, 'create_connection'),
                            (subprocess, 'run'), (subprocess, 'Popen'), (urllib.request.OpenerDirector, 'open')):
            self.enterContext(patch.object(owner, name, side_effect=AssertionError('external I/O forbidden in offline tests')))
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.out = self.root / 'out'
        self.revision = self.root / 'r5'
        self.out.mkdir()
        self.revision.mkdir()
        self.receipts = self.out / M.ATTEMPT
        self.receipts.mkdir()
        self.before = {
            'result': 'PASS_CURRENT_UPDATE_PREFLIGHT', 'remoteExitCode': 0,
            'identityVerification': {'verifiedAt': datetime.now(timezone.utc).isoformat()},
            'backend': {'id': 'e' * 64, 'image': IMAGE, 'running': True, 'health': 'healthy'},
            'accounting': {'attempts': 1, 'reservedUnits': 31169, 'reservedMicros': 17849,
                           'journalBytes': 100, 'journalSha256': 'f' * 64},
            'caddy': {'id': 'stable-caddy'}, 'historicalAccounting': {'holds': 1},
            'credentialSources': ['existing-protected-source'], 'statePath': '/existing-ledger',
        }
        self.previous = {'beta': {'operatorPath': '/opt/moving-demo/operator'}}
        self.candidate = {'sourceCommit': M.SOURCE, 'image': {'oci': 'sha256:' + 'c' * 64}}
        self.control = SimpleNamespace(
            INSTALL='assert type(READBACK) is bool\n', LOAD='import json\noldpath=MANIFEST_PATH\n',
            EVIDENCE='pass\n',
            INSPECT="runtime={}\nprint(json.dumps({'result':'PASS_CURRENT_UPDATE_PREFLIGHT','backend':runtime}))\n")
        self.host = SimpleNamespace(
            OUT=self.out, REVISION=self.revision, PREVIOUS_SHA=PREVIOUS_SHA,
            PINS={'coordinator': ('coordinator.py', '1' * 64)},
            prepared_inputs=lambda: (self.previous, self.candidate, CANDIDATE_SHA),
            previous_manifest=lambda: self.previous, frozen=lambda _name: self.control,
            read=lambda path: json.loads(Path(path).read_bytes()), save=self.save,
            checked_pull_packet=Mock(return_value=({}, None, None)),
            runtime_prelude=lambda candidate=True: 'import json\n',
            inspect_program=Mock(return_value='pass\n'),
            update_program=lambda _digest: 'import json,sys\n' + MARKER + '\nprint(json.dumps(result))\nraise SystemExit(0 if result["result"].startswith("PASS_") else 1)\n',
            remote=Mock(side_effect=AssertionError('unconfigured host call')),
        )
        self.save(self.out / 'production-before-collector-fix.json', self.before)
        self.save(self.receipts / 'confirm.json', self.before)
        self.save(self.receipts / 'readback.json', {
            'result': 'PASS_UPDATE_CONTROL_INDEPENDENT_READBACK', 'remoteExitCode': 0, 'target': M.TARGET,
            'files': {'historical_capture.' + COLLECTOR_SHA + '.py': COLLECTOR_SHA}})
        self.save(self.receipts / 'history-preflight.json', {
            'result': 'PASS_BOUNDED_HISTORY_PREFLIGHT', 'remoteExitCode': 0,
            'history': {'transportComplete': True}, 'sourceCommit': M.SOURCE, 'collectorSha256': COLLECTOR_SHA})
        self.save(self.revision / 'local-image-identity.json', {'contextSha256': CONTEXT})
        self.success = {'result': 'PASS_BOUNDED_BETA_ARTIFACT_UPDATED', 'remoteExitCode': 0,
                        'previousManifestSha256': PREVIOUS_SHA, 'candidateManifestSha256': CANDIDATE_SHA}
        names = ('previousAttach', 'accountingReceipt', 'diagnosticReceipt', 'candidateAttach', 'readyReceipt')
        records = {name: {'path': '/opt/moving-demo/operator/evidence/artifact-update-fixture.' + name + '.json',
                          'sha256': 'sha256:' + '2' * 64} for name in names}
        self.success.update(previousAttach=records['previousAttach'], candidateAttach=records['candidateAttach'],
                            readyReceipt=records['readyReceipt'], previousCapture={
                                name: records[name] for name in ('accountingReceipt', 'diagnosticReceipt')})

    def save(self, path, value):
        with Path(path).open('x', encoding='utf-8') as stream:
            json.dump(value, stream)

    def replace(self, path, value):
        Path(path).write_text(json.dumps(value), encoding='utf-8')

    def main(self, action):
        with patch.object(M, 'operator', return_value=self.host), redirect_stdout(io.StringIO()):
            M.main(['--operator-root', str(self.root), '--collector-sha256', COLLECTOR_SHA, '--action', action])

    def test_default_is_inert_without_operator_or_external_io(self):
        output = io.StringIO()
        with patch.object(M, 'operator', side_effect=AssertionError('must remain inert')), redirect_stdout(output):
            M.main([])
        self.assertEqual(json.loads(output.getvalue()), {'result': 'INERT', 'hostCalls': 0, 'providerRequests': 0})

    def test_collector_binding_requires_exact_local_bytes_and_installs_separate_protected_file(self):
        raw, path = M.collector_binding(COLLECTOR_SHA)
        self.assertEqual(raw, (HERE / 'historical_capture.py').read_bytes())
        self.assertEqual(path, M.TARGET + '/historical_capture.' + COLLECTOR_SHA + '.py')
        for digest in (None, '', '0' * 64):
            with self.subTest(digest=digest), self.assertRaisesRegex(RuntimeError, 'EXPLICIT_COLLECTOR_HASH_REQUIRED'):
                M.collector_binding(digest)
        for readback in (False, True):
            program = M.install_program(self.host, COLLECTOR_SHA, readback)
            compile(program, 'offline-protected-install', 'exec')
            self.assertIn('READBACK=' + repr(readback), program)
            self.assertIn('historical_capture.' + COLLECTOR_SHA, program)

    def test_confirmation_requires_fresh_healthy_same_original_id_and_image(self):
        self.assertEqual(M.confirmed_baseline(self.host, self.receipts), self.before)
        mutations = [lambda value: value['backend'].update(id='0' * 64),
                     lambda value: value['backend'].update(image='different-image'),
                     lambda value: value['backend'].update(running=False),
                     lambda value: value.update(result='FAIL'),
                     lambda value: value.update(remoteExitCode=1),
                     lambda value: value['identityVerification'].update(verifiedAt=(datetime.now(timezone.utc) - timedelta(minutes=31)).isoformat()),
                     lambda value: value['identityVerification'].update(verifiedAt=(datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat())]
        for mutation in mutations:
            value = deepcopy(self.before)
            mutation(value)
            self.replace(self.receipts / 'confirm.json', value)
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                self.main('install')
            self.host.remote.assert_not_called()

    def test_readback_and_complete_history_are_required_before_dispatch(self):
        cases = [('readback.json', 'target', '/wrong'), ('readback.json', 'remoteExitCode', 1),
                 ('readback.json', 'files', {}), ('history-preflight.json', 'result', 'FAIL_BOUNDED_HISTORY_PREFLIGHT'),
                 ('history-preflight.json', 'remoteExitCode', 1), ('history-preflight.json', 'history', {'transportComplete': False}),
                 ('history-preflight.json', 'sourceCommit', '0' * 40), ('history-preflight.json', 'collectorSha256', '0' * 64)]
        originals = {name: self.host.read(self.receipts / name) for name in ('readback.json', 'history-preflight.json')}
        for name, key, changed in cases:
            with self.subTest(name=name, key=key):
                for filename, original in originals.items(): self.replace(self.receipts / filename, original)
                value = deepcopy(originals[name]); value[key] = changed
                self.replace(self.receipts / name, value)
                with self.assertRaises(RuntimeError): self.main('update')
                self.host.remote.assert_not_called()
                self.assertFalse((self.receipts / 'update-dispatched.json').exists())

    def test_lost_update_response_retains_dispatch_marker_and_cannot_replay(self):
        self.host.remote.side_effect = OSError('synthetic uncertain transport')
        with self.assertRaises(OSError): self.main('update')
        dispatched = self.host.read(self.receipts / 'update-dispatched.json')
        self.assertEqual(dispatched['sourceCommit'], M.SOURCE)
        self.assertEqual(dispatched['collectorSha256'], COLLECTOR_SHA)
        self.assertEqual(dispatched['gateSha256'], M.GATE_SHA)
        self.assertTrue(dispatched['noAutomaticRepeat'])
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_ALREADY_DISPATCHED'): self.main('update')
        self.assertEqual(self.host.remote.call_count, 1)

    def test_failed_result_is_persisted_and_never_accepted_as_success_or_retried(self):
        self.host.remote.side_effect = None
        self.host.remote.return_value = {'result': 'FAIL_ARTIFACT_UPDATE_STOPPED_RETAINED', 'remoteExitCode': 1,
                                        'code': 'HISTORY_QUERY_NONZERO_EXIT'}
        with self.assertRaisesRegex(RuntimeError, 'HOST_ACTION_FAILED'): self.main('update')
        self.assertEqual(self.host.read(self.receipts / 'update.json')['code'], 'HISTORY_QUERY_NONZERO_EXIT')
        with self.assertRaisesRegex(RuntimeError, 'RECEIPT_EXISTS'): self.main('update')
        self.assertEqual(self.host.remote.call_count, 1)

    def test_evidence_requires_success_matching_both_manifests_and_scoped_paths(self):
        compile(M.evidence_program(self.host, self.success), 'offline-evidence', 'exec')
        for changes in ({'result': 'FAIL'}, {'remoteExitCode': 1}, {'candidateManifestSha256': '0' * 64},
                        {'previousManifestSha256': '0' * 64}):
            with self.subTest(changes=changes), self.assertRaisesRegex(RuntimeError, 'SUCCESSFUL_UPDATE_REQUIRED'):
                M.evidence_program(self.host, self.success | changes)
        value = deepcopy(self.success); value['readyReceipt']['path'] = '/outside/artifact-update-file.json'
        with self.assertRaisesRegex(RuntimeError, 'EVIDENCE_SCOPE_CHANGED'): M.evidence_program(self.host, value)

    def execute_history_program(self, *, collect_only=True, error=None, summary=None, inspect_error=False):
        if summary is None:
            summary = {'commands': 20, 'splitIntervals': 3, 'containerLifetimeScope': True,
                       'transportComplete': error is None, 'queries': [{'returncode': 0, 'stdoutBytes': 12000, 'stderrBytes': 0}]}
        value = {'rawBytesObserved': 1187968, 'ignoredLines': 50, 'rejectedEvents': 0,
                 'cutoff': '2026-10-21T06:00:00Z', 'transportComplete': True, 'pages': []}
        collector = SimpleNamespace(HistoryError=C.HistoryError, verification_summary=lambda: summary)
        def history(*_args):
            if error is not None: raise error
            return value
        collector.install = Mock(side_effect=lambda coordinator: setattr(coordinator, 'historical_capture', history))
        coordinator = SimpleNamespace(_safe_error=lambda *_args: 'SAFE_COORDINATOR_FAILURE')
        def update(*_args):
            try:
                coordinator.historical_capture(ports, 'e' * 64, None)
                return {'result': 'PASS_BOUNDED_BETA_ARTIFACT_UPDATED'}
            except Exception as caught:
                return {'result': 'FAIL_ARTIFACT_UPDATE_STOPPED_RETAINED', 'code': coordinator._safe_error(caught, None)}
        coordinator.update = Mock(side_effect=update)
        runtime = {'id': 'e' * 64, 'image': IMAGE, 'imageId': 'sha256:' + 'c' * 64,
                   'running': True, 'health': 'healthy', 'oom': False, 'restarts': 0,
                   'privateRawBody': 'do-not-persist'}
        ports = SimpleNamespace(preflight_beta=Mock(), baseline={'backend': {'id': 'e' * 64}},
                                inspect_backend=Mock(return_value=runtime))
        if inspect_error: ports.inspect_backend.side_effect = RuntimeError('private inspection detail')
        def execute_module(module): module.__dict__.update(vars(collector))
        fake_import = SimpleNamespace(util=SimpleNamespace(
            spec_from_file_location=lambda name, _path: SimpleNamespace(name=name, loader=SimpleNamespace(exec_module=execute_module)),
            module_from_spec=lambda spec: ModuleType(spec.name)))
        source = self.host.update_program('unused')
        prefix = 'module=COORDINATOR\nports=PORTS\nmodules=MODULES\nprevious={}\ncandidate={}\nPREVIOUS_SHA="a"\nCANDIDATE_SHA="b"\n'
        with patch.object(self.host, 'update_program', return_value=prefix + source):
            program = M.patched_program(self.host, COLLECTOR_SHA, collect_only)
        output = io.StringIO()
        namespace = {'COORDINATOR': coordinator, 'PORTS': ports, 'MODULES': SimpleNamespace(capture=None),
                     'importlib': fake_import, 'sys': sys, 'protected': Mock(), 'need': M.need}
        with redirect_stdout(output), self.assertRaises(SystemExit) as stopped:
            exec(program, namespace)
        collector.install.assert_called_once_with(coordinator)
        return json.loads(output.getvalue()), stopped.exception.code, output.getvalue(), coordinator

    def test_generated_preflight_uses_verified_collector_and_returns_full_bounded_command_summary(self):
        result, code, _output, coordinator = self.execute_history_program()
        self.assertEqual(code, 0)
        self.assertEqual(result['result'], 'PASS_BOUNDED_HISTORY_PREFLIGHT')
        self.assertEqual(result['history']['rawBytesObserved'], 1187968)
        self.assertEqual(result['history']['queries'][0]['returncode'], 0)
        self.assertEqual(result['history']['splitIntervals'], 3)
        self.assertEqual(result['sourceCommit'], M.SOURCE)
        self.assertEqual(result['collectorSha256'], COLLECTOR_SHA)
        self.assertFalse(result['authorizesRecreation'])
        coordinator.update.assert_not_called()

    def test_nonzero_history_exit_is_structured_exit_one_with_selected_failure_diagnostics(self):
        error = C.HistoryError('HISTORY_QUERY_NONZERO_EXIT', {'returncode': 2, 'stdoutBytes': 70,
                               'stderrBytes': 20, 'partial': False, 'rawMessage': 'do-not-persist'})
        result, code, output, _coordinator = self.execute_history_program(error=error)
        self.assertEqual(code, 1)
        self.assertEqual(result['code'], 'HISTORY_QUERY_NONZERO_EXIT')
        self.assertEqual(result['history']['returncode'], 2)
        self.assertEqual(result['history']['stdoutBytes'], 70)
        self.assertEqual(set(result['history']['failureRuntime']), {'id', 'image', 'imageId', 'running', 'health', 'oom', 'restarts'})
        self.assertNotIn('do-not-persist', output)
        self.assertFalse(result['authorizesRecreation'])
        self.assertTrue(result['noAutomaticRetry'])

    def test_failed_inspection_is_fixed_code_and_oversized_metadata_fails_below_output_cap(self):
        error = C.HistoryError('HISTORY_QUERY_TIMEOUT', {'timeout': True})
        result, code, output, _coordinator = self.execute_history_program(error=error, inspect_error=True)
        self.assertEqual(code, 1)
        self.assertEqual(result['history']['failureRuntime'], {'code': 'COMPLETION_FAILURE_RUNTIME_UNAVAILABLE'})
        self.assertNotIn('private inspection detail', output)
        result, code, output, _coordinator = self.execute_history_program(summary={'queries': ['private-raw' * 20000]})
        self.assertEqual(code, 1)
        self.assertEqual(result['code'], 'COMPLETION_HISTORY_METADATA_BOUNDS_EXCEEDED')
        self.assertTrue(result['history']['metadataBoundExceeded'])
        self.assertLess(len(output.encode()), 131072)
        self.assertNotIn('private-raw', output)

    def test_generated_update_keeps_original_coordinator_result_and_maps_fixed_collector_failure(self):
        error = C.HistoryError('HISTORY_QUERY_TIMEOUT', {'timeout': True, 'partial': True})
        result, code, _output, coordinator = self.execute_history_program(collect_only=False, error=error)
        self.assertEqual(code, 1)
        self.assertEqual(result['result'], 'FAIL_ARTIFACT_UPDATE_STOPPED_RETAINED')
        self.assertEqual(result['code'], 'HISTORY_QUERY_TIMEOUT')
        self.assertTrue(result['boundedHistoryCollector']['partial'])
        coordinator.update.assert_called_once()

    def test_verify_compiles_image_source_context_proof_and_rejects_ledger_or_runtime_drift(self):
        self.save(self.receipts / 'update.json', self.success)
        self.host.runtime_prelude = lambda candidate=True: 'import json\nctx=CTX\nports=PORTS\nneed=NEED\n'
        self.host.remote.side_effect = None
        self.host.remote.return_value = deepcopy(self.before)
        self.main('verify')
        program = self.host.remote.call_args.args[0]
        compile(program, 'offline-deployed-source-verification', 'exec')
        for required in ('COMPLETION_DEPLOYED_SOURCE_CHANGED', 'COMPLETION_DEPLOYED_CONTEXT_CHANGED',
                         'COMPLETION_DEPLOYED_DIGEST_CHANGED', 'deployedImageProof', M.SOURCE, CONTEXT):
            self.assertIn(required, program)
        proof = {'id': 'sha256:' + 'c' * 64, 'repoDigests': [IMAGE], 'revision': M.SOURCE, 'context': CONTEXT}
        ports = SimpleNamespace(_image=lambda: IMAGE,
            _run=Mock(side_effect=lambda *_args: SimpleNamespace(stdout=json.dumps(proof).encode())),
            assert_accounting_preserved=Mock())
        output = io.StringIO()
        with redirect_stdout(output):
            exec(program, {'CTX': {'DOCKER': ['docker']}, 'PORTS': ports, 'NEED': M.need})
        self.assertEqual(json.loads(output.getvalue())['deployedImageProof'], proof)
        ports.assert_accounting_preserved.assert_called_with(self.before['accounting'])
        for field, changed, code in (('revision', '0' * 40, 'DEPLOYED_SOURCE_CHANGED'),
                                     ('context', '0' * 64, 'DEPLOYED_CONTEXT_CHANGED'),
                                     ('repoDigests', ['wrong-image'], 'DEPLOYED_DIGEST_CHANGED')):
            original = proof[field]; proof[field] = changed
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, code):
                exec(program, {'CTX': {'DOCKER': ['docker']}, 'PORTS': ports, 'NEED': M.need})
            proof[field] = original
        for changed in ('caddy', 'accounting'):
            (self.receipts / 'verify.json').unlink()
            result = deepcopy(self.before)
            if changed == 'caddy': result['caddy']['id'] = 'drifted'
            else: result['accounting']['reservedMicros'] = 0
            self.host.remote.return_value = result
            with self.subTest(changed=changed), self.assertRaises(RuntimeError): self.main('verify')

    def test_operator_checks_bundle_source_successful_pull_gate_and_transitive_packet(self):
        path = self.root / 'deploy/maintainability-release-20261021/host_release.py'
        path.parent.mkdir(parents=True)
        path.write_bytes(b'offline-operator')
        self.save(self.out / 'backend-update.json', {'code': 'UPDATE_HISTORICAL_COMMAND_FAILED',
                  'result': 'FAIL_ARTIFACT_UPDATE_STOPPED_RETAINED'})
        pull = {'result': 'PASS_APPROVED_IMMUTABLE_IMAGE_PULL', 'remoteExitCode': 0,
                'manifestSha256': CANDIDATE_SHA, 'gateSha256': M.GATE_SHA,
                'temporaryAuthRemoved': True, 'productionUnchanged': True}
        self.save(self.revision / 'backend-pull.json', pull)
        fake_spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _module: None))
        with patch.object(M, 'HOST_SHA', M.sha(path.read_bytes())), \
                patch.object(M.importlib.util, 'spec_from_file_location', return_value=fake_spec), \
                patch.object(M.importlib.util, 'module_from_spec', return_value=self.host):
            self.assertIs(M.operator(self.root), self.host)
            self.host.checked_pull_packet.assert_called_with('preflight', M.GATE_SHA)
            for changes in ({'gateSha256': '0' * 64}, {'manifestSha256': '0' * 64}, {'remoteExitCode': 1},
                            {'temporaryAuthRemoved': False}, {'productionUnchanged': False}):
                self.replace(self.revision / 'backend-pull.json', pull | changes)
                with self.subTest(changes=changes), self.assertRaisesRegex(RuntimeError, 'VERIFIED_PULL_REQUIRED'):
                    M.operator(self.root)
            self.replace(self.revision / 'backend-pull.json', pull)
            self.candidate['sourceCommit'] = '0' * 40
            with self.assertRaisesRegex(RuntimeError, 'SOURCE_CHANGED'): M.operator(self.root)
        with self.assertRaisesRegex(RuntimeError, 'OPERATOR_BUNDLE_CHANGED'): M.operator(self.root)

    def test_completion_trial_receipts_and_target_are_separate_and_original_function_is_verified(self):
        self.assertEqual(M.ATTEMPT, 'completion-r2')
        self.assertTrue(M.TARGET.endswith('-r2'))
        with self.assertRaises(C.HistoryError) as rejected:
            C.install(SimpleNamespace(historical_capture=lambda *_args: None))
        self.assertEqual(rejected.exception.code, 'HISTORY_FROZEN_ORIGINAL_FUNCTION_CHANGED')


if __name__ == '__main__':
    unittest.main()

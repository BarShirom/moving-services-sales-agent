"""Explicit second deployment attempt using the existing pinned operator bundle.

The archived first attempt is never edited or replayed. Default invocation is
inert. The operator bundle stays outside this source checkout and must match
its reviewed hash. No credentials, provider requests or new allowances exist
here. Only a new protected collector and the already verified image are used.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

HOST_SHA = '8e6e6ed76d8d1ca3c98f80f68688324349b974a23e922c87779e0c75b3a68768'
SOURCE = '9027d0f53e38a7f2eea700d93615bab731d16134'
GATE_SHA = '7d0e02676ca6d71e414400cc4eb23f9187202393f9702392fc741df2da49acd9'
TARGET = '/opt/moving-demo/config/maintainability-history-20261021-r2'
ATTEMPT = 'completion-r2'
HERE = Path(__file__).resolve().parent


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def operator(root):
    path = Path(root).resolve() / 'deploy/maintainability-release-20261021/host_release.py'
    need(sha(path.read_bytes()) == HOST_SHA, 'COMPLETION_OPERATOR_BUNDLE_CHANGED')
    spec = importlib.util.spec_from_file_location('reviewed_completion_operator', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    previous, candidate, digest = module.prepared_inputs()
    need(candidate['sourceCommit'] == SOURCE, 'COMPLETION_SOURCE_CHANGED')
    failure = module.read(module.OUT / 'backend-update.json')
    need(failure['code'] == 'UPDATE_HISTORICAL_COMMAND_FAILED'
         and failure['result'] == 'FAIL_ARTIFACT_UPDATE_STOPPED_RETAINED',
         'COMPLETION_ORIGINAL_FAILURE_RECORD_CHANGED')
    pull = module.read(module.REVISION / 'backend-pull.json')
    need(pull['result'] == 'PASS_APPROVED_IMMUTABLE_IMAGE_PULL'
         and pull['remoteExitCode'] == 0 and pull['manifestSha256'] == digest
         and pull['gateSha256'] == GATE_SHA and pull['temporaryAuthRemoved'] is True
         and pull['productionUnchanged'] is True,
         'COMPLETION_VERIFIED_PULL_REQUIRED')
    module.checked_pull_packet('preflight', GATE_SHA)
    return module


def collector_binding(expected):
    need(type(expected) is str and re.fullmatch('[a-f0-9]{64}', expected),
         'COMPLETION_EXPLICIT_COLLECTOR_HASH_REQUIRED')
    raw = (HERE / 'historical_capture.py').read_bytes()
    need(sha(raw) == expected, 'COMPLETION_EXPLICIT_COLLECTOR_HASH_REQUIRED')
    return raw, TARGET + '/historical_capture.' + expected + '.py'


def confirmed_baseline(host, out):
    before = host.read(host.OUT / 'production-before-collector-fix.json')
    confirm = host.read(out / 'confirm.json')
    need(before.get('result') == confirm.get('result') == 'PASS_CURRENT_UPDATE_PREFLIGHT'
         and before.get('remoteExitCode') == confirm.get('remoteExitCode') == 0
         and confirm['backend']['id'] == before['backend']['id']
         and confirm['backend']['image'] == before['backend']['image']
         and confirm['backend']['running'] is True and confirm['backend']['health'] == 'healthy',
         'COMPLETION_CONFIRMED_ORIGINAL_BASELINE_REQUIRED')
    try:
        verified = datetime.fromisoformat(confirm['identityVerification']['verifiedAt'])
        age = (datetime.now(timezone.utc) - verified).total_seconds()
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('COMPLETION_FRESH_CONFIRMATION_REQUIRED') from None
    need(0 <= age <= 1800, 'COMPLETION_FRESH_CONFIRMATION_REQUIRED')
    return confirm


def install_program(host, expected, readback):
    raw, path = collector_binding(expected)
    files = {Path(path).name: {'sha256': expected, 'base64': base64.b64encode(raw).decode()}}
    source = 'import base64\n' + host.runtime_prelude(False)
    source += '\nTARGET=' + repr(TARGET) + '\nFILES=' + repr(files) + '\nREADBACK=' + repr(readback) + '\n'
    source += host.frozen('control').INSTALL
    compile(source, 'completion-install-protected-collector', 'exec')
    return source


def patched_program(host, expected, collect_only=False):
    _, path = collector_binding(expected)
    source = host.update_program(host.PINS['coordinator'][1])
    marker = 'result=module.update(ports,previous,PREVIOUS_SHA,candidate,CANDIDATE_SHA,modules)'
    need(source.count(marker) == 1, 'COMPLETION_COORDINATOR_INTEGRATION_CHANGED')
    patch = '''
protected(COLLECTOR_PATH,COLLECTOR_SHA)
spec=importlib.util.spec_from_file_location('reviewed_bounded_history',COLLECTOR_PATH)
collector=importlib.util.module_from_spec(spec);sys.modules[spec.name]=collector;spec.loader.exec_module(collector)
original_safe_error=module._safe_error
def safe_error(error,modules):
 if isinstance(error,collector.HistoryError):return error.code
 if type(error) is RuntimeError and str(error)=='COMPLETION_HISTORY_METADATA_BOUNDS_EXCEEDED':return str(error)
 return original_safe_error(error,modules)
module._safe_error=safe_error
collector.install(module)
original_history=module.historical_capture
history_result={}
def history_metadata(extra=None):
 summary=collector.verification_summary() or {}
 if len(json.dumps(summary,sort_keys=True).encode())>122880:
  history_result.clear();history_result.update({'metadataBoundExceeded':True,'metadataByteBound':131072,'transportComplete':False})
 else:history_result.update(summary)
 if extra:history_result.update(extra)
 return not history_result.get('metadataBoundExceeded',False)
def failure_runtime(ports,container_id):
 try:
  value=ports.inspect_backend(container_id)
  selected={key:value[key] for key in ('id','image','imageId','running','health','oom','restarts')}
  for key in ('id','image','imageId'):
   need(type(selected[key]) is str and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9./:@_-]{0,399}',selected[key]),'COMPLETION_FAILURE_RUNTIME_INVALID')
  need(type(selected['running']) is bool and type(selected['oom']) is bool
       and selected['health'] in ('healthy','unhealthy','starting','none',None)
       and type(selected['restarts']) is int and 0<=selected['restarts']<=1000000,'COMPLETION_FAILURE_RUNTIME_INVALID')
  return selected
 except Exception:return {'code':'COMPLETION_FAILURE_RUNTIME_UNAVAILABLE'}
def bounded_history(ports,container_id,capture):
 try:
  value=original_history(ports,container_id,capture)
  need(history_metadata(),'COMPLETION_HISTORY_METADATA_BOUNDS_EXCEEDED')
  history_result.update({key:value[key] for key in ('rawBytesObserved','ignoredLines','rejectedEvents','cutoff','transportComplete')})
  return value
 except Exception as error:
  history_metadata(error.safe_details() if isinstance(error,collector.HistoryError) else None)
  history_result['failureRuntime']=failure_runtime(ports,container_id)
  raise
module.historical_capture=bounded_history
'''
    if collect_only:
        patch += '''
try:
 ports.preflight_beta();ports.created=ports.baseline['backend']['id']
 value=bounded_history(ports,ports.created,modules.capture)
 result={'result':'PASS_BOUNDED_HISTORY_PREFLIGHT','history':history_result,'providerRequests':0,
         'productionUnchanged':True,'authorizesRecreation':False,'sourceCommit':COMPLETION_SOURCE,'collectorSha256':COLLECTOR_SHA}
except Exception as error:
 result={'result':'FAIL_BOUNDED_HISTORY_PREFLIGHT','code':module._safe_error(error,modules),'history':history_result,
         'providerRequests':0,'productionUnchanged':True,'authorizesRecreation':False,'noAutomaticRetry':True,
         'sourceCommit':COMPLETION_SOURCE,'collectorSha256':COLLECTOR_SHA}
'''
    else:
        patch += marker + "\nresult['boundedHistoryCollector']=history_result\n"
    source = ('import re\nCOMPLETION_SOURCE=' + repr(SOURCE) + '\nCOLLECTOR_PATH=' + repr(path) + '\nCOLLECTOR_SHA=' + repr(expected) + '\n'
              + source.replace(marker, patch))
    compile(source, 'completion-reviewed-bounded-history-update', 'exec')
    return source


def evidence_program(host, receipt):
    _, _, candidate_sha = host.prepared_inputs()
    need(receipt['result'] == 'PASS_BOUNDED_BETA_ARTIFACT_UPDATED'
         and receipt['remoteExitCode'] == 0
         and receipt.get('previousManifestSha256') == host.PREVIOUS_SHA
         and receipt.get('candidateManifestSha256') == candidate_sha,
         'COMPLETION_SUCCESSFUL_UPDATE_REQUIRED')
    receipts = [receipt['previousAttach'], receipt['previousCapture']['accountingReceipt'],
                receipt['previousCapture']['diagnosticReceipt'], receipt['candidateAttach'], receipt['readyReceipt']]
    parent = host.previous_manifest()['beta']['operatorPath'] + '/evidence'
    need(all(item['path'].startswith(parent + '/artifact-update-')
             and Path(item['path']).parent.as_posix() == parent for item in receipts),
         'COMPLETION_EVIDENCE_SCOPE_CHANGED')
    control = host.frozen('control')
    return ('RECEIPTS=' + repr(receipts) + '\n'
            + control.LOAD.split('oldpath=MANIFEST_PATH', 1)[0] + control.EVIDENCE)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operator-root')
    parser.add_argument('--collector-sha256')
    parser.add_argument('--action', choices=('confirm', 'install', 'readback', 'history-preflight', 'update', 'verify', 'evidence'))
    args = parser.parse_args(argv)
    if args.action is None:
        print('{"result":"INERT","hostCalls":0,"providerRequests":0}')
        return
    need(args.operator_root is not None, 'COMPLETION_OPERATOR_ROOT_REQUIRED')
    host = operator(args.operator_root)
    out = host.OUT / ATTEMPT
    out.mkdir(exist_ok=True)
    name = args.action + '.json'
    need(not (out / name).exists(), 'COMPLETION_RECEIPT_EXISTS_NO_AUTOMATIC_REPEAT')
    if args.action != 'confirm':
        confirmed_baseline(host, out)
    if args.action == 'confirm':
        before = host.read(host.OUT / 'production-before-collector-fix.json')
        source = host.inspect_program(False, before['accounting'])
        expected = 'PASS_CURRENT_UPDATE_PREFLIGHT'
    elif args.action in ('install', 'readback'):
        source = install_program(host, args.collector_sha256, args.action == 'readback')
        expected = 'PASS_UPDATE_CONTROL_INDEPENDENT_READBACK' if args.action == 'readback' else 'PASS_UPDATE_CONTROL_INSTALLED'
    elif args.action in ('history-preflight', 'update'):
        readback = host.read(out / 'readback.json')
        _, path = collector_binding(args.collector_sha256)
        need(readback['result'] == 'PASS_UPDATE_CONTROL_INDEPENDENT_READBACK'
             and readback['remoteExitCode'] == 0 and readback['target'] == TARGET
             and readback['files'] == {Path(path).name: args.collector_sha256},
             'COMPLETION_EXACT_COLLECTOR_READBACK_REQUIRED')
        if args.action == 'update':
            need(not (out / 'update-dispatched.json').exists(), 'COMPLETION_UPDATE_ALREADY_DISPATCHED')
            history = host.read(out / 'history-preflight.json')
            need(history['result'] == 'PASS_BOUNDED_HISTORY_PREFLIGHT'
                 and history['remoteExitCode'] == 0 and history['history']['transportComplete'] is True,
                 'COMPLETION_COMPLETE_HISTORY_PREFLIGHT_REQUIRED')
            need(history.get('sourceCommit') == SOURCE and history.get('collectorSha256') == args.collector_sha256,
                 'COMPLETION_HISTORY_BINDING_CHANGED')
            host.save(out / 'update-dispatched.json', {'sourceCommit': SOURCE, 'collectorSha256': args.collector_sha256,
                      'gateSha256': GATE_SHA, 'providerRequests': 0, 'noAutomaticRepeat': True})
        source = patched_program(host, args.collector_sha256, args.action == 'history-preflight')
        expected = 'PASS_BOUNDED_HISTORY_PREFLIGHT' if args.action == 'history-preflight' else 'PASS_BOUNDED_BETA_ARTIFACT_UPDATED'
    elif args.action == 'verify':
        receipt = host.read(out / 'update.json')
        evidence_program(host, receipt)
        before = host.read(out / 'confirm.json')
        fmt = ('{"id":{{json .Id}},"repoDigests":{{json .RepoDigests}},'
               '"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},'
               '"context":{{json (index .Config.Labels "com.moving-demo.source.context.sha256")}}}')
        source = host.runtime_prelude(True)
        source += '\nports.assert_accounting_preserved(' + repr(before['accounting']) + ')\n'
        source += 'image_proof=json.loads(ports._run(ctx["DOCKER"]+["image","inspect","--format",' + repr(fmt) + ',ports._image()]).stdout)\n'
        source += 'need(image_proof["revision"]==' + repr(SOURCE) + ',"COMPLETION_DEPLOYED_SOURCE_CHANGED")\n'
        identity = host.read(host.REVISION / 'local-image-identity.json')
        source += 'need(image_proof["context"]==' + repr(identity['contextSha256']) + ',"COMPLETION_DEPLOYED_CONTEXT_CHANGED")\n'
        source += 'need(ports._image() in image_proof["repoDigests"],"COMPLETION_DEPLOYED_DIGEST_CHANGED")\n'
        inspect_body = host.frozen('control').INSPECT
        marker = "{'result':'PASS_CURRENT_UPDATE_PREFLIGHT','backend':runtime"
        need(inspect_body.count(marker) == 1, 'COMPLETION_INSPECTION_CONTRACT_CHANGED')
        source += inspect_body.replace(marker, "{'result':'PASS_CURRENT_UPDATE_PREFLIGHT','deployedImageProof':image_proof,'backend':runtime")
        expected = 'PASS_CURRENT_UPDATE_PREFLIGHT'
    else:
        source = evidence_program(host, host.read(out / 'update.json'))
        expected = 'PASS_DURABLE_UPDATE_EVIDENCE_AFTER_CLEANUP'
    result = host.remote(source)
    host.save(out / name, result)
    need(result.get('result') == expected and result.get('remoteExitCode') == 0,
         'COMPLETION_HOST_ACTION_FAILED_PRESERVE_EVIDENCE')
    if args.action == 'confirm':
        confirmed_baseline(host, out)
    if args.action == 'verify':
        before = host.read(out / 'confirm.json')
        for key in ('caddy', 'historicalAccounting', 'credentialSources', 'statePath'):
            need(before[key] == result[key], 'COMPLETION_IMMUTABLE_RUNTIME_CHANGED')
        for key in ('attempts', 'reservedUnits', 'reservedMicros'):
            need(before['accounting'][key] == result['accounting'][key], 'COMPLETION_UNEXPECTED_ACCOUNTING_CHANGE')
    print(json.dumps({key: result.get(key) for key in ('result', 'remoteExitCode', 'code', 'boundedHistoryCollector', 'history')}, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch(r'COMPLETION_[A-Z0-9_]{1,100}', str(error)) else 'COMPLETION_SANITIZED_FAILURE'
        print(json.dumps({'result': 'FAIL_COMPLETION_STOPPED', 'code': code,
                          'noAutomaticRetry': True, 'providerRequests': 0}), file=sys.stderr)
        raise SystemExit(1) from None

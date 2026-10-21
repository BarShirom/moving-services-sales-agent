"""Offline regressions for complete bounded history, with synthetic Docker I/O."""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('tested_bounded_history', HERE / 'historical_capture.py')
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)
CONTAINER = 'c' * 64
START = history._nanoseconds('2026-10-21T00:00:00.000000000Z')


class Streams:
    def __init__(self, stdout, stderr):
        self.stdout, self.stderr = stdout, stderr


class SyntheticSanitizer:
    MAX_LINE_BYTES = 16384
    MAX_BYTES_PER_STREAM = 65536
    MAX_LINES = 256
    MAX_EVENTS = 8
    LogStreams = Streams

    @staticmethod
    def sanitize_streams(streams):
        events = []
        ignored = 0
        for raw in (streams.stdout, streams.stderr):
            assert len(raw) <= SyntheticSanitizer.MAX_BYTES_PER_STREAM
            lines = raw.splitlines()
            assert len(lines) <= SyntheticSanitizer.MAX_EVENTS
            for line in lines:
                assert len(line) <= SyntheticSanitizer.MAX_LINE_BYTES
                body = line.split(b' ', 1)[1]
                if body.startswith(b'{'):
                    value = json.loads(body)
                    if value.get('event') == 'synthetic_diagnostic':
                        events.append({'id': value['id']})
                        continue
                ignored += 1
        return {'events': events, 'ignoredLines': ignored, 'rejectedEvents': 0,
                'reason': 'sanitized_events' if events else 'no_diagnostic_event', 'cleanupReady': bool(events)}


class Ports:
    ctx = {'DOCKER': ['docker', '--host', 'unix:///synthetic.sock'], 'ENV': {'PATH': '/usr/bin', 'LANG': 'C.UTF-8'}}
    def __init__(self):
        self.created = history._timestamp(START)
        self.started = history._timestamp(START + 3600 * 1_000_000_000)
        self.cutoff = datetime(2026, 10, 21, 2, tzinfo=timezone.utc)
        self.inspections = 0
    def now(self): return self.cutoff
    def inspect_backend(self, identity):
        assert identity == CONTAINER
        self.inspections += 1
        return {'id': CONTAINER}
    def _run(self, arguments, **options):
        assert arguments[len(self.ctx['DOCKER']):3 + len(self.ctx['DOCKER'])] == ['container', 'inspect', '--format']
        return types.SimpleNamespace(stdout=json.dumps({'id': CONTAINER, 'created': self.created,
            'started': self.started, 'logging': {'Type': 'json-file', 'Config': {'max-size': '5m', 'max-file': '2'}}}).encode())


def record(at, body):
    return history._timestamp(at).encode() + b' ' + body + b'\n'


def diagnostic(at, identifier):
    return record(at, json.dumps({'event': 'synthetic_diagnostic', 'id': identifier}).encode())


def response(stdout=b'', stderr=b'', code=0, partial=False, exceeded=False, timeout=False):
    return {'returncode': code, 'stdout': stdout, 'stderr': stderr,
            'stdoutBytes': len(stdout), 'stderrBytes': len(stderr), 'byteBound': history.QUERY_BYTES,
            'outputLimitExceeded': exceeded, 'timeout': timeout, 'partial': partial,
            'helperCleanupComplete': True}


class DockerQueries:
    def __init__(self, records, exclusive=False):
        self.records, self.exclusive, self.calls = records, exclusive, []
    def __call__(self, ports, arguments, timeout):
        assert arguments[-3:] == ['--tail', 'all', CONTAINER]
        lower = history._nanoseconds(arguments[arguments.index('--since') + 1])
        upper = history._nanoseconds(arguments[arguments.index('--until') + 1])
        self.calls.append((lower, upper))
        selected = {stream: b''.join(raw for at, selected_stream, raw in self.records
                    if selected_stream == stream and ((lower < at < upper) if self.exclusive else (lower <= at <= upper)))
                    for stream in ('stdout', 'stderr')}
        if len(selected['stdout']) + len(selected['stderr']) > history.QUERY_BYTES:
            # Parent partial bytes are intentionally different: they must never
            # survive interval splitting or become a successful capture page.
            return response(diagnostic(lower + 1, 999999), code=-9, partial=True, exceeded=True)
        return response(selected['stdout'], selected['stderr'])


class HistoricalCaptureTests(unittest.TestCase):
    def setUp(self):
        def blocked(*args, **kwargs): raise AssertionError('OFFLINE_HISTORY_EXTERNAL_CALL_BLOCKED')
        self.enterContext(patch.object(socket, 'create_connection', blocked))
        self.enterContext(patch.object(subprocess, 'Popen', blocked))
        self.enterContext(patch.object(subprocess, 'run', blocked))

    def test_history_larger_than_one_mib_is_complete_without_relaxing_query_bound(self):
        records = []
        for index in range(700):
            at = START + index * 5 * 1_000_000_000
            records.append((at, 'stdout', record(at, b'synthetic ordinary log ' + b'x' * 1900)))
        # This diagnostic predates the latest restart and must remain captured.
        records.append((START + 1, 'stderr', diagnostic(START + 1, 7)))
        runner = DockerQueries(records)
        with patch.object(history, '_run_query', runner):
            result = history.historical_capture(Ports(), CONTAINER, SyntheticSanitizer)
        summary = history.verification_summary()
        self.assertTrue(result['transportComplete'])
        self.assertGreater(result['rawBytesObserved'], 1024 * 1024)
        self.assertGreater(summary['splitIntervals'], 0)
        self.assertEqual(summary['records'], len(records))
        self.assertEqual(summary['queryByteBound'], 128 * 1024)
        self.assertEqual([event['id'] for page in result['pages'] for event in page['events']], [7])
        self.assertNotIn('synthetic ordinary log', json.dumps(result))
        self.assertTrue(summary['containerLifetimeScope'])
        self.assertLess(history.QUERY_BYTES, 1024 * 1024)

    def test_inclusive_and_exclusive_endpoints_preserve_boundary_records_and_multiplicity(self):
        for exclusive in (False, True):
            # Identical records at an exact boundary are two real records,
            # not permission to deduplicate by message, timestamp or event.
            at = START + 3600 * 1_000_000_000
            records = [(START, 'stdout', diagnostic(START, 1)),
                       (at, 'stdout', diagnostic(at, 2)), (at, 'stdout', diagnostic(at, 2)),
                       (START + 7200 * 1_000_000_000, 'stderr', diagnostic(START + 7200 * 1_000_000_000, 3))]
            with self.subTest(exclusive=exclusive), patch.object(history, '_run_query', DockerQueries(records, exclusive)):
                result = history.historical_capture(Ports(), CONTAINER, SyntheticSanitizer)
            self.assertEqual(sorted(event['id'] for page in result['pages'] for event in page['events']), [1, 2, 2, 3])
            self.assertEqual(history.verification_summary()['records'], 4)

    def test_nonzero_partial_and_timeout_never_authorize_complete_capture_or_leak_output(self):
        cases = [(response(stderr=b'private command output', code=17), 'HISTORY_QUERY_NONZERO_EXIT'),
                 (response(partial=True), 'HISTORY_QUERY_NONZERO_EXIT'),
                 (response(code=-9, partial=True, timeout=True), 'HISTORY_QUERY_TIMEOUT')]
        for query, code in cases:
            with self.subTest(code=code), patch.object(history, '_run_query', return_value=query):
                with self.assertRaises(history.HistoryError) as failed:
                    history.historical_capture(Ports(), CONTAINER, SyntheticSanitizer)
                self.assertEqual(failed.exception.code, code)
                self.assertNotIn('private', str(failed.exception) + json.dumps(failed.exception.safe_details()))
                self.assertFalse(history.verification_summary()['transportComplete'])
        self.assertEqual(cases[0][0]['returncode'], 17)

    def test_unsplittable_overflow_stops_without_successful_truncated_page(self):
        query = response(code=-9, partial=True, exceeded=True)
        ports = Ports()
        ports.started = ports.created
        ports.cutoff = datetime(2026, 10, 21, tzinfo=timezone.utc)
        with patch.object(history, '_run_query', return_value=query):
            with self.assertRaisesRegex(history.HistoryError, 'SINGLE_TIMESTAMP_OUTPUT_BOUNDS_EXCEEDED'):
                history.historical_capture(ports, CONTAINER, SyntheticSanitizer)
        self.assertFalse(history.verification_summary()['transportComplete'])

    def test_unparseable_record_timestamp_and_oversized_line_stop(self):
        for raw, code in ((b'unlabelled log record\n', 'HISTORY_RECORD_TIMESTAMP_REQUIRED'),
                          (record(START, b'x' * 17000), 'HISTORY_LINE_BOUNDS_EXCEEDED')):
            with self.subTest(code=code), patch.object(history, '_run_query', return_value=response(raw)):
                with self.assertRaisesRegex(history.HistoryError, code):
                    history.historical_capture(Ports(), CONTAINER, SyntheticSanitizer)
                self.assertFalse(history.verification_summary()['transportComplete'])

    def test_command_and_retained_byte_limits_stop_instead_of_skipping_data(self):
        with patch.object(history, 'MAX_COMMANDS', 1), patch.object(history, '_run_query', return_value=response()):
            with self.assertRaisesRegex(history.HistoryError, 'COMMAND_BOUNDS_EXCEEDED'):
                history.historical_capture(Ports(), CONTAINER, SyntheticSanitizer)
        records = [(START, 'stdout', record(START, b'ordinary'))]
        with patch.object(history, 'MAX_RETAINED_BYTES', 1), patch.object(history, '_run_query', DockerQueries(records)):
            with self.assertRaisesRegex(history.HistoryError, 'RETAINED_OUTPUT_BOUNDS_EXCEEDED'):
                history.historical_capture(Ports(), CONTAINER, SyntheticSanitizer)

    def test_changed_container_cannot_complete_capture(self):
        ports = Ports()
        original = ports._run
        calls = 0
        def inspect(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls > 1: ports.started = history._timestamp(START + 1)
            return original(*args, **kwargs)
        with patch.object(ports, '_run', inspect), patch.object(history, '_run_query', return_value=response()):
            with self.assertRaisesRegex(history.HistoryError, 'CONTAINER_CHANGED_DURING_CAPTURE'):
                history.historical_capture(ports, CONTAINER, SyntheticSanitizer)

    def test_safe_error_details_accept_only_fixed_codes_and_scalar_metadata(self):
        error = history.HistoryError('private message', {'returncode': 3, 'stderr': b'private', 'commands': 2,
                                                       'timeout': False, 'stdoutBytes': 'private'})
        self.assertEqual(error.code, 'HISTORY_UNCLASSIFIED_FAILURE')
        self.assertEqual(error.safe_details(), {'returncode': 3, 'commands': 2, 'timeout': False})

    def test_stream_runner_enforces_combined_cap_before_retaining_overflow(self):
        class Stream:
            def __init__(self, number): self.number = number
            def fileno(self): return self.number
            def close(self): pass
        class Process:
            stdout, stderr = Stream(10), Stream(11)
            killed = False
            def kill(self): self.killed = True
            def wait(self, timeout): return -9 if self.killed else 0
            def poll(self): return None
        class Selector:
            def __init__(self): self.active = {}
            def register(self, stream, event, data): self.active[stream.number] = types.SimpleNamespace(fd=stream.number, fileobj=stream, data=data)
            def unregister(self, stream): self.active.pop(stream.number)
            def get_map(self): return self.active
            def select(self, timeout): return [(key, None) for key in list(self.active.values())]
            def close(self): pass
        process = Process()
        streams = {10: bytearray(b'x' * 100000), 11: bytearray(b'y' * 100000)}
        read_ceiling = [65536]
        def read(number, amount):
            amount = min(amount, read_ceiling[0])
            result = bytes(streams[number][:amount]); del streams[number][:amount]; return result
        with patch.object(history.os, 'name', 'posix'), patch.object(history.os, 'read', read), \
             patch.object(history.selectors, 'DefaultSelector', Selector), \
             patch.object(history.subprocess, 'Popen', return_value=process):
            result = history._run_query(Ports(), ['docker', 'logs', CONTAINER], 20)
        self.assertTrue(process.killed)
        self.assertTrue(result['outputLimitExceeded'])
        self.assertTrue(result['partial'])
        self.assertEqual(result['stdoutBytes'] + result['stderrBytes'], history.QUERY_BYTES + 1)
        self.assertLessEqual(len(result['stdout']) + len(result['stderr']), history.QUERY_BYTES)
        # Short reads and independently reached EOFs must retain the real exit
        # code, rather than turning a failed Docker command into complete data.
        process = Process()
        process.wait = lambda timeout: 17
        streams = {10: bytearray(b'small stdout'), 11: bytearray(b'synthetic command failure')}
        read_ceiling[0] = 7
        with patch.object(history.os, 'name', 'posix'), patch.object(history.os, 'read', read), \
             patch.object(history.selectors, 'DefaultSelector', Selector), \
             patch.object(history.subprocess, 'Popen', return_value=process):
            result = history._run_query(Ports(), ['docker', 'logs', CONTAINER], 20)
        self.assertFalse(process.killed)
        self.assertFalse(result['partial'])
        self.assertEqual(result['returncode'], 17)
        self.assertEqual(result['stdout'], b'small stdout')
        self.assertEqual(result['stderr'], b'synthetic command failure')


if __name__ == '__main__':
    unittest.main()

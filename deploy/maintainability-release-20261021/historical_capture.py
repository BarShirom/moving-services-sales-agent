"""Complete retained Docker history through bounded, finite read-only queries.

The reviewed coordinator can bind historical_capture in its own process. Frozen
host files remain unchanged. Every accepted interval requires exit zero, both
stream EOFs and no truncation. An output limit splits the interval; it never
authorizes cleanup. Only existing sanitized diagnostic pages are returned.
"""
import calendar
import copy
from datetime import datetime, timezone
import hashlib
import inspect
import json
import os
import re
import selectors
import subprocess
import time

QUERY_BYTES = 128 * 1024
QUERY_SECONDS = 20
WINDOW_NS = 60 * 60 * 1_000_000_000
MAX_COMMANDS = 512
MAX_WALL_SECONDS = 120
MAX_RETAINED_BYTES = 16 * 1024 * 1024
MAX_SANITIZED_BYTES = 256 * 1024
ORIGINAL_FUNCTION_SHA256 = 'de9f889a318658919d0f19c970c24cecf6d24167d98bf19a1428481c9f0f8804'
_TIME = re.compile(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$')
_RECORD = re.compile(rb'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z) ')
_LAST_SUMMARY = None
ERROR_CODES = frozenset('''
HISTORY_TIMESTAMP_INVALID HISTORY_POSIX_RUNNER_REQUIRED HISTORY_QUERY_TRANSPORT_FAILED
HISTORY_LOG_CONTRACT_CHANGED HISTORY_CONTAINER_TIMESTAMPS_INVALID HISTORY_LINE_BOUNDS_EXCEEDED
HISTORY_RECORD_TIMESTAMP_REQUIRED HISTORY_CUTOFF_INVALID HISTORY_SANITIZER_BOUNDS_EXCEEDED
HISTORY_SANITIZED_PAGE_BOUNDS_EXCEEDED HISTORY_SANITIZER_LINE_BOUNDS_EXCEEDED
HISTORY_COMPLETE_CAPTURE_DEADLINE_EXCEEDED HISTORY_COMMAND_BOUNDS_EXCEEDED
HISTORY_QUERY_HELPER_CLEANUP_FAILED HISTORY_QUERY_TIMEOUT HISTORY_SINGLE_TIMESTAMP_OUTPUT_BOUNDS_EXCEEDED
HISTORY_QUERY_NONZERO_EXIT HISTORY_QUERY_BOUND_VIOLATION HISTORY_RETAINED_OUTPUT_BOUNDS_EXCEEDED
HISTORY_CONTAINER_CHANGED_DURING_CAPTURE HISTORY_FROZEN_ORIGINAL_FUNCTION_CHANGED
HISTORY_UNCLASSIFIED_FAILURE
'''.split())


class HistoryCaptureError(RuntimeError):
    """A fixed code plus bounded non-secret command metadata, never raw output."""
    def __init__(self, code, details=None):
        self.code = code if code in ERROR_CODES else 'HISTORY_UNCLASSIFIED_FAILURE'
        super().__init__(self.code)
        allowed = {'returncode', 'stdoutBytes', 'stderrBytes', 'byteBound', 'partial', 'timeout',
                   'outputLimitExceeded', 'commands', 'acceptedBytes', 'helperCleanupComplete'}
        self._details = {key: value for key, value in (details or {}).items()
                         if key in allowed and (value is None or type(value) in (bool, int))}

    def safe_details(self):
        return dict(self._details)


HistoryError = HistoryCaptureError


def _need(value, code, details=None):
    if not value:
        raise HistoryCaptureError(code, details)


def verification_summary():
    """Bounded metadata for the wrapper's durable success or failure evidence."""
    return copy.deepcopy(_LAST_SUMMARY)


def _nanoseconds(value):
    match = _TIME.fullmatch(value) if type(value) is str else None
    _need(match is not None, 'HISTORY_TIMESTAMP_INVALID')
    try:
        instant = datetime.strptime(match[1], '%Y-%m-%dT%H:%M:%S')
    except ValueError:
        raise HistoryCaptureError('HISTORY_TIMESTAMP_INVALID') from None
    return calendar.timegm(instant.timetuple()) * 1_000_000_000 + int((match[2] or '').ljust(9, '0') or '0')


def _timestamp(value):
    seconds, nanos = divmod(value, 1_000_000_000)
    return datetime.fromtimestamp(seconds, timezone.utc).strftime('%Y-%m-%dT%H:%M:%S') + f'.{nanos:09d}Z'


def _run_query(ports, arguments, timeout):
    """Bound aggregate stdout/stderr while reading, before retaining any result.

    Killing an overflowing query stops only the read-only Docker logs client.
    Its interval is discarded and must be captured completely in smaller parts.
    The original host command bound remains unchanged.
    """
    _need(os.name == 'posix', 'HISTORY_POSIX_RUNNER_REQUIRED')
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    counts = {'stdout': 0, 'stderr': 0}
    process = selector = None
    exceeded = timed_out = False
    cleanup = True
    returncode = None
    try:
        process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, env=ports.ctx['ENV'], close_fds=True)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ, 'stdout')
        selector.register(process.stderr, selectors.EVENT_READ, 'stderr')
        deadline = time.monotonic() + timeout
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            for key, _mask in selector.select(min(remaining, 0.2)):
                available = QUERY_BYTES - sum(counts.values())
                block = os.read(key.fd, min(65536, available + 1))
                if not block:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                counts[key.data] += len(block)
                if sum(counts.values()) > QUERY_BYTES:
                    exceeded = True
                    break
                buffers[key.data].extend(block)
            if exceeded:
                break
        if exceeded or timed_out:
            process.kill()
        try:
            returncode = process.wait(timeout=max(0.1, min(5, deadline - time.monotonic())))
        except subprocess.TimeoutExpired:
            timed_out = True
            process.kill()
            returncode = process.wait(timeout=5)
    except Exception:
        if process is not None and process.poll() is None:
            try:
                process.kill()
                process.wait(timeout=5)
            except Exception:
                cleanup = False
        raise HistoryCaptureError('HISTORY_QUERY_TRANSPORT_FAILED', {
            'stdoutBytes': counts['stdout'], 'stderrBytes': counts['stderr'], 'byteBound': QUERY_BYTES,
            'partial': True, 'timeout': timed_out, 'helperCleanupComplete': cleanup}) from None
    finally:
        if selector is not None:
            selector.close()
        if process is not None:
            for stream in (process.stdout, process.stderr):
                if stream is not None:
                    stream.close()
    return {'returncode': returncode, 'stdout': bytes(buffers['stdout']), 'stderr': bytes(buffers['stderr']),
            'stdoutBytes': counts['stdout'], 'stderrBytes': counts['stderr'], 'byteBound': QUERY_BYTES,
            'outputLimitExceeded': exceeded, 'timeout': timed_out,
            'partial': exceeded or timed_out, 'helperCleanupComplete': cleanup}


def _container(ports, container_id):
    ports.inspect_backend(container_id)
    template = ('{"id":{{json .Id}},"logging":{{json .HostConfig.LogConfig}},'
                '"created":{{json .Created}},"started":{{json .State.StartedAt}}}')
    observed = json.loads(ports._run(ports.ctx['DOCKER'] + [
        'container', 'inspect', '--format', template, container_id], timeout=20).stdout)
    _need(observed.get('id') == container_id and observed.get('logging') ==
          {'Type': 'json-file', 'Config': {'max-size': '5m', 'max-file': '2'}},
          'HISTORY_LOG_CONTRACT_CHANGED')
    _need(_nanoseconds(observed.get('created')) <= _nanoseconds(observed.get('started')),
          'HISTORY_CONTAINER_TIMESTAMPS_INVALID')
    return observed


def _records(raw, lower, upper, max_line):
    """Disjoint half-open intervals preserve multiplicity without deduping data."""
    result = []
    for line in raw.splitlines(keepends=True):
        _need(len(line.rstrip(b'\r\n')) <= max_line, 'HISTORY_LINE_BOUNDS_EXCEEDED')
        match = _RECORD.match(line)
        _need(match is not None, 'HISTORY_RECORD_TIMESTAMP_REQUIRED')
        at = _nanoseconds(match[1].decode('ascii'))
        if lower <= at < upper:
            result.append(line)
    return result


def historical_capture(ports, container_id, capture):
    """Collect all retained lifetime history plus the coordinator's live overlap."""
    global _LAST_SUMMARY
    _LAST_SUMMARY = {'transportComplete': False, 'commands': 0, 'queries': [], 'rawLogsPersisted': False}
    started_at = time.monotonic()
    deadline = started_at + MAX_WALL_SECONDS
    observed = _container(ports, container_id)
    lower = _nanoseconds(observed['created'])
    cutoff = ports.now().astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')
    upper = _nanoseconds(cutoff) + 1
    _need(lower < upper and _nanoseconds(observed['started']) < upper, 'HISTORY_CUTOFF_INVALID')
    summary = {'version': 1, 'commands': 0, 'splitIntervals': 0, 'acceptedIntervals': 0,
               'acceptedBytes': 0, 'records': 0, 'queryByteBound': QUERY_BYTES,
               'maximumCommands': MAX_COMMANDS, 'maximumWallSeconds': MAX_WALL_SECONDS,
               'lifetimeStartsAt': observed['created'], 'currentStartedAt': observed['started'],
               'cutoff': cutoff, 'containerLifetimeScope': True, 'transportComplete': False,
               'rawLogsPersisted': False, 'queries': []}
    _LAST_SUMMARY = summary
    pages = []
    ignored = rejected = sanitized_bytes = 0
    batch = {'stdout': bytearray(), 'stderr': bytearray()}
    lines = {'stdout': 0, 'stderr': 0}

    def flush(stream):
        nonlocal ignored, rejected, sanitized_bytes
        if not batch[stream]:
            return
        safe = capture.sanitize_streams(capture.LogStreams(
            bytes(batch[stream]) if stream == 'stdout' else b'',
            bytes(batch[stream]) if stream == 'stderr' else b''))
        ignored += safe['ignoredLines']
        rejected += safe['rejectedEvents']
        _need(safe['reason'] != 'input_limit_exceeded', 'HISTORY_SANITIZER_BOUNDS_EXCEEDED')
        if safe['events'] or safe['rejectedEvents']:
            sanitized_bytes += len(json.dumps(safe, separators=(',', ':'), ensure_ascii=False).encode())
            _need(sanitized_bytes <= MAX_SANITIZED_BYTES, 'HISTORY_SANITIZED_PAGE_BOUNDS_EXCEEDED')
            pages.append(safe)
        batch[stream] = bytearray()
        lines[stream] = 0

    def retain(stream, records):
        for line in records:
            if (lines[stream] >= min(capture.MAX_LINES, capture.MAX_EVENTS)
                    or len(batch[stream]) + len(line) > capture.MAX_BYTES_PER_STREAM):
                flush(stream)
            _need(len(line) <= capture.MAX_BYTES_PER_STREAM, 'HISTORY_SANITIZER_LINE_BOUNDS_EXCEEDED')
            batch[stream].extend(line)
            lines[stream] += 1
            summary['records'] += 1

    def interval(start, end):
        remaining = deadline - time.monotonic()
        _need(remaining > 0, 'HISTORY_COMPLETE_CAPTURE_DEADLINE_EXCEEDED', summary)
        _need(summary['commands'] < MAX_COMMANDS, 'HISTORY_COMMAND_BOUNDS_EXCEEDED', summary)
        # One nanosecond of lower overlap makes both inclusive and exclusive
        # Docker endpoint comparisons safe. Filtering below restores [start,end).
        arguments = ports.ctx['DOCKER'] + ['logs', '--timestamps', '--since', _timestamp(start - 1),
                     '--until', _timestamp(end), '--tail', 'all', container_id]
        summary['commands'] += 1
        query = _run_query(ports, arguments, min(QUERY_SECONDS, remaining))
        metadata = {key: query[key] for key in ('returncode', 'stdoutBytes', 'stderrBytes', 'byteBound',
                    'outputLimitExceeded', 'timeout', 'partial', 'helperCleanupComplete')}
        summary['queries'].append(metadata)
        _need(query['helperCleanupComplete'], 'HISTORY_QUERY_HELPER_CLEANUP_FAILED', metadata)
        _need(not query['timeout'], 'HISTORY_QUERY_TIMEOUT', metadata)
        if query['outputLimitExceeded']:
            _need(end - start > 1, 'HISTORY_SINGLE_TIMESTAMP_OUTPUT_BOUNDS_EXCEEDED', metadata)
            summary['splitIntervals'] += 1
            middle = (start + end) // 2
            del query  # Do not retain partial parent buffers during recursion.
            interval(start, middle)
            interval(middle, end)
            return
        _need(query['returncode'] == 0 and not query['partial'], 'HISTORY_QUERY_NONZERO_EXIT', metadata)
        _need(len(query['stdout']) + len(query['stderr']) <= QUERY_BYTES,
              'HISTORY_QUERY_BOUND_VIOLATION', metadata)
        accepted = {stream: _records(query[stream], start, end, capture.MAX_LINE_BYTES)
                    for stream in ('stdout', 'stderr')}
        count = sum(len(line) for records in accepted.values() for line in records)
        summary['acceptedBytes'] += count
        _need(summary['acceptedBytes'] <= MAX_RETAINED_BYTES, 'HISTORY_RETAINED_OUTPUT_BOUNDS_EXCEEDED', summary)
        summary['acceptedIntervals'] += 1
        for stream in ('stdout', 'stderr'):
            retain(stream, accepted[stream])

    cursor = lower
    while cursor < upper:
        end = min(cursor + WINDOW_NS, upper)
        interval(cursor, end)
        cursor = end
    flush('stdout')
    flush('stderr')
    _need(_container(ports, container_id) == observed, 'HISTORY_CONTAINER_CHANGED_DURING_CAPTURE')
    summary.update(transportComplete=True, ignoredLines=ignored, rejectedEvents=rejected,
                   sanitizedPages=len(pages), sanitizedBytes=sanitized_bytes)
    return {'pages': pages, 'rawBytesObserved': summary['acceptedBytes'], 'ignoredLines': ignored,
            'rejectedEvents': rejected, 'cutoff': cutoff, 'transportComplete': True}


def install(update):
    """Bind this collector only after checking the exact frozen original function."""
    original = inspect.getsource(update.historical_capture).replace('\r\n', '\n').encode()
    _need(hashlib.sha256(original).hexdigest() == ORIGINAL_FUNCTION_SHA256,
          'HISTORY_FROZEN_ORIGINAL_FUNCTION_CHANGED')
    update.historical_capture = historical_capture
    return update

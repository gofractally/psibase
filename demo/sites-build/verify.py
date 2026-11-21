#!/usr/bin/env python3
"""Native conditional-GET regression across a policy-only update and upgrade."""
import hashlib
import http.client
import json
from pathlib import Path
import subprocess
import sys

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
CLI = ROOT / 'rust/target/release/psibase'
API = 'http://psibase.localhost:8089/'
HOST = 'cachetest.psibase.localhost:8089'
TARGET = '/policy-probe.html'
POLICY_A = "default-src 'none'; frame-ancestors 'self';"
POLICY_B = "default-src 'none'; frame-ancestors http://supervisor.psibase.localhost:8089;"

def action(method, data):
    result = subprocess.run([str(CLI), 'push', '-a', API, '--trace', 'json', '--console=false', '-'],
        input=json.dumps([{'sender': 'cachetest', 'service': 'sites', 'method': method, 'data': data}]),
        text=True, capture_output=True, check=True)
    assert json.loads(result.stdout).get('error') is None

def fetch(method='GET', etag=None):
    connection = http.client.HTTPConnection('127.0.0.1', 8089, timeout=30)
    headers = {'Host': HOST, 'Accept-Encoding': 'identity'}
    if etag is not None:
        headers['If-None-Match'] = etag
    connection.request(method, TARGET, headers=headers)
    response = connection.getresponse()
    body = response.read()
    result = {'status': response.status, 'headers': {k.lower(): v for k, v in response.getheaders()},
              'body_length': len(body), 'body_sha256': hashlib.sha256(body).hexdigest()}
    connection.close()
    return result

if sys.argv[1] == 'prepare':
    content = b'<!doctype html><title>Native CSP cache regression</title><p>Unchanged content.</p>\n'
    (OUT / 'policy-probe.html').write_bytes(content)
    subprocess.run([str(CLI), 'upload', '-a', API, '-S', 'cachetest', str(OUT / 'policy-probe.html'), TARGET], check=True, capture_output=True)
    action('enableCache', {'enable': True})
    action('setCsp', {'path': TARGET, 'csp': POLICY_A})
    initial = fetch()
    assert initial['status'] == 200 and initial['headers']['content-security-policy'] == POLICY_A
    baseline304 = fetch(etag=initial['headers']['etag'])
    assert baseline304['status'] == 304
    (OUT / 'before-upgrade.json').write_text(json.dumps({'initial': initial, 'conditional': baseline304}, indent=2) + '\n')
    print('Prepared existing Sites content/settings and conditional response baseline')
else:
    before = json.loads((OUT / 'before-upgrade.json').read_text())
    initial = before['initial']
    retained = fetch()
    assert retained['status'] == 200
    for key in ('body_length', 'body_sha256'):
        assert retained[key] == initial[key]
    assert retained['headers']['etag'] == initial['headers']['etag']
    assert retained['headers']['content-security-policy'] == POLICY_A
    conditional_a = fetch(etag=initial['headers']['etag'])
    assert conditional_a['status'] == 304
    assert conditional_a['headers']['content-security-policy'] == POLICY_A
    assert conditional_a['headers']['cache-control'] == 'no-cache'
    action('setCsp', {'path': TARGET, 'csp': POLICY_B})
    conditional_b = fetch(etag=initial['headers']['etag'])
    assert conditional_b['status'] == 304 and conditional_b['body_length'] == 0
    assert conditional_b['headers']['etag'] == initial['headers']['etag']
    assert conditional_b['headers']['content-security-policy'] == POLICY_B
    assert conditional_b['headers']['cache-control'] == 'no-cache'
    unchanged = fetch()
    assert unchanged['status'] == 200
    assert unchanged['body_sha256'] == initial['body_sha256']
    assert unchanged['headers']['etag'] == initial['headers']['etag']
    assert unchanged['headers']['content-security-policy'] == POLICY_B
    head = fetch('HEAD', initial['headers']['etag'])
    assert head['status'] == 304 and head['body_length'] == 0
    assert head['headers']['content-security-policy'] == POLICY_B
    assert head['headers']['cache-control'] == 'no-cache'
    action('enableCache', {'enable': False})
    disabled = fetch(etag=initial['headers']['etag'])
    assert disabled['status'] == 200 and disabled['body_sha256'] == initial['body_sha256']
    action('enableCache', {'enable': True})
    (OUT / 'verification.json').write_text(json.dumps({'content_settings_retained': True,
        'conditional_a': conditional_a, 'conditional_after_policy_update': conditional_b,
        'unchanged_200': unchanged, 'conditional_head': head, 'cache_disabled': disabled}, indent=2) + '\n')
    print('Sites 304 current policy/cache headers, unchanged content/ETag, preserved settings PASS')

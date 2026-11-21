#!/usr/bin/env python3
"""Verify native CommonApi routing/cookie CORS using a disposable probe cookie."""
import http.client
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
HOST = 'tokens.psibase.localhost'
SUPERVISOR = 'http://supervisor.psibase.localhost:8089'
FOREIGN = 'http://exchange.psibase.localhost:8089'
RESULTS = []

def request(label, method, target, payload=None, origin=None, content_type='application/json', extra=None):
    headers = {'Host': HOST}
    if origin:
        headers['Origin'] = origin
    if payload is not None:
        headers['Content-Type'] = content_type
    headers.update(extra or {})
    connection = http.client.HTTPConnection('127.0.0.1', 8089, timeout=30)
    connection.request(method, target, body=json.dumps(payload) if payload is not None else None, headers=headers)
    response = connection.getresponse()
    body = response.read().decode()
    result = {'test': label, 'status': response.status, 'headers': dict(response.getheaders()), 'body': body}
    RESULTS.append(result)
    connection.close()
    return response.status, {key.lower(): value for key, value in result['headers'].items()}, body

for path in ('/common/chainid', '/common/tapos/head', '/common/thisservice', '/common/rootdomain'):
    status, _, body = request(path, 'GET', path)
    assert status == 200, (path, status, body)
    value = json.loads(body)
    if path.endswith('chainid'):
        assert isinstance(value, str) and len(value) == 64
        int(value, 16)
    elif path.endswith('tapos/head'):
        assert 0 <= value['refBlockIndex'] <= 255
        assert 0 <= value['refBlockSuffix'] <= 2**32 - 1
    elif path.endswith('thisservice'):
        assert value == 'tokens'
    else:
        assert value == 'psibase.localhost'

probe = {'name': 'NATIVE-COMPAT-PROBE', 'value': 'probe', 'maxAge': 0, 'httpOnly': True}
status, headers, _ = request('supervisor POST cookie', 'POST', '/common/set-host-cookie', probe, SUPERVISOR)
assert status == 200
assert headers.get('access-control-allow-origin') == SUPERVISOR
assert headers.get('access-control-allow-credentials') == 'true'
cookie = headers.get('set-cookie', '')
assert cookie.startswith('__Host-NATIVE-COMPAT-PROBE=probe;')
for attribute in ('Path=/', 'SameSite=Strict', 'Secure', 'Max-Age=0', 'HttpOnly'):
    assert attribute in cookie, attribute

status, headers, _ = request('supervisor OPTIONS', 'OPTIONS', '/common/set-host-cookie', origin=SUPERVISOR,
                             extra={'Access-Control-Request-Headers': 'content-type, authorization'})
assert status == 200
assert headers.get('access-control-allow-origin') == SUPERVISOR
assert headers.get('access-control-allow-credentials') == 'true'
assert headers.get('access-control-allow-headers') == 'content-type, authorization'

for method in ('OPTIONS', 'POST'):
    status, headers, _ = request(f'foreign {method} lacks credentialed CORS', method, '/common/set-host-cookie',
                                 probe if method == 'POST' else None, FOREIGN)
    assert status == 200
    assert 'access-control-allow-origin' not in headers
    assert 'access-control-allow-credentials' not in headers

for label, change in [('invalid cookie name', {'name': 'bad;name'}),
                       ('invalid cookie value', {'value': 'bad;value'}),
                       ('negative cookie lifetime', {'maxAge': -1})]:
    status, headers, _ = request(label, 'POST', '/common/set-host-cookie', probe | change, SUPERVISOR)
    assert status == 400
    assert 'set-cookie' not in headers
status, headers, _ = request('non-JSON body rejected', 'POST', '/common/set-host-cookie', probe, SUPERVISOR, 'text/plain')
assert status == 415
assert 'set-cookie' not in headers

(OUT / 'verification.json').write_text(json.dumps({'tests_passed': len(RESULTS), 'results': RESULTS}, indent=2) + '\n')
print(f'{len(RESULTS)} native CommonApi endpoint checks passed')

#!/usr/bin/env python3
"""Live native gateway regression; never prints or records bearer values."""
from pathlib import Path
import http.client
import json
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
API = 'http://psibase.localhost:8089/'
CLI = ROOT / 'rust/target/release/psibase'
login = subprocess.run([str(CLI), 'login', '-a', API, 'alice'], capture_output=True, text=True, check=True)
authorization = login.stdout.strip()
assert authorization.lower().startswith('bearer ')
token = authorization.split(' ', 1)[1]
authorization = 'Bearer ' + token
RESULTS = []

def request(label, headers, method='GET', expect_reject=False):
    connection = http.client.HTTPConnection('127.0.0.1', 8089, timeout=30)
    connection.putrequest(method, '/probe', skip_host=True)
    connection.putheader('Host', 'cookietest.psibase.localhost:8089')
    for name, value in headers:
        connection.putheader(name, value)
    connection.endheaders()
    response = connection.getresponse()
    body = response.read()
    result = {'test': label, 'status': response.status}
    if expect_reject:
        assert response.status >= 400
        # Do not retain an error body which might include transport diagnostics.
    elif method == 'OPTIONS':
        assert response.status == 200
        returned = {name.lower(): value for name, value in response.getheaders()}
        assert returned['access-control-allow-origin'] == '*'
        assert 'authorization' in returned['access-control-allow-headers'].lower().split(', ')[1:]
        assert 'access-control-allow-credentials' not in returned
        result['headers'] = returned
    else:
        assert response.status == 200
        data = json.loads(body)
        assert not data['authorization'] and not data['sessionCookie']
        assert token not in body.decode()
        result['probe'] = data
    RESULTS.append(result)
    connection.close()
    return result.get('probe')

data = request('real issued session cookie removed after valid bearer authentication', [
    ('Authorization', authorization), ('Cookie', f'theme=dark; __Host-SESSION={token}')])
assert data['user'] == 'alice' and data['theme'] == ['dark']
data = request('legacy session cookie authenticates before being removed', [
    ('Cookie', f'theme=dark; SESSION={token}')])
assert data['user'] == 'alice' and data['theme'] == ['dark']
data = request('duplicates across mixed-case Cookie headers removed', [
    ('Authorization', authorization),
    ('Cookie', f'__Host-SESSION={token}; __Host-SESSION={token}; theme=dark'),
    ('cOoKiE', f'__HOST-SESSION=legacy; SESSION=old; __Host-SESSION={token}; session=app')])
assert data['user'] == 'alice' and data['theme'] == ['dark'] and data['appSession'] == ['app']
data = request('every Authorization instance removed', [
    ('Authorization', authorization), ('aUtHoRiZaTiOn', authorization),
    ('Cookie', f'__Host-SESSION={token}; theme=dark')])
assert data['user'] == 'alice' and data['theme'] == ['dark']
data = request('whitespace cannot conceal session cookie after bearer auth', [
    ('Authorization', authorization), ('Cookie', f'__Host-SESSION \t={token}; theme=dark')])
assert data['user'] == 'alice' and data['theme'] == ['dark']
data = request('ordinary anonymous application cookies preserved', [('Cookie', 'theme=light; session=app')])
assert data['user'] is None and data['theme'] == ['light'] and data['appSession'] == ['app']
request('malformed cookie rejected before application RPC', [('Authorization', authorization), ('Cookie', 'dangling')], expect_reject=True)
request('generic preflight explicitly allows Authorization without credentials', [
    ('Origin', 'http://supervisor.psibase.localhost:8089'),
    ('Access-Control-Request-Method', 'POST'), ('Access-Control-Request-Headers', 'authorization, content-type')], 'OPTIONS')

(OUT / 'verification.json').write_text(json.dumps({'tests_passed': len(RESULTS), 'bearer_values_recorded': False, 'results': RESULTS}, indent=2) + '\n')
print(f'{len(RESULTS)} live native HttpServer credential/CORS checks passed')

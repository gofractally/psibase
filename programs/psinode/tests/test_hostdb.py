#!/usr/bin/python

import base64
import testutil
import unittest

MAX_VALUE_LEN = 100 * 1024 + 28
COOKIE_MAX_AGE = 400 * 24 * 60 * 60


def supervisor_origin(root):
    return f'https://supervisor.{root}'


def hex_key(n):
    return f'{n:064x}'


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def cookie_header(device, session=None):
    header = f'__Host-HOSTDB-DEVICE={device}'
    if session is not None:
        header += f'; __Host-HOSTDB-SESSION={session}'
    return header


def set_cookies(reply):
    values = reply.raw.headers.getlist('Set-Cookie')
    parsed = {}
    for value in values:
        name_value, attrs = value.split(';', 1)
        name, cookie = name_value.split('=', 1)
        parsed[name] = (cookie, attrs)
    return parsed


def assert_id_cookie(test, cookie, attrs, *, max_age=False):
    test.assertEqual(len(cookie), 32)
    test.assertTrue(all(c in '0123456789abcdef' for c in cookie))
    if max_age:
        test.assertEqual(
            attrs,
            f' Path=/; SameSite=Strict; Secure; Max-Age={COOKIE_MAX_AGE}; HttpOnly;',
        )
    else:
        test.assertEqual(attrs, ' Path=/; SameSite=Strict; Secure; HttpOnly;')


class TestHostDb(unittest.TestCase):
    @testutil.psinode_test
    def test_persistent(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer', 'HostDb'])
        root = a.hostname
        origin = supervisor_origin(root)
        api = a.new_api()

        def headers(device=None, **extra):
            result = {'Origin': origin}
            if device is not None:
                result['Cookie'] = cookie_header(device)
            result.update(extra)
            return result

        def device_cookie(reply):
            set_cookie = reply.headers.get('Set-Cookie')
            self.assertIsNotNone(set_cookie)
            prefix = '__Host-HOSTDB-DEVICE='
            self.assertTrue(set_cookie.startswith(prefix))
            value, attrs = set_cookie.split(';', 1)
            value = value[len(prefix):]
            self.assertEqual(
                attrs,
                f' Path=/; SameSite=Strict; Secure; Max-Age={COOKIE_MAX_AGE}; HttpOnly;',
            )
            self.assertEqual(len(value), 32)
            self.assertTrue(all(c in '0123456789abcdef' for c in value))
            return value

        key1 = hex_key(1)
        key2 = hex_key(2)
        value1 = b'hello\xffhostdb'
        value2 = b'second'

        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [
                {'duration': 'persistent', 'key': key1, 'value': b64url(value1)},
                {'duration': 'persistent', 'key': key2, 'value': b64url(value2)},
            ]},
            headers=headers(),
        ) as reply:
            self.assertEqual(reply.status_code, 204)
            self.assertEqual(reply.headers.get('Access-Control-Allow-Origin'), origin)
            self.assertEqual(reply.headers.get('Access-Control-Allow-Credentials'), 'true')
            device = device_cookie(reply)
        api.session.cookies.clear()

        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [{'duration': 'persistent', 'key': key1, 'value': b64url(b'other')}]},
            headers=headers(device),
        ) as reply:
            self.assertEqual(reply.status_code, 204)
            self.assertEqual(device_cookie(reply), device)
        api.session.cookies.clear()

        with api.get(f'/kv/persistent/{key1}', service='hostdb', headers=headers(device)) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.headers.get('Content-Type'), 'application/octet-stream')
            self.assertEqual(reply.content, b'other')
            self.assertEqual(device_cookie(reply), device)
        api.session.cookies.clear()

        with api.get(f'/kv/persistent/{key2}', service='hostdb', headers=headers(device)) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.content, value2)
        api.session.cookies.clear()

        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [
                {'duration': 'persistent', 'key': key1, 'value': None},
                {'duration': 'persistent', 'key': key2, 'value': None},
            ]},
            headers=headers(device),
        ) as reply:
            self.assertEqual(reply.status_code, 204)
        api.session.cookies.clear()

        with api.get(f'/kv/persistent/{key1}', service='hostdb', headers=headers(device)) as reply:
            self.assertEqual(reply.status_code, 404)
        api.session.cookies.clear()

        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [{'duration': 'persistent', 'key': key1, 'value': None}]},
            headers=headers(device),
        ) as reply:
            self.assertEqual(reply.status_code, 204)
        api.session.cookies.clear()

        missing = hex_key(9)
        with api.get(
            f'/kv/persistent/{missing}', service='hostdb', headers=headers(device)
        ) as reply:
            self.assertEqual(reply.status_code, 404)
        api.session.cookies.clear()

        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [{'duration': 'persistent', 'key': key1, 'value': b64url(value1)}]},
            headers=headers(device),
        ) as reply:
            self.assertEqual(reply.status_code, 204)
        api.session.cookies.clear()

        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [
                {'duration': 'persistent', 'key': key2, 'value': b64url(value2)},
                {'duration': 'persistent', 'key': 'zz' + 'a' * 62, 'value': b64url(b'nope')},
            ]},
            headers=headers(device),
        ) as reply:
            self.assertEqual(reply.status_code, 400)
        api.session.cookies.clear()

        with api.get(f'/kv/persistent/{key1}', service='hostdb', headers=headers(device)) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.content, value1)
        api.session.cookies.clear()
        with api.get(f'/kv/persistent/{key2}', service='hostdb', headers=headers(device)) as reply:
            self.assertEqual(reply.status_code, 404)
        api.session.cookies.clear()

        other = 'b' * 32
        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [{'duration': 'persistent', 'key': key1, 'value': b64url(b'isolated')}]},
            headers=headers(other),
        ) as reply:
            self.assertEqual(reply.status_code, 204)
            self.assertEqual(device_cookie(reply), other)
        api.session.cookies.clear()
        with api.get(f'/kv/persistent/{key1}', service='hostdb', headers=headers(other)) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.content, b'isolated')
        api.session.cookies.clear()
        with api.get(f'/kv/persistent/{key1}', service='hostdb', headers=headers(device)) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.content, value1)
        api.session.cookies.clear()

        with api.get(f'/kv/persistent/{key1}', service='hostdb') as reply:
            self.assertEqual(reply.status_code, 403)
            self.assertIsNone(reply.headers.get('Set-Cookie'))
        with api.get(
            f'/kv/persistent/{key1}',
            service='hostdb',
            headers={'Origin': 'https://evil.example.com'},
        ) as reply:
            self.assertEqual(reply.status_code, 403)
            self.assertIsNone(reply.headers.get('Access-Control-Allow-Origin'))
        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': []},
            headers={'Content-Type': 'application/json'},
        ) as reply:
            self.assertEqual(reply.status_code, 403)

        with api.get(
            '/kv/persistent/' + 'A' * 64, service='hostdb', headers=headers(device)
        ) as reply:
            self.assertEqual(reply.status_code, 400)
        api.session.cookies.clear()
        with api.get(
            '/kv/persistent/' + 'ab', service='hostdb', headers=headers(device)
        ) as reply:
            self.assertEqual(reply.status_code, 400)
        api.session.cookies.clear()

        oversize = b'\x01' * (MAX_VALUE_LEN + 1)
        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [
                {'duration': 'persistent', 'key': key2, 'value': b64url(b'kept-out')},
                {'duration': 'persistent', 'key': key1, 'value': b64url(oversize)},
            ]},
            headers=headers(device),
        ) as reply:
            self.assertEqual(reply.status_code, 400)
        api.session.cookies.clear()
        with api.get(f'/kv/persistent/{key1}', service='hostdb', headers=headers(device)) as reply:
            self.assertEqual(reply.content, value1)
        api.session.cookies.clear()
        with api.get(f'/kv/persistent/{key2}', service='hostdb', headers=headers(device)) as reply:
            self.assertEqual(reply.status_code, 404)
        api.session.cookies.clear()

        with api.request(
            'OPTIONS',
            '/kv/batch',
            service='hostdb',
            headers={
                'Origin': origin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type',
            },
        ) as reply:
            self.assertEqual(reply.status_code, 204)
            self.assertEqual(reply.headers.get('Access-Control-Allow-Origin'), origin)
            self.assertEqual(reply.headers.get('Access-Control-Allow-Credentials'), 'true')
            self.assertEqual(reply.headers.get('Access-Control-Allow-Methods'), 'GET, POST')
            self.assertEqual(reply.headers.get('Access-Control-Allow-Headers'), 'content-type')
        api.session.cookies.clear()

        with api.request(
            'OPTIONS',
            f'/kv/persistent/{key1}',
            service='hostdb',
            headers={'Origin': 'https://not-supervisor.example'},
        ) as reply:
            self.assertEqual(reply.status_code, 403)

    @testutil.psinode_test
    def test_session(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer', 'HostDb'])
        root = a.hostname
        origin = supervisor_origin(root)
        api = a.new_api()

        def headers(device=None, session=None, **extra):
            result = {'Origin': origin}
            if device is not None:
                result['Cookie'] = cookie_header(device, session)
            result.update(extra)
            return result

        def ids(reply):
            cookies = set_cookies(reply)
            device, device_attrs = cookies['__Host-HOSTDB-DEVICE']
            session, session_attrs = cookies['__Host-HOSTDB-SESSION']
            assert_id_cookie(self, device, device_attrs, max_age=True)
            assert_id_cookie(self, session, session_attrs)
            return device, session

        key_s = hex_key(1)
        key_s2 = hex_key(2)
        key_p = hex_key(3)
        value_s = b'session-one'
        value_p = b'persistent-one'

        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [
                {'duration': 'persistent', 'key': key_p, 'value': b64url(value_p)},
                {'duration': 'session', 'key': key_s, 'value': b64url(value_s)},
            ]},
            headers=headers(),
        ) as reply:
            self.assertEqual(reply.status_code, 204)
            self.assertEqual(reply.headers.get('Access-Control-Allow-Origin'), origin)
            self.assertEqual(reply.headers.get('Access-Control-Allow-Credentials'), 'true')
            device, session_a = ids(reply)
        api.session.cookies.clear()

        with api.get(
            f'/kv/session/{key_s}', service='hostdb', headers=headers(device, session_a)
        ) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.headers.get('Content-Type'), 'application/octet-stream')
            self.assertEqual(reply.content, value_s)
            self.assertEqual(ids(reply), (device, session_a))
        api.session.cookies.clear()

        with api.get(
            f'/kv/persistent/{key_p}', service='hostdb', headers=headers(device, session_a)
        ) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.content, value_p)
            self.assertNotIn('__Host-HOSTDB-SESSION', set_cookies(reply))
        api.session.cookies.clear()

        with api.get(f'/kv/session/{key_s}', service='hostdb', headers=headers(device)) as reply:
            self.assertEqual(reply.status_code, 404)
            echoed_device, session_b = ids(reply)
            self.assertEqual(echoed_device, device)
            self.assertNotEqual(session_b, session_a)
        api.session.cookies.clear()

        with api.get(
            f'/kv/session/{key_s}', service='hostdb', headers=headers(device, session_a)
        ) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.content, value_s)
        api.session.cookies.clear()

        with api.get(
            f'/kv/persistent/{key_p}', service='hostdb', headers=headers(device)
        ) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.content, value_p)
            self.assertNotIn('__Host-HOSTDB-SESSION', set_cookies(reply))
        api.session.cookies.clear()

        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [{'duration': 'session', 'key': key_s2, 'value': b64url(b'other-session')}]},
            headers=headers(device),
        ) as reply:
            self.assertEqual(reply.status_code, 204)
            echoed_device, session_c = ids(reply)
            self.assertEqual(echoed_device, device)
            self.assertNotEqual(session_c, session_a)
        api.session.cookies.clear()

        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [{'duration': 'session', 'key': key_s2, 'value': b64url(b'later')}]},
            headers=headers(device, session_a),
        ) as reply:
            self.assertEqual(reply.status_code, 204)
            self.assertEqual(ids(reply)[1], session_a)
        api.session.cookies.clear()

        with api.get(
            f'/kv/session/{key_s}', service='hostdb', headers=headers(device, session_a)
        ) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.content, value_s)
        api.session.cookies.clear()
        with api.get(
            f'/kv/session/{key_s2}', service='hostdb', headers=headers(device, session_c)
        ) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.content, b'other-session')
        api.session.cookies.clear()
        with api.get(
            f'/kv/session/{key_s2}', service='hostdb', headers=headers(device, session_a)
        ) as reply:
            self.assertEqual(reply.status_code, 200)
            self.assertEqual(reply.content, b'later')
        api.session.cookies.clear()

        with api.post(
            '/kv/batch',
            service='hostdb',
            json={'ops': [
                {'duration': 'session', 'key': key_s, 'value': b64url(b'replaced')},
                {'duration': 'persistent', 'key': 'zz' + 'a' * 62, 'value': b64url(b'nope')},
            ]},
            headers=headers(device, session_a),
        ) as reply:
            self.assertEqual(reply.status_code, 400)
        api.session.cookies.clear()
        with api.get(
            f'/kv/session/{key_s}', service='hostdb', headers=headers(device, session_a)
        ) as reply:
            self.assertEqual(reply.content, value_s)
        api.session.cookies.clear()
        with api.get(
            f'/kv/persistent/{key_p}', service='hostdb', headers=headers(device)
        ) as reply:
            self.assertEqual(reply.content, value_p)
        api.session.cookies.clear()

        with api.get(
            '/kv/session/' + 'ab', service='hostdb', headers=headers(device, session_a)
        ) as reply:
            self.assertEqual(reply.status_code, 400)
        api.session.cookies.clear()
        with api.get(
            f'/kv/session/{hex_key(9)}', service='hostdb', headers=headers(device, session_a)
        ) as reply:
            self.assertEqual(reply.status_code, 404)
        api.session.cookies.clear()

        with api.request(
            'OPTIONS',
            f'/kv/session/{key_s}',
            service='hostdb',
            headers={
                'Origin': origin,
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'content-type',
            },
        ) as reply:
            self.assertEqual(reply.status_code, 204)
            self.assertEqual(reply.headers.get('Access-Control-Allow-Methods'), 'GET, POST')
            self.assertNotIn('__Host-HOSTDB-SESSION', set_cookies(reply))
        api.session.cookies.clear()


if __name__ == '__main__':
    testutil.main()

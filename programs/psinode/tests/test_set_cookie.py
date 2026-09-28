#!/usr/bin/python

import testutil
import unittest

ENDPOINT = '/common/set-cookie'


def supervisor_origin(root):
    return f'https://supervisor.{root}'


def set_cookie_headers(root):
    return {
        'Origin': supervisor_origin(root),
        'Content-Type': 'application/json',
    }


class TestSetCookie(unittest.TestCase):
    @testutil.psinode_test
    def test_set_cookie(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer'])
        root = a.hostname
        headers = set_cookie_headers(root)

        with a.post(
            ENDPOINT,
            service='accounts',
            json={
                'name': 'SESSION',
                'value': 'test-token',
                'maxAge': 3600,
                'httpOnly': True,
            },
            headers=headers,
        ) as reply:
            reply.raise_for_status()
            self.assertEqual(
                reply.headers.get('Set-Cookie'),
                '__Host-SESSION=test-token; Path=/; SameSite=Strict; Secure; Max-Age=3600; HttpOnly;',
            )
            self.assertEqual(
                reply.headers.get('Access-Control-Allow-Origin'),
                supervisor_origin(root),
            )
            self.assertEqual(
                reply.headers.get('Access-Control-Allow-Credentials'),
                'true',
            )

        with a.post(
            ENDPOINT,
            service='accounts',
            json={
                'name': 'SESSION',
                'value': 'plain',
                'maxAge': 60,
                'httpOnly': False,
            },
            headers=headers,
        ) as reply:
            reply.raise_for_status()
            self.assertEqual(
                reply.headers.get('Set-Cookie'),
                '__Host-SESSION=plain; Path=/; SameSite=Strict; Secure; Max-Age=60;',
            )

        with a.post(
            ENDPOINT,
            service='accounts',
            json={
                'name': 'SESSION',
                'value': '',
                'maxAge': 0,
                'httpOnly': True,
            },
            headers=headers,
        ) as reply:
            reply.raise_for_status()
            self.assertEqual(
                reply.headers.get('Set-Cookie'),
                '__Host-SESSION=; Path=/; SameSite=Strict; Secure; Max-Age=0; HttpOnly;',
            )

        with a.request(
            'OPTIONS',
            ENDPOINT,
            service='accounts',
            headers={
                'Origin': supervisor_origin(root),
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type',
            },
        ) as reply:
            reply.raise_for_status()
            self.assertEqual(
                reply.headers.get('Access-Control-Allow-Origin'),
                supervisor_origin(root),
            )
            self.assertEqual(
                reply.headers.get('Access-Control-Allow-Credentials'),
                'true',
            )
            self.assertEqual(
                reply.headers.get('Access-Control-Allow-Headers'),
                'content-type',
            )

        with a.post(
            ENDPOINT,
            service='accounts',
            json={
                'name': 'SESSION',
                'value': 'ignored',
                'maxAge': 60,
                'httpOnly': False,
            },
            headers={
                'Origin': 'https://evil.example.com',
                'Content-Type': 'application/json',
            },
        ) as reply:
            reply.raise_for_status()
            self.assertIsNone(reply.headers.get('Access-Control-Allow-Origin'))

        invalid_bodies = [
            {'name': '', 'value': 'x', 'maxAge': 1, 'httpOnly': False},
            {'name': 'bad_name', 'value': 'x', 'maxAge': 1, 'httpOnly': False},
            {'name': 'SESSION', 'value': 'has;semi', 'maxAge': 1, 'httpOnly': False},
            {'name': 'SESSION', 'value': 'has,comma', 'maxAge': 1, 'httpOnly': False},
            {'name': 'SESSION', 'value': 'has space', 'maxAge': 1, 'httpOnly': False},
            {'name': 'SESSION', 'value': 'tab\there', 'maxAge': 1, 'httpOnly': False},
            {'name': 'SESSION', 'value': 'ok', 'maxAge': -1, 'httpOnly': False},
        ]
        for body in invalid_bodies:
            with a.post(
                ENDPOINT,
                service='accounts',
                json=body,
                headers=headers,
            ) as reply:
                self.assertEqual(reply.status_code, 400)


if __name__ == '__main__':
    unittest.main()

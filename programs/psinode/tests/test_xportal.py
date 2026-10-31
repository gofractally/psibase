#!/usr/bin/python

import testutil
import unittest
import threading
import json
import base64
import hashlib
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

GOOD_CODE = 'good-code'
ACCESS_TOKEN = 'access-1'
X_USER = {'id': '2244994945', 'name': 'X Dev', 'username': 'XDevelopers'}

class MockX(BaseHTTPRequestHandler):
    '''Answers X's token and users/me endpoints, recording each request'''
    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length'])).decode()
        form = urllib.parse.parse_qs(body)
        self.server.token_requests.append({
            'path': self.path,
            'authorization': self.headers['Authorization'],
            'content_type': self.headers['Content-Type'],
            'form': form,
        })
        if self.path == '/2/oauth2/token' and form.get('code') == [GOOD_CODE]:
            self.reply(200, {'token_type': 'bearer', 'expires_in': 7200, 'access_token': ACCESS_TOKEN, 'scope': 'users.read tweet.read'})
        else:
            self.reply(400, {'error': 'invalid_request'})

    def do_GET(self):
        self.server.user_requests.append((self.path, self.headers['Authorization']))
        if self.path == '/2/users/me' and self.headers['Authorization'] == 'Bearer ' + ACCESS_TOKEN:
            self.reply(200, {'data': X_USER})
        else:
            self.reply(401, {'title': 'Unauthorized'})

    def log_message(self, format, *args):
        pass

def code_challenge(verifier):
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b'=').decode()

class TestXPortal(unittest.TestCase):
    @testutil.psinode_test
    def test_x_signin(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer'])
        a.install_local(['XPortal'])

        portal = 'http://x-portal.psibase.localhost'
        def get(path, **kw):
            return a.session.get(portal + path, allow_redirects=False, timeout=10, **kw)
        def configure_x(api_base):
            with a.put('/admin/config', service='x-portal', json={'x': {'client_id': 'client-id', 'client_secret': 'client-secret', 'api_base': api_base}}) as reply:
                reply.raise_for_status()
        def start():
            reply = get('/auth/x/start')
            self.assertEqual(reply.status_code, 302)
            location = urllib.parse.urlsplit(reply.headers['Location'])
            self.assertEqual((location.scheme, location.netloc, location.path), ('https', 'x.com', '/i/oauth2/authorize'))
            return dict(urllib.parse.parse_qsl(location.query))

        server = HTTPServer(('127.0.0.1', 0), MockX)
        server.token_requests = []
        server.user_requests = []
        t = threading.Thread(target=server.serve_forever)
        t.start()
        try:
            configure_x('http://127.0.0.1:%d' % server.server_address[1])

            authorize = start()
            self.assertEqual(authorize['redirect_uri'], portal + '/auth/x/callback')
            self.assertEqual(authorize['client_id'], 'client-id')
            self.assertEqual(authorize['scope'], 'users.read tweet.read')

            callback = get('/auth/x/callback', params={'code': GOOD_CODE, 'state': authorize['state']})
            self.assertEqual(callback.status_code, 302)
            self.assertEqual(callback.headers['Location'], '/')
            cookie = callback.headers['Set-Cookie']
            self.assertRegex(cookie, r'^XPORTAL_SESSION=[A-Za-z0-9_-]{43}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax$')

            (token_request,) = server.token_requests
            self.assertEqual(token_request['path'], '/2/oauth2/token')
            self.assertEqual(token_request['authorization'], 'Basic ' + base64.b64encode(b'client-id:client-secret').decode())
            self.assertEqual(token_request['content_type'], 'application/x-www-form-urlencoded')
            form = token_request['form']
            self.assertEqual(form['grant_type'], ['authorization_code'])
            self.assertEqual(form['redirect_uri'], [authorize['redirect_uri']])
            self.assertEqual(code_challenge(form['code_verifier'][0]), authorize['code_challenge'])
            self.assertEqual(server.user_requests, [('/2/users/me', 'Bearer ' + ACCESS_TOKEN)])

            session = cookie.split(';')[0]
            with get('/me', headers={'Cookie': session}) as reply:
                reply.raise_for_status()
                self.assertEqual(reply.json(), {'x_id': X_USER['id'], 'handle': X_USER['username']})

            replay = get('/auth/x/callback', params={'code': GOOD_CODE, 'state': authorize['state']})
            self.assertEqual(replay.status_code, 400)

            rejected = get('/auth/x/callback', params={'code': 'bad-code', 'state': start()['state']})
            self.assertEqual(rejected.status_code, 502)
            self.assertNotIn('Set-Cookie', rejected.headers)

            with a.session.post(portal + '/auth/logout', headers={'Cookie': session}, timeout=10) as reply:
                reply.raise_for_status()
                self.assertIn('Max-Age=0', reply.headers['Set-Cookie'])
            self.assertEqual(get('/me', headers={'Cookie': session}).status_code, 401)
        finally:
            server.shutdown()
            t.join()
            server.server_close()

        configure_x('http://127.0.0.1:%d' % server.server_address[1])
        unreachable = get('/auth/x/callback', params={'code': GOOD_CODE, 'state': start()['state']})
        self.assertEqual(unreachable.status_code, 502)

        with a.get('/auth/x/start', service='x-portal', allow_redirects=False) as reply:
            self.assertEqual(reply.status_code, 302)
            location = urllib.parse.urlsplit(reply.headers['Location'])
            redirect_uri = dict(urllib.parse.parse_qsl(location.query))['redirect_uri']
            self.assertEqual(redirect_uri, 'https://x-portal.%s/auth/x/callback' % a.hostname)

if __name__ == '__main__':
    testutil.main()

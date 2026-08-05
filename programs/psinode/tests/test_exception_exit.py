#!/usr/bin/python

from predicates import *
import testutil
import unittest
import os
import time
from fracpack import *
from psibase import *
from threading import Thread, Semaphore
from requests import ConnectionError
from http.server import *
import urllib3
import websockets

# Since this test stops psinode with an error, we want
# sanitizer errors to cause a signal instead to fail the test.
ENV = {'ASAN_OPTIONS': 'abort_on_error=1'}

expected = "Lorem ipsum dolor sit amet"

def websocket_url(node, path='/', service=None):
    url = urllib3.util.parse_url(node.url)
    if service is not None:
        host = service + '.' + url.host
    else:
        host = url.host
    return urllib3.util.Url('ws', url.auth, host, url.port, path).url

async def echo(connection):
    async for msg in connection:
        await connection.send(msg)

class TestExceptionExit(unittest.TestCase):
    @testutil.psinode_test
    def test_incoming_request(self, cluster):
        (a,) = cluster.complete('a', env=ENV)
        a.boot(packages=['Minimal', 'Explorer'])
        a.install(packages=['KeepSocket'], sources=[testutil.test_packages()])
        a.wait(new_block())

        def long_query(api):
            try:
                api.get('/', service='s-keepsock')
            except ConnectionError:
                pass

        t = Thread(target=long_query, args=(a.new_api(),))
        t.start()
        self.cause_exception(a)
        t.join()

    @testutil.psinode_test
    def test_proxy_request(self, cluster):
        (a,) = cluster.complete('a', env=ENV)
        a.boot(packages=['Minimal', 'Explorer'])
        a.install_local(['XProxy'])

        sem = Semaphore(0)
        class RequestHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                sem.acquire()
                body = expected.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = HTTPServer(('', 0), RequestHandler)
        t = Thread(target=server.serve_forever)
        t.start()
        try:
            with a.post('/set_origin_server', service='x-proxy', json={"subdomain":"x-proxy", "host":"localhost:%d" % server.server_address[1]}) as reply:
                reply.raise_for_status()

            def long_query(api):
                try:
                    api.get('/', service='x-proxy')
                except ConnectionError:
                    pass

            t2 = Thread(target=long_query, args=(a.new_api(),))
            t2.start()
            time.sleep(0.5)
            self.cause_exception(a)
            t2.join()
            sem.release()
        finally:
            server.shutdown()
            t.join()
            server.server_close()

    @testutil.psinode_test
    async def test_proxy_websocket(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1), env=ENV)
        a.boot(packages=['Minimal', 'Explorer'])
        a.install_local(['XProxy'])

        async with websockets.serve(echo, host='127.0.0.1', port=0) as server:
            with a.post('/set_origin_server', service='x-proxy', json={"subdomain":"x-proxy", "host":"localhost:%d" % server.sockets[0].getsockname()[1]}) as reply:
                reply.raise_for_status()

            url = websocket_url(a, '/', service='x-proxy')
            try:
                async with websockets.unix_connect(a.socketpath, url, compression=None) as websocket:
                    # Send a round-trip message, to make sure that the connection
                    # is fully established
                    await websocket.send(expected)
                    self.assertEqual(await websocket.recv(), expected)

                    self.cause_exception(a)
            except websockets.exceptions.ConnectionClosedError:
                # the connection is closed abnormally when the node exits
                pass

    @testutil.psinode_test
    def test_incoming_p2p(self, cluster):
        (a, b) = cluster.disconnected(*testutil.generate_names(2), env=ENV)
        a.boot(packages=['Minimal', 'Explorer'])
        b.connect(a)
        b.wait(new_block())
        self.cause_exception(a)

    @testutil.psinode_test
    def test_outgoing_p2p(self, cluster):
        (a, b) = cluster.disconnected(*testutil.generate_names(2), env=ENV)
        a.boot(packages=['Minimal', 'Explorer'])
        a.connect(b)
        b.wait(new_block())
        self.cause_exception(a)

    def cause_exception(self, node):
        try:
            node.push_action('transact', 'setcode', 'setcode', {"service":"transact","vmType":0, "vmVersion":0, "code": "DEADBEEF"})
        except ConnectionError:
            pass

        code = node.child.wait(timeout=10)
        self.assertEqual(code, 1)

if __name__ == '__main__':
    testutil.main()

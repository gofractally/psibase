#!/usr/bin/python

import testutil
import unittest
import os
import threading
import datetime
from services import XAdmin
from http.server import *
import ssl
import socket

expected = "Lorem ipsum dolor sit amet"

class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = expected.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

class NotUtf8Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = expected.encode('utf-8')
        self.send_response(200)
        # http.server writes header values as latin-1: the bytes FF FE
        self.send_header('Content-Type', '\xff\xfe')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def raw_request(socketpath, request):
    """Sends bytes to the node and returns the status code of the reply, or None if
    the node closed the connection without one."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.settimeout(10)
        sock.connect(socketpath)
        sock.sendall(request)
        data = b''
        while b'\r\n' not in data:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
    if not data.startswith(b'HTTP/1.1 '):
        return None
    return int(data[9:12])

class HTTPSServer(HTTPServer):
    def __init__(self, certfile):
        self.certfile = certfile
        super().__init__(('', 0), RequestHandler)
    def server_activate(self):
        super().server_activate()
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(self.certfile)
        self.base_socket = self.socket
        self.socket = context.wrap_socket(self.socket, server_side=True)

def make_certificate(filename):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    builder = x509.CertificateBuilder()
    builder = builder.subject_name(subject)
    builder = builder.issuer_name(subject)
    builder = builder.public_key(key.public_key())
    builder = builder.serial_number(x509.random_serial_number())
    now = datetime.datetime.now(datetime.timezone.utc)
    builder = builder.not_valid_before(now)
    builder = builder.not_valid_after(now + datetime.timedelta(hours=1))
    cert = builder.sign(key, hashes.SHA256())
    with open(filename, "wb") as f:
        f.write(cert.public_bytes(Encoding.PEM))
        f.write(key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))

class TestFetch(unittest.TestCase):
    @testutil.psinode_test
    def test_proxy(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        a.install_local(['XProxy'])

        with a.post('/set_origin_server', service='x-proxy', json={"subdomain":"x-proxy", "host":"x-admin.%s" % a.hostname, "endpoint": a.socketpath, "spin": 100000}) as reply:
            reply.raise_for_status()

        with a.get('/config', service='x-proxy') as reply:
            reply.raise_for_status()
            cfg = reply.json()

        self.assertEqual(cfg, XAdmin(a).get_config())

    @testutil.psinode_test
    def test_http(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        a.install_local(['XProxy'])

        server = HTTPServer(('', 0), RequestHandler)

        t = threading.Thread(target=server.serve_forever)
        t.start()
        try:
            with a.post('/set_origin_server', service='x-proxy', json={"subdomain":"x-proxy", "host":"localhost:%d" % server.server_address[1]}) as reply:
                reply.raise_for_status()

            with a.get('/', service='x-proxy') as reply:
                reply.raise_for_status()
                result = reply.text

            self.assertEqual(result, expected)
        finally:
            server.shutdown()
            t.join()
            server.server_close()

    @testutil.psinode_test
    def test_https(self, cluster):
        certfile = os.path.join(cluster.dir, "cert.pem")
        make_certificate(certfile)

        (a,) = cluster.complete(*testutil.generate_names(1), trustfile=certfile)

        a.install_local(['XProxy'])

        server = HTTPSServer(certfile)

        t = threading.Thread(target=server.serve_forever)
        t.start()
        try:
            with a.post('/set_origin_server', service='x-proxy', json={"subdomain":"x-proxy", "host":"localhost:%d" % server.server_address[1], "tls": {}}) as reply:
                reply.raise_for_status()

            with a.get('/', service='x-proxy') as reply:
                reply.raise_for_status()
                result = reply.text

            self.assertEqual(result, expected)
        finally:
            server.shutdown()
            t.join()
            server.server_close()

    @testutil.psinode_test
    def test_https_fail_cert(self, cluster):
        certfile = os.path.join(cluster.dir, "cert.pem")
        make_certificate(certfile)

        (a,) = cluster.complete(*testutil.generate_names(1))

        a.install_local(['XProxy'])

        server = HTTPSServer(certfile)

        t = threading.Thread(target=server.serve_forever)
        t.start()
        try:
            with a.post('/set_origin_server', service='x-proxy', json={"subdomain":"x-proxy", "host":"localhost:%d" % server.server_address[1], "tls": {}}) as reply:
                reply.raise_for_status()

            with a.get('/', service='x-proxy', timeout=4) as reply:
                status = reply.status_code

            self.assertEqual(status, 502)
        finally:
            server.shutdown()
            t.join()
            server.server_close()

    # host, method and contentType of HttpRequest, contentType of HttpReply and the
    # name of an HttpHeader are declared UTF-8. Bytes from the network that are not
    # UTF-8 must be answered with an error and must not stop the node.
    @testutil.psinode_test
    def test_request_not_utf8(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        host = ('x-admin.%s' % a.hostname).encode()

        okay = b'GET /config HTTP/1.1\r\nHost: ' + host + b'\r\nConnection: close\r\n\r\n'
        self.assertEqual(raw_request(a.socketpath, okay), 200)

        bad_host = b'GET /config HTTP/1.1\r\nHost: \xff\xfe.' + host + b'\r\nConnection: close\r\n\r\n'
        self.assertEqual(raw_request(a.socketpath, bad_host), 400)

        bad_content_type = (b'POST /config HTTP/1.1\r\nHost: ' + host +
                            b'\r\nContent-Type: text/\xff\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}')
        self.assertEqual(raw_request(a.socketpath, bad_content_type), 400)

        # A header name and a method are tokens (ASCII): the HTTP parser refuses the
        # request before it becomes an HttpRequest. Today the node closes the
        # connection without a reply, as for any request it cannot parse.
        bad_name = b'GET /config HTTP/1.1\r\nHost: ' + host + b'\r\nX-\xff: 1\r\nConnection: close\r\n\r\n'
        self.assertIn(raw_request(a.socketpath, bad_name), (400, None))

        bad_method = b'G\xffT /config HTTP/1.1\r\nHost: ' + host + b'\r\nConnection: close\r\n\r\n'
        self.assertIn(raw_request(a.socketpath, bad_method), (400, None))

        # The node still answers
        self.assertEqual(raw_request(a.socketpath, okay), 200)
        XAdmin(a).get_config()

    @testutil.psinode_test
    def test_reply_not_utf8(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        a.install_local(['XProxy'])

        server = HTTPServer(('', 0), NotUtf8Handler)

        t = threading.Thread(target=server.serve_forever)
        t.start()
        try:
            with a.post('/set_origin_server', service='x-proxy', json={"subdomain":"x-proxy", "host":"localhost:%d" % server.server_address[1]}) as reply:
                reply.raise_for_status()

            with a.get('/', service='x-proxy', timeout=10) as reply:
                status = reply.status_code

            # The response is treated as a failed read
            self.assertEqual(status, 502)
        finally:
            server.shutdown()
            t.join()
            server.server_close()

        # The node still answers
        XAdmin(a).get_config()

if __name__ == '__main__':
    testutil.main()

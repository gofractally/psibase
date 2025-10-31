#!/usr/bin/python

import testutil
import unittest
import os
import threading
import datetime
from services import XAdmin
from http.server import *
import ssl

expected = "Lorem ipsum dolor sit amet"

class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = expected.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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

        XAdmin(a).install(os.path.join(testutil.test_packages(), "XProxy.psi"))

        with a.post('/set_origin_server', service='x-proxy', json={"host":"x-admin.%s" % a.hostname, "endpoint": a.socketpath}) as reply:
            reply.raise_for_status()

        with a.get('/config', service='x-proxy') as reply:
            reply.raise_for_status()
            cfg = reply.json()

        self.assertEqual(cfg, XAdmin(a).get_config())

    @testutil.psinode_test
    def test_http(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        XAdmin(a).install(os.path.join(testutil.test_packages(), "XProxy.psi"))

        server = HTTPServer(('', 0), RequestHandler)

        t = threading.Thread(target=server.serve_forever)
        t.start()
        try:
            with a.post('/set_origin_server', service='x-proxy', json={"host":"localhost:%d" % server.server_address[1]}) as reply:
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
        (a,) = cluster.complete(*testutil.generate_names(1))

        XAdmin(a).install(os.path.join(testutil.test_packages(), "XProxy.psi"))

        certfile = os.path.join(cluster.dir, "cert.pem")
        make_certificate(certfile)

        server = HTTPSServer(certfile)

        t = threading.Thread(target=server.serve_forever)
        t.start()
        try:
            with a.post('/set_origin_server', service='x-proxy', json={"host":"localhost:%d" % server.server_address[1], "tls": {}}) as reply:
                reply.raise_for_status()

            with a.get('/', service='x-proxy') as reply:
                reply.raise_for_status()
                result = reply.text

                self.assertEqual(result, expected)
        finally:
            server.shutdown()
            t.join()
            server.server_close()

if __name__ == '__main__':
    testutil.main()

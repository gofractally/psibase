import socket
import urllib3
import requests
import subprocess
import os
import tempfile
import time
import datetime
import calendar
from hashlib import sha256
from collections import namedtuple
import json
import psio
from psibase import Action, Claim, Transaction, SignedTransaction, ServiceSchema

class _LocalConnection(urllib3.connection.HTTPConnection):
    def __init__(self, *args, **kwargs):
        self.socketpath = kwargs.pop('socketpath', None)
        super().__init__(*args, **kwargs)
    def connect(self):
        self.sock = socket.socket(family=socket.AF_UNIX)
        self.sock.connect(self.socketpath)

class _LocalConnectionPool(urllib3.HTTPConnectionPool):
    ConnectionCls = _LocalConnection

def _key_normalizer(request_context):
    context = request_context.copy()
    del context['socketpath']
    return urllib3.poolmanager.key_fn_by_scheme['http'](context)

class _LocalPoolManager(urllib3.PoolManager):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pool_classes_by_scheme = {'http':_LocalConnectionPool}
        self.key_fn_by_scheme = {'http': _key_normalizer}

class _LocalAdapter(requests.adapters.HTTPAdapter):
    def __init__(self, socketpath):
        self.socketpath = socketpath
        super().__init__()
    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        self.poolmanager = _LocalPoolManager(num_pools=connections, maxsize=maxsize, block=block, socketpath=self.socketpath)

class Cluster(object):
    '''Manages a cluster of psinode servers.'''
    def __init__(self, dir=None, **node_kw):
        '''
        Creates a new Cluster.

        If dir is None, the cluster will use a temporary directory.
        Addition keyword arguments will be used to construct every node.
        '''
        if dir is None:
            self.tempdir = tempfile.TemporaryDirectory()
            self.dir = self.tempdir.name
        else:
            self.dir = dir
        self.next_id = 0
        self.node_kw = node_kw
        self.nodes = {}
    def make_node(self, name=None, **kw):
        '''
        Creates a new Node in this cluster.

        If a name is not provided, the node will be a non-producing node.
        '''
        if name is None:
            self.next_id = self.next_id + 1
            hostname = str(self.next_id)
        else:
            hostname = name
        for (k,v) in self.node_kw.items():
            kw.setdefault(k, v)
        result = Node(dir=os.path.join(self.dir, hostname), hostname=hostname, producer=name, **kw)
        self.nodes[hostname] = result
        return result
    def disconnected(self, *names, **kw):
        '''Create a set of nodes with no connections'''
        return tuple(self.make_node(name, **kw) for name in names)
    def star(self, *names, **kw):
        '''Create a star graph with the first node in the center'''
        nodes = [self.make_node(name, **kw) for name in names]
        center = nodes[0]
        for node in nodes[1:]:
            node.connect(center)
        return tuple(nodes)
    def ring(self, *names, **kw):
        '''Creates nodes connected in a ring'''
        nodes = [self.make_node(name, **kw) for name in names]
        prev = nodes[-1]
        for node in nodes:
            prev.connect(node)
            prev = node
        return tuple(nodes)
    def complete(self, *names, **kw):
        '''Creates a fully connected group of nodes'''
        nodes = [self.make_node(name, **kw) for name in names]
        for a in nodes:
            for b in nodes:
                if a.dir < b.dir:
                    a.connect(b)
        return tuple(nodes)
    def line(self, *names, **kw):
        '''Creates nodes connected in a line'''
        nodes = [self.make_node(name, **kw) for name in names]
        prev = nodes[0]
        for node in nodes[1:]:
            prev.connect(node)
            prev = node
        return tuple(nodes)
    def __enter__(self):
        if hasattr(self, 'tempdir'):
            self.tempdir.__enter__()
        return self
    def __exit__(self, exc_type, exc_value, traceback):
        for child in self.nodes.values():
            child.close()
        if hasattr(self, 'tempdir'):
            self.tempdir.__exit__(exc_type, exc_value, traceback)

def _get_producer_claim(producer):
    if isinstance(producer, str):
        return {'name': producer, 'auth':{'service':'', 'rawData': ''}}
    elif isinstance(producer, Node):
        return {'name': producer.producer, 'auth':{'service':'', 'rawData': ''}}
    else:
        return producer

class ChainPackContext:
    '''Packs transactions, with the schemas of the services of a chain for the arguments of actions'''
    def __init__(self, api):
        self._api = api
        self._schemas = {}
    def pack_transaction(self, trx):
        '''The PSSZ of a Transaction. The arguments of its actions that are not packed yet are packed in place.'''
        for action in trx.actions:
            if action.rawData is None:
                action.rawData = self.pack_action_data(action.service, action.method, action.data)
        return psio.to_pssz(trx)
    def pack_action_data(self, service, method, data):
        '''The PSSZ of the arguments of an action: data is the object keyed by parameter name or the positional list'''
        function = self.get_schema(str(service)).actions.get(method.value)
        if function is None:
            raise Exception('Action not found: %s::%s' % (service, method))
        # Bytes are hex in I-JSON
        def hex_bytes(value):
            if isinstance(value, (bytes, bytearray)):
                return value.hex()
            raise TypeError('%s has no JSON text' % type(value).__name__)
        return function.params.json_to_pssz(json.dumps(data if data is not None else {}, default=hex_bytes))
    def get_schema(self, service):
        if service not in self._schemas:
            with self._api.get('/schema?service=%s' % service, service='packages') as reply:
                reply.raise_for_status()
                self._schemas[service] = ServiceSchema(reply.json())
        return self._schemas[service]

class TransactionError(Exception):
    def __init__(self, trace):
        super().__init__(trace['error'])
        self.trace = trace

class GraphQLError(Exception):
    def __init__(self, payload):
        msg = payload["errors"][0].get("message", "GraphQL error")
        super().__init__(msg)
        self.json = payload

# Which services verify signatures made with which kind of key. Each verifier
# service handles one kind of key; a kind of key has a default verifier and
# may have others that an account can choose instead. This mirrors
# psibase/verifier.hpp; nothing else in the tests should name a verifier for
# a key.
_VERIFIERS = {
    # key type: (allowed verifiers, the default first; AlgorithmIdentifier { id-ecPublicKey, namedCurve })
    'secp256k1': (['verify-k1'], bytes.fromhex('301006072a8648ce3d020106052b8104000a')),
    'secp256r1': (['verify-r1', 'verify-br1'], bytes.fromhex('301306072a8648ce3d020106082a8648ce3d030107')),
}

def allowed_verifiers_for_key_type(key_type):
    """The verifiers allowed for keys of this type ('secp256k1' or 'secp256r1'), the default first"""
    return list(_VERIFIERS[key_type][0])

def verifier_for_key_type(key_type):
    """The default verifier for keys of this type ('secp256k1' or 'secp256r1')"""
    return _VERIFIERS[key_type][0][0]

def allowed_verifiers(spki):
    """The verifiers allowed for the key whose DER SubjectPublicKeyInfo is
    spki, the default first; empty if no verifier accepts the key.
    Only the fixed encoding for each curve is accepted, holding an
    uncompressed or a compressed point."""
    spki = bytes(spki)
    for (services, algorithm) in _VERIFIERS.values():
        header = 2 + len(algorithm) + 3
        if len(spki) not in (header + 65, header + 33):
            continue
        point_size = len(spki) - header
        if (spki[0] == 0x30 and spki[1] == len(spki) - 2
                and spki[2:2 + len(algorithm)] == algorithm
                and spki[header - 3:header] == bytes([0x03, point_size + 1, 0x00])):
            return list(services)
    return []

def verifier_for(spki):
    """The default verifier for the key whose DER SubjectPublicKeyInfo is
    spki, or None if no verifier accepts the key."""
    services = allowed_verifiers(spki)
    return services[0] if services else None

def is_allowed_verifier(service, spki):
    """Whether service is one of the verifiers allowed for this key"""
    return service in allowed_verifiers(spki)

# A secp256k1 private key as one line of text: Bitcoin's wallet import format
# (WIF), base58(version || secret[32] || [0x01] || check[4]). version is 0x80
# (mainnet) or 0xEF (Bitcoin's test networks); a trailing 0x01 asks for the
# compressed public key; check is the start of SHA-256(SHA-256(the rest)).
# This mirrors psibase/wif.hpp, which is the definition; both are tested
# against libraries/psibase/common/tests/wif-vectors.json.
_BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
_WIF_VERSIONS = {'mainnet': 0x80, 'testnet': 0xEF}
_K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_WIF_MESSAGES = {
    'bad-character': 'private key (WIF): contains a character that is not base58',
    'bad-length': 'private key (WIF): wrong length',
    'bad-checksum': 'private key (WIF): check digits do not match',
    'bad-version': 'private key (WIF): not a Bitcoin mainnet or testnet private key',
    'bad-flag': 'private key (WIF): malformed compression flag',
    'bad-secret': 'private key (WIF): not a valid secp256k1 key',
}

class WifError(ValueError):
    """Raised by wif_decode and wif_encode. reason is the first rule the
    string breaks, by the same name in every language."""
    def __init__(self, reason):
        super().__init__(_WIF_MESSAGES[reason])
        self.reason = reason

WifKey = namedtuple('WifKey', ['secret', 'compressed', 'network'])
WifKey.__doc__ = """What a WIF string holds: the 32-byte private key (0 < secret < the group
order), whether the string asks for the compressed public key, and
'mainnet' or 'testnet'"""
# The key must not end up in a log
WifKey.__repr__ = lambda self: 'WifKey(compressed=%r, network=%r)' % (self.compressed, self.network)

def _wif_check(payload):
    return sha256(sha256(payload).digest()).digest()[:4]

def wif_encode(secret, compressed=True, network='mainnet'):
    """The WIF string of a private key (32 bytes). Raises WifError('bad-secret')
    if the key is 0 or is not below the group order."""
    secret = bytes(secret)
    if len(secret) != 32 or not 0 < int.from_bytes(secret, 'big') < _K1_ORDER:
        raise WifError('bad-secret')
    payload = bytes([_WIF_VERSIONS[network]]) + secret + (b'\x01' if compressed else b'')
    number = int.from_bytes(payload + _wif_check(payload), 'big')
    # The version byte is never zero, so there are no leading zeros to write
    result = ''
    while number:
        (number, digit) = divmod(number, 58)
        result = _BASE58[digit] + result
    return result

def wif_decode(text):
    """Reads a WIF string. ASCII white space (space, tab, CR, LF) is ignored
    at the ends and is an error anywhere else. Raises WifError when the
    string breaks one of the rules."""
    text = text.strip(' \t\r\n')
    if any(ch not in _BASE58 for ch in text):
        raise WifError('bad-character')
    # No string of 37 or 38 bytes is longer than 52 characters
    if len(text) == 0 or len(text) > 52:
        raise WifError('bad-length')
    number = 0
    for ch in text:
        number = number * 58 + _BASE58.index(ch)
    # The bytes are the number without its leading zeros, preceded by one
    # zero byte for each leading '1' of the text
    data = bytes(len(text) - len(text.lstrip('1'))) + number.to_bytes((number.bit_length() + 7) // 8, 'big')
    if len(data) not in (37, 38):
        raise WifError('bad-length')
    (payload, check) = (data[:-4], data[-4:])
    if _wif_check(payload) != check:
        raise WifError('bad-checksum')
    if payload[0] not in (0x80, 0xEF):
        raise WifError('bad-version')
    if len(payload) == 34 and payload[33] != 0x01:
        raise WifError('bad-flag')
    secret = payload[1:33]
    if not 0 < int.from_bytes(secret, 'big') < _K1_ORDER:
        raise WifError('bad-secret')
    return WifKey(secret, len(payload) == 34, 'mainnet' if payload[0] == 0x80 else 'testnet')

def looks_like_wif(text):
    """Whether the text has the shape of a WIF string: 51 or 52 base58
    characters that start with 5, K, L, 9 or c, with optional white space
    around them. Cheap, and says nothing about whether the string is valid."""
    text = text.strip(' \t\r\n')
    return len(text) in (51, 52) and text[0] in '5KL9c' and all(ch in _BASE58 for ch in text)

class PrivateKey:
    # Whether claims name the compressed form of the public key. The chain
    # compares a claim with the stored key byte for byte, so this is part of
    # which key an account has. A key read from WIF uses the form the string
    # asks for; any other key uses the uncompressed point, as OpenSSL writes it.
    compressed = False
    def __init__(self, data=None):
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.serialization import PublicFormat, Encoding, load_pem_private_key, load_der_private_key
        if data is None:
            # Software keys use secp256k1, which is the faster curve to verify
            self.private = ec.generate_private_key(ec.SECP256K1())
        elif isinstance(data, str) and looks_like_wif(data):
            key = wif_decode(data)
            self.private = ec.derive_private_key(int.from_bytes(key.secret, 'big'), ec.SECP256K1())
            self.compressed = key.compressed
        else:
            if isinstance(data, str):
                data = data.encode()
            try:
                self.private = load_pem_private_key(data, None)
            except ValueError:
                self.private = load_der_private_key(data, None)
            if not isinstance(self.private, ec.EllipticCurvePrivateKey) or not isinstance(self.private.curve, (ec.SECP256K1, ec.SECP256R1)):
                raise Exception("Only secp256k1 and P-256 keys are supported")
    def wif(self, compressed=None, network='mainnet'):
        """The key in WIF (secp256k1 only). compressed defaults to the form
        this key's claims use; pass True for the usual K.../L... string, which
        then signs for the compressed public key."""
        from cryptography.hazmat.primitives.asymmetric import ec
        if not isinstance(self.private.curve, ec.SECP256K1):
            raise Exception("Only secp256k1 keys have a WIF form")
        secret = self.private.private_numbers().private_value.to_bytes(32, 'big')
        return wif_encode(secret, self.compressed if compressed is None else compressed, network)
    def sign_prehashed(self, digest):
        from cryptography.hazmat.primitives.hashes import SHA256
        from cryptography.hazmat.primitives.asymmetric import ec, utils
        result = self.private.sign(digest, ec.ECDSA(utils.Prehashed(SHA256())))
        (r, s) = utils.decode_dss_signature(result)
        # The verifiers only accept the low-S form, s <= n/2. Older releases of
        # the cryptography package do not expose the group order.
        orders = {
            'secp256k1': 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141,
            'secp256r1': 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551,
        }
        curve = self.private.curve
        n = getattr(curve, 'group_order', None) or orders[curve.name]
        if s > n // 2:
            s = n - s
        return r.to_bytes(32, byteorder='big') + s.to_bytes(32, byteorder='big')
    verifier = None
    def with_verifier(self, verifier):
        """The same key, signing for an account that chose verifier for it
        (the verifier stored with the key in auth-sig) in place of the default for its type"""
        import copy
        result = copy.copy(self)
        result.verifier = verifier
        result.claim()
        return result
    def claim(self):
        """The claim for this key. It names the default verifier for the
        key's type unless another was chosen with with_verifier."""
        pub = self.spki_der()
        service = verifier_for(pub) if self.verifier is None else self.verifier
        if service is None:
            raise Exception("No verifier accepts this key")
        if not is_allowed_verifier(service, pub):
            raise Exception("%s does not verify this kind of key" % service)
        return {"service": service, "rawData": pub}
    def pkcs8(self):
        from cryptography.hazmat.primitives.serialization import PrivateFormat, Encoding, NoEncryption
        return self.private.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()
    def spki(self):
        import base64
        body = base64.b64encode(self.spki_der()).decode()
        lines = [body[i:i + 64] for i in range(0, len(body), 64)]
        return '-----BEGIN PUBLIC KEY-----\n' + '\n'.join(lines) + '\n-----END PUBLIC KEY-----\n'
    def spki_der(self):
        from cryptography.hazmat.primitives.serialization import PublicFormat, Encoding
        public = self.private.public_key()
        if not self.compressed:
            return public.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
        # SEQUENCE { AlgorithmIdentifier, BIT STRING point }
        point = public.public_bytes(Encoding.X962, PublicFormat.CompressedPoint)
        algorithm = _VERIFIERS[self.private.curve.name][1]
        return bytes([0x30, len(algorithm) + 3 + len(point)]) + algorithm + bytes([0x03, len(point) + 1, 0x00]) + point

class API:
    '''Provides an interface to the HTTP API of a psinode server based on requests'''
    def __init__(self, url, session=None):
        '''
        Initializes a new API object for url. If session is provided, it should
        be a requests Session object that will be used to handle all requests
        '''
        self.url = url
        if session is None:
            session = requests
        self.session = session

    # HTTP requests
    def _make_url(self, path, service=None):
        url = urllib3.util.parse_url(self.url)
        if service is not None:
            host = service + '.' + url.host
        else:
            host = url.host
        return urllib3.util.Url(url.scheme, url.auth, host, url.port, path).url
    def request(self, method, path, service=None, timeout=10, **kw):
        '''Makes an HTTP request and returns a Response. Other named parameters are passed through to requests.request.'''
        return self.session.request(method, self._make_url(path, service), timeout=timeout, **kw)
    def head(self, path, service=None, **kw):
        '''HTTP HEAD request'''
        return self.request('HEAD', path, service, **kw)
    def get(self, path, service=None, **kw):
        '''HTTP GET request'''
        return self.request('GET', path, service, **kw)
    def post(self, path, service=None, **kw):
        '''HTTP POST request'''
        return self.request('POST', path, service, **kw)
    def put(self, path, service=None, **kw):
        '''HTTP PUT request'''
        return self.request('PUT', path, service, **kw)
    def patch(self, path, service=None, **kw):
        '''HTTP PATCH request'''
        return self.request('PATCH', path, service, **kw)
    def delete(self, path, service=None, **kw):
        '''HTTP DELETE request'''
        return self.request('DELETE', path, service, **kw)

    # Transaction processing
    def pack_transaction(self, trx):
        '''Pack a transaction and return the result as bytes'''
        return ChainPackContext(self).pack_transaction(trx)
    def pack_signed_transaction(self, trx, keys=[]):
        '''Pack a signed transactions and return the result as bytes'''
        trx = self.sign_transaction(trx, keys)
        if isinstance(trx, SignedTransaction):
            return psio.to_pssz(trx)
        elif isinstance(trx, str):
            return bytes.fromhex(trx)
        else:
            return trx
    def sign_transaction(self, trx, keys=[]):
        if isinstance(trx, Transaction):
            if keys is not None:
                trx.claims += [Claim(**key.claim()) for key in keys]
            trx = self.pack_transaction(trx)
            digest = sha256(trx).digest()
            signatures = [key.sign_prehashed(digest) for key in keys]
            return SignedTransaction(trx, signatures)
        else:
            if len(keys) != 0:
                raise Exception("Transaction is already signed")
            return trx
    def push_transaction(self, trx, keys=[], wait_for="applied"):
        '''
        Push a transaction to the chain and return the transaction trace

        Raise TransactionError if the transaction fails
        '''
        packed = self.pack_signed_transaction(trx, keys)
        with self.post('/push_transaction?wait_for=%s' % wait_for, service='transact', headers={'Content-Type': 'application/octet-stream'}, data=packed) as result:
            result.raise_for_status()
            trace = result.json()
            if trace['error'] is not None:
                raise TransactionError(trace)
            return trace
    def push_action(self, sender, service, method, data, keys=[]):
        '''
        Push a transaction consisting of a single action to the chain and return the transaction trace

        Raise TransactionError if the transaction fails
        '''
        return self.push_transaction(Transaction(self.get_tapos(), actions=[Action(sender, service, method, data)], claims=[]), keys=keys)

    # Transactions for key system services
    def set_producers(self, prods, algorithm=None):
        '''
        Pushes a transaction to set the block producers.
        prods should be a list whose elements are any of
        - The name of a producer
        - A Node object
        - A json dict of the form {"name":<name>, "auth":{"service":<verify service>,"rawData":<hex string>}}
        algorithm should be either "cft" or "bft". If algorithm is None, the current consensus algorithm will be used.
        '''
        producers = [_get_producer_claim(p) for p in prods]
        if algorithm is None:
            return self.push_action('producers', 'producers', 'setProducers', {'producers': producers})
        elif algorithm == 'cft':
            mode = 'CftConsensus'
        elif algorithm == 'bft':
            mode = 'BftConsensus'
        return self.push_action('producers', 'producers', 'setConsensus', {'consensus':{mode: {'producers': producers}}})

    # Queries
    def graphql(self, service, query, token=None):
        '''
        Sends a GraphQL query to a service and returns the result as json

        Raise GraphQLError if the query fails
        '''
        headers = {}
        if token is not None:
            headers['Authorization'] = 'Bearer ' + token
        with self.post('/graphql', service=service, json={'query': query}, headers=headers) as result:
            result.raise_for_status()
            json = result.json()
            if 'errors' in json:
                raise GraphQLError(json)
            return json['data']

    def get_tapos(self, timeout=10, flags=0):
        '''Returns TaPoS for the current head block'''
        with  self.get('/common/tapos/head') as result:
            result.raise_for_status()
            tapos = result.json()
            tapos['expiration'] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time_ns() // 1000000000 + timeout))
            tapos['flags'] = flags
            return tapos

    def get_producers(self):
        '''Returns a tuple of (current producers, next producers). The next producers are empty except when the chain is in the process of changing block producers.'''
        def flatten(producers):
            return [p['name'] for p in producers]
        result = self.graphql('producers', 'query { producers { name } nextProducers { name } }')
        return (flatten(result['producers']), flatten(result['nextProducers']))

    def get_block_header(self, num=-1):
        '''Returns the header for a given blocknum. A negative num will return blocks from the end of the chain. -1 is the head block.'''
        if num == -1:
            args = 'last:1'
        else:
            if num < 0:
                num += self.get_block_header()['blockNum'] + 1
                if num < 0:
                    return None
            args = 'first:1 ge:%d' % num
        result = self.graphql('explorer', '''
            query {
                blocks(%s) {
                    edges {
                        node {
                            header {
                                blockNum
                                previous
                                time
                                producer
                                term
                                commitNum
                            }
                        }
                    }
                }
            }
        ''' % args)
        edges = result['blocks']['edges']
        if len(edges) == 0:
            return None
        else:
            return edges[0]['node']['header']

class Service(object):
    def __init__(self, api, service=None):
        self.api = api
        if service is not None:
            self.service = service

    def request(self, method, path, **kw):
        '''Makes an HTTP request and returns a Response. Other named parameters are passed through to requests.request.'''
        return self.api.request(method, path, self.service, **kw)
    def head(self, path, **kw):
        '''HTTP HEAD request'''
        return self.request('HEAD', path, **kw)
    def get(self, path, **kw):
        '''HTTP GET request'''
        return self.request('GET', path, **kw)
    def post(self, path, **kw):
        '''HTTP POST request'''
        return self.request('POST', path, **kw)
    def put(self, path, **kw):
        '''HTTP PUT request'''
        return self.request('PUT', path, **kw)
    def patch(self, path, **kw):
        '''HTTP PATCH request'''
        return self.request('PATCH', path, **kw)
    def delete(self, path, **kw):
        '''HTTP DELETE request'''
        return self.request('DELETE', path, **kw)

    def push_action(self, sender, method, data, keys=[]):
        '''
        Push a transaction consisting of a single action to the chain and return the transaction trace

        Raise TransactionError if the transaction fails
        '''
        return self.api.push_action(sender, self.service, method, data, keys)
    def graphql(self, query, token=None):
        '''
        Sends a GraphQL query to a service and returns the result as json

        Raise GraphQLError if the query fails
        '''
        return self.api.graphql(self.service, query, token)

_default_config = '''# psinode config
mount  = $PSIBASE_DATADIR/packages

http-timeout = 4
usage-flush-interval = 1
%s
[logger.stderr]
type   = console
filter = %s
format = %s
'''
_default_log_filter = 'Severity >= info'
_default_log_format = '[{TimeStamp}] [{Severity}]{?: [{Service}]}{?: [{RemoteEndpoint}]}: {Message}{?: {TransactionId}}{?: {BlockId}}{?RequestMethod:: {RequestMethod} {RequestHost}{RequestTarget}{?: {ResponseStatus}{?: {ResponseBytes}}}}{?: {ResponseTime} µs}{Indent:4:{TraceConsole}}'

def _write_config(dir, log_filter, log_format, softhsm, trustfile):
    logfile = os.path.join(dir, 'config')
    extra = ''
    if softhsm:
        extra += 'pkcs11-module = %s\n' % softhsm
    if trustfile:
        extra += 'tls-trustfile = %s\n' % trustfile
    if not os.path.exists(logfile):
        if log_filter is None:
            log_filter = _default_log_filter
        if log_format is None:
            log_format = _default_log_format
        with open(logfile, 'x') as f:
            f.write(_default_config % (extra, log_filter, log_format))

def _init_softhsm(dir, pin, module):
    conf = os.path.join(dir, 'softhsm.conf')
    tokens = os.path.join(dir, 'tokens')
    os.makedirs(tokens, exist_ok=True)
    with open(conf, 'w') as f:
        f.write('directories.tokendir = %s\n' % tokens)
    env = {'SOFTHSM2_CONF': conf}
    full_env = dict(os.environ)
    full_env.update(env)
    subprocess.run(['softhsm2-util', '--module', module, '--init-token', '--slot', '0', '--label', 'psibase', '--pin', pin, '--so-pin', pin], env=full_env, check=True)
    return env

class Node(API):
    def __init__(self, executable='psinode', dir=None, hostname=None, producer=None, p2p=True, listen=[], log_filter=None, log_format=None, database_cache_policy=None, start=True, softhsm=None, trustfile=None, env={}):
        '''
        Create a new psinode server
        If dir is not specified, the server will reside in a temporary directory
        '''
        if dir is None:
            self.tempdir = tempfile.TemporaryDirectory()
            self.dir = self.tempdir.name
        else:
            self.dir = dir
        self.executable = executable
        self.hostname = hostname
        self.producer = producer
        self.socketpath = os.path.join(self.dir, 'socket')
        self.logpath = os.path.join(self.dir, 'psinode.log')
        self.env = dict(env)
        session = requests.Session()
        session.mount('http://', _LocalAdapter(self.socketpath))
        super().__init__('http://%s/' % hostname, session)
        os.makedirs(self.dir, exist_ok=True)
        if softhsm is not None:
            self.softhsm_pin = 'Ch4ng#Me!'
            self.env.update(_init_softhsm(os.path.join(self.dir, 'softhsm'), self.softhsm_pin, softhsm))
        _write_config(self.dir, log_filter, log_format, softhsm, trustfile)
        if isinstance(listen, str):
            listen = [listen]
        self.listen = listen
        self.p2p = p2p
        if start:
            self.start(database_cache_policy=database_cache_policy)
    def node_args(self):
        return ['-a', self.url, '--proxy', 'unix:' + self.socketpath]
    def start(self, database_cache_policy=None):
        args = [self.executable, self.dir, "-l", self.socketpath]
        for interface in self.listen:
            args.extend(['-l', interface])
        if self.producer is not None:
            args.extend(['-p', self.producer])
        if self.hostname is not None:
            args.extend(['--host', self.hostname])
        args.extend(['--host', 'psibase.localhost'])
        if self.p2p:
            args.append('--p2p')
        if database_cache_policy is not None:
            args.extend(['--database-cache-policy', str(database_cache_policy)])
        env = dict(os.environ)
        # Each test node has a new database directory, and with it a new, empty
        # cache of compiled services. Share the user's cache so a service is
        # compiled once, not once per node per test.
        cache_home = env.get('XDG_CACHE_HOME') or os.path.join(os.path.expanduser('~'), '.cache')
        env.setdefault('PSIBASE_NATIVE_AOT_CACHE', os.path.join(cache_home, 'psibase', 'native-aot'))
        for (k, v) in self.env.items():
            if v is None:
                env.pop(k, None)
            else:
                env[k] = v
        kw = {'env': env}
        with open(self.logpath, 'a') as logfile:
            self.child = subprocess.Popen(args, stderr=logfile, **kw)
        self._wait_for_startup()

    def new_api(self):
        '''
        Creates an independent API object
        '''
        session = requests.Session()
        session.mount('http://', _LocalAdapter(self.socketpath))
        return API(self.url, session)

    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
    def __del__(self):
        self.close()
    def close(self):
        '''
        Stops the server and cleans up all associated resources.

        If a temporary directory was created for the node, it will be deleted.
        '''
        if hasattr(self, 'child'):
            self.child.terminate()
            try:
                self.child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait()

        if hasattr(self, 'tempdir'):
            self.tempdir.cleanup()
    def shutdown(self, force=False):
        '''Stop the server and wait for the server process to exit'''
        try:
            with self.post('/shutdown', service='x-admin', json={"force":force}):
                pass
        except requests.exceptions.ConnectionError:
            pass
        self.session.close()
        try:
            self.child.wait(timeout=10)
        except:
            self.child.kill()
            self.child.wait()
        del self.child
    def wait(self, cond, timeout=10):
        '''
        Wait until cond(self) is true.

        Raise TimeoutError if the timeout expires first
        '''
        for i in range(timeout):
            try:
                if cond(self):
                    return
            except:
                pass
            time.sleep(1)
        if not cond(self):
            raise TimeoutError()
    def connect(self, other):
        '''Connect to a peer. other can be a URL or a Node object'''
        if isinstance(other, Node):
            url = other.socketpath
        else:
            url = other
        with self.post('/connect', service='x-peers', json={'url':url}) as result:
            result.raise_for_status()
    def disconnect(self, other):
        '''Disconnects a peer. other can be a peer id, a URL, or a Node object.'''
        if isinstance(other, int):
            result = self.post('/disconnect', service='x-peers', json={'id': other})
            result.raise_for_status()
            return True
        elif isinstance(other, str):
            with self.get('/peers', service='x-peers') as peers:
                peers.raise_for_status()
                for peer in peers.json():
                    if other in peer['urls']:
                        return self.disconnect(int(peer['socket']))
            return False
        else:
            return self.disconnect(other.socketpath) or other.disconnect(self.socketpath)
    def boot(self, producer=None, packages=[]):
        '''boots the chain. If a producer is not specified, uses the name of this node'''
        if producer is None:
            producer = self.producer
        if producer is None:
            raise RuntimeError("Producer required for boot")
        self.run_psibase(['boot'] + self.node_args() + ['-p', producer] + packages)
        now = datetime.datetime.now(datetime.timezone.utc)
        def isbooted(node):
            try:
                timestamp = node.get_block_header()['time']
            except requests.exceptions.HTTPError as e:
                return False
            if timestamp.endswith('Z'):
                timestamp = timestamp[:-1] + '+00:00'
            if datetime.datetime.fromisoformat(timestamp) <= now:
                return False
            return node.get_producers() == ([producer],[])
        self.wait(isbooted)
    def install(self, packages=[], sources=[]):
        '''installs a package'''
        self.run_psibase(['install', '-y'] + self.node_args() + ['--package-source=' + s for s in sources] + packages)
    def install_local(self, packages=[], sources=[]):
        '''installs a local package'''
        self.run_psibase(['install', '--local', '-y'] + self.node_args() + ['--package-source=' + s for s in sources] + packages)
    def run_psibase(self, args, *, check=True, **kw):
        self._find_psibase()
        result = subprocess.run([self.psibase] + args, check=check, timeout=100, **kw)
        return result
    def unlock_softhsm(self):
        with self.get('/native/admin/keys/devices', service='x-admin') as reply:
            reply.raise_for_status()
            for device in reply.json():
                print(device)
                if device["name"] == "psibase":
                    device_id = device["id"]
                    break
        with self.post('/native/admin/keys/unlock', service='x-admin', json={"device": device_id, "pin": self.softhsm_pin}) as reply:
            reply.raise_for_status()
        return device_id
    def log(self):
        return open(self.logpath, 'r')
    def print_log(self):
        try:
            with self.log() as f:
                for line in f.readlines():
                    print(line, end='')
        except FileNotFoundError:
            pass
    def _find_psibase(self):
        if not hasattr(self, 'psibase'):
            dirname = os.path.dirname(self.executable)
            if dirname == '':
                self.psibase = 'psibase'
            elif os.path.exists(os.path.join(dirname, 'psibase')):
                self.psibase = os.path.join(dirname, 'psibase')
            elif os.path.exists(os.path.join(dirname, 'rust', 'release', 'psibase')):
                self.psibase = os.path.join(dirname, 'rust', 'release', 'psibase')
            else:
                self.psibase = 'psibase'
    def _wait_for_startup(self):
        while not self._is_ready():
            time.sleep(0.1)
    def _is_ready(self):
        if self.child.poll() is not None:
            self.print_log()
            raise Exception("Failed to start psinode")
        try:
            with self.get('/native/admin/status', service='x-admin') as result:
                return result.status_code == requests.codes.ok and 'startup' not in result.json()
        except requests.exceptions.ConnectionError as e:
            return False

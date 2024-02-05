import socket
import urllib3
import requests
import subprocess
import os
import tempfile
import time
import calendar
from collections import namedtuple

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
        return {'name': producer}
    elif isinstance(producer, Node):
        return {'name': producer.producer}
    else:
        return producer

Action = namedtuple('Action', ['sender', 'service', 'method', 'data'])
Transaction = namedtuple('Transaction', ['tapos', 'actions', 'claims'], defaults=[[]])

class TransactionError(Exception):
    def __init__(self, trace):
        super().__init__(trace['error'])
        self.trace = trace

class GraphQLError(Exception):
    def __init__(self, json):
        super().__init__(json['errors']['message'])
        self.json = json

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
    def request(self, method, path, service=None, **kw):
        '''Makes an HTTP request and returns a Response. Other named parameters are passed through to requests.request.'''
        return self.session.request(method, self._make_url(path, service), **kw)
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
    def pack_action(self, act):
        '''Pack an action and return a json object suitable for use in pack_transaction'''
        with self.post('/pack_action/%s' % act.method, service=act.service, json=act.data) as result:
            result.raise_for_status()
            return {'sender':act.sender, 'service':act.service, 'method': act.method, 'rawData': result.content.hex()}
    def pack_transaction(self, trx):
        '''Pack a transaction and return the result as bytes'''
        with self.post('/common/pack/Transaction', json={'tapos':trx.tapos, 'actions':[self.pack_action(act) for act in trx.actions], 'claims': trx.claims}) as result:
            result.raise_for_status()
            return result.content
    def pack_signed_transaction(self, trx, signatures=[]):
        '''Pack a signed transactions and return the result as bytes'''
        if isinstance(trx, bytes):
            trx = trx.hex()
        elif isinstance(trx, Transaction):
            trx = self.pack_transaction(trx).hex()
        with self.post('/common/pack/SignedTransaction', json={'transaction': trx, 'proofs':signatures}) as result:
            result.raise_for_status()
            return result.content
    def push_transaction(self, trx):
        '''
        Push a transaction to the chain and return the transaction trace

        Raise TransactionError if the transaction fails
        '''
        packed = self.pack_signed_transaction(trx)
        with self.post('/native/push_transaction', headers={'Content-Type': 'application/octet-stream'}, data=packed) as result:
            result.raise_for_status()
            trace = result.json()
            if trace['error'] is not None:
                raise TransactionError(trace)
            return trace
    def push_action(self, sender, service, method, data):
        '''
        Push a transaction consisting of a single action to the chain and return the transaction trace

        Raise TransactionError if the transaction fails
        '''
        tapos = tapos=self.get_tapos()
        tapos['expiration'] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time_ns() // 1000000000 + 10))
        tapos['flags'] = 0
        return self.push_transaction(Transaction(tapos, actions=[Action(sender, service, method, data)]))

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
            return self.push_action('producer-sys', 'producer-sys', 'setProducers', {'producers': producers})
        elif algorithm == 'cft':
            mode = 'CftConsensus'
        elif algorithm == 'bft':
            mode = 'BftConsensus'
        return self.push_action('producer-sys', 'producer-sys', 'setConsensus', {'consensus':{mode: {'producers': producers}}})

    # Queries
    def graphql(self, service, query):
        '''
        Sends a GraphQL query to a service and returns the result as json

        Raise GraphQLError if the query fails
        '''
        with self.post('/graphql', service=service, json={'query': query}) as result:
            result.raise_for_status()
            json = result.json()
            if 'errors' in json:
                raise GraphQLError(json)
            return json['data']

    def get_tapos(self):
        '''Returns TaPoS for the current head block'''
        with  self.get('/common/tapos/head') as result:
            result.raise_for_status()
            return result.json()

    def get_producers(self):
        '''Returns a tuple of (current producers, next producers). The next producers are empty except when the chain is in the process of changing block producers.'''
        def flatten(producers):
            return [p['name'] for p in producers]
        result = self.graphql('producer-sys', 'query { producers { name } nextProducers { name } }')
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
        result = self.graphql('explore-sys', '''
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

_default_config = '''# psinode config
service  = localhost:$PSIBASE_DATADIR/services/admin-sys
service  = 127.0.0.1:$PSIBASE_DATADIR/services/admin-sys
service  = [::1]:$PSIBASE_DATADIR/services/admin-sys
service  = admin-sys.:$PSIBASE_DATADIR/services/admin-sys
admin    = static:*

admin-authz = r:any
admin-authz = rw:loopback

[logger.stderr]
type   = console
filter = %s
format = %s
'''
_default_log_filter = 'Severity >= info'
_default_log_format = '[{TimeStamp}] [{Severity}]{?: [{RemoteEndpoint}]}: {Message}{?: {TransactionId}}{?: {BlockId}}{?RequestMethod:: {RequestMethod} {RequestHost}{RequestTarget}{?: {ResponseStatus}{?: {ResponseBytes}}}}{?: {ResponseTime} µs}'

def _write_config(dir, log_filter, log_format):
    logfile = os.path.join(dir, 'config')
    if not os.path.exists(logfile):
        if log_filter is None:
            log_filter = _default_log_filter
        if log_format is None:
            log_format = _default_log_format
        with open(logfile, 'x') as f:
            f.write(_default_config % (log_filter, log_format))

class Node(API):
    def __init__(self, executable='psinode', dir=None, hostname=None, producer=None, p2p=True, listen=[], log_filter=None, log_format=None, database_cache_size=None):
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
        session = requests.Session()
        session.mount('http://', _LocalAdapter(self.socketpath))
        super().__init__('http://%s/' % hostname, session)
        os.makedirs(self.dir, exist_ok=True)
        _write_config(self.dir, log_filter, log_format)
        if isinstance(listen, str):
            listen = [listen]
        self.listen = listen
        self.p2p = p2p
        self.start(database_cache_size=database_cache_size)
    def start(self, database_cache_size=None):
        args = [self.executable, "-l", self.socketpath]
        for interface in self.listen:
            args.extend(['-l', interface])
        if self.producer is not None:
            args.extend(['-p', self.producer])
        if self.hostname is not None:
            args.extend(['--host', self.hostname])
        if self.p2p:
            args.append('--p2p')
        if database_cache_size is not None:
            args.extend(['--database-cache-size', str(database_cache_size)])
        args.append(self.dir)
        with open(self.logpath, 'a') as logfile:
            self.child = subprocess.Popen(args, stderr=logfile)
        self._wait_for_startup()

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
            except TimeoutExpired:
                self.child.kill()
                self.child.wait()

        if hasattr(self, 'tempdir'):
            self.tempdir.cleanup()
    def shutdown(self):
        '''Stop the server and wait for the server process to exit'''
        with self.post('/native/admin/shutdown', service='admin-sys', json={}):
            pass
        self.session.close()
        self.child.wait()
    def wait(self, cond, timeout=10):
        '''
        Wait until cond(self) is true.

        Raise TimeoutError if the timeout expires first
        '''
        for i in range(timeout):
            if cond(self):
                return
            time.sleep(1)
        raise TimeoutError()
    def connect(self, other):
        '''Connect to a peer. other can be a URL or a Node object'''
        if isinstance(other, Node):
            url = other.socketpath
        else:
            url = other
        with self.post('/native/admin/connect', service='admin-sys', json={'url':url}):
            pass
    def disconnect(self, other):
        '''Disconnects a peer. other can be a peer id, a URL, or a Node object.'''
        if isinstance(other, int):
            result = self.post('/native/admin/disconnect', service='admin-sys', json={'id': other})
            result.raise_for_status()
            return True
        elif isinstance(other, str):
            with self.get('/native/admin/peers', service='admin-sys') as peers:
                peers.raise_for_status()
                for peer in peers.json():
                    if peer['url'] == other:
                        return self.disconnect(int(peer['id']))
            return False
        else:
            return self.disconnect(other.socketpath) or other.disconnect(self.socketpath)

    def boot(self, producer=None):
        '''boots the chain. If a producer is not specified, uses the name of this node'''
        self._find_psibase()
        if producer is None:
            producer = self.producer
        if producer is None:
            raise RuntimeError("Producer required for boot")
        args = ['-p', producer]
        subprocess.run([self.psibase, '-a', self.url, '--proxy', 'unix:' + self.socketpath, 'boot'] + args)
        now = time.time_ns() // 1000000000
        def isbooted(node):
            try:
                timestamp = node.get_block_header()['time']
            except requests.exceptions.HTTPError as e:
                return False
            if calendar.timegm(time.strptime(timestamp, "%Y-%m-%dT%H:%M:%S.000Z")) <= now:
                return False
            return node.get_producers() == ([producer],[])
        self.wait(isbooted)
    def log(self):
        return open(self.logpath, 'r')
    def print_log(self):
        with self.log() as f:
            for line in f.readlines():
                print(line, end='')
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
        try:
            with self.get('/native/admin/status', service='admin-sys') as result:
                return result.status_code == requests.codes.ok and 'startup' not in result.json()
        except requests.exceptions.ConnectionError as e:
            return False

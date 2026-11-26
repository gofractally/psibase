#!/usr/bin/python

# Usage metering (gofractally/psibase#2270): what each connection identity
# used of one node, as the node reports it.
#
# Every client here reaches the node through its unix socket, which the
# node treats as a trusted local proxy: a client that sends
# X-Forwarded-For is the anonymous address it names, one that sends
# nothing is local:unix.

import testutil
import unittest
import os
import time
from predicates import *
from services import AuthSig, Tokens, Transact, XAdmin
from psinode import PrivateKey
import websockets
from test_websocket import websocket_url

FAUCET_DEBIT = {"token_id": 1, "creditor": "faucet-tok", "amount": {"value": 1000000000}, "memo": ""}
CLIENT = '198.51.100.7'

COUNTERS = ['requests', 'bytesIn', 'bytesOut', 'messagesIn', 'messagesOut', 'requestNs',
            'trxPushed', 'trialOk', 'trialFailed', 'trialNs', 'compileNs', 'verifyRuns',
            'verifyNs', 'callbackNs']

def counters(record):
    return {k: int(v) for (k, v) in record.items()}

def me(api):
    with api.get('/me', service='x-usage') as reply:
        reply.raise_for_status()
        return reply.json()

def report(node, **params):
    with node.get('/report', service='x-usage', params=params) as reply:
        reply.raise_for_status()
        return reply.json()

def identity(node, name):
    with node.get('/identity', service='x-usage', params={'id': name}) as reply:
        if reply.status_code == 404:
            return None
        reply.raise_for_status()
        result = reply.json()
        result['total'] = counters(result['total'])
        result['recent'] = counters(result['recent'])
        return result

def kind_total(node, kind):
    for item in report(node)['totals']:
        if item['kind'] == kind:
            return counters(item['total'])

def wait_for(f, timeout=15):
    '''Rows are written once a second'''
    for i in range(timeout * 4):
        result = f()
        if result:
            return result
        time.sleep(0.25)
    raise TimeoutError()

def forwarded_api(node, address=CLIENT):
    api = node.new_api()
    api.session.headers['X-Forwarded-For'] = address
    return api

class TestUsage(unittest.TestCase):
    @testutil.psinode_test
    def test_identities(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers'])
        a.push_action('alice', 'tokens', 'debit', FAUCET_DEBIT)
        a.push_action('bob', 'tokens', 'debit', FAUCET_DEBIT)
        a.wait(new_block())

        # An anonymous client behind the local proxy: charged to its address
        anon = forwarded_api(a)
        self.assertEqual(me(anon)['identity'], 'ip:' + CLIENT)
        Transact(anon).push_action('alice', 'tokens', 'credit', {"token_id":1,"debitor":"bob","amount":{"value":100}, "memo":"anon"})

        # A logged-in client: charged to the account, wherever it comes from
        token = Transact(a).login('alice')
        user = forwarded_api(a, '203.0.113.50')
        user.session.headers['Authorization'] = 'Bearer ' + token
        self.assertEqual(me(user)['identity'], 'account:alice')
        Transact(user).push_action('alice', 'tokens', 'credit', {"token_id":1,"debitor":"bob","amount":{"value":100}, "memo":"user"})
        Transact(user).push_action('alice', 'tokens', 'credit', {"token_id":1,"debitor":"bob","amount":{"value":100}, "memo":"user2"})

        def pushed(api, n):
            usage = me(api)['usage']
            return usage if usage and int(usage['total']['trxPushed']) >= n and int(usage['total']['trialOk']) >= n else None

        usage = wait_for(lambda: pushed(anon, 1))
        self.assertEqual(usage['identity'], 'ip:' + CLIENT)
        total = counters(usage['total'])
        self.assertEqual(total['trxPushed'], 1)
        self.assertEqual(total['trialOk'], 1)
        self.assertEqual(total['trialFailed'], 0)
        self.assertGreater(total['trialNs'], 0)
        self.assertGreaterEqual(total['requests'], 3)
        self.assertGreater(total['bytesIn'], 300)
        self.assertGreater(total['bytesOut'], 300)
        self.assertGreater(total['requestNs'], 0)
        self.assertEqual(counters(usage['recent'])['trxPushed'], 1)
        self.assertGreater(int(usage['keepUntil']), int(usage['lastSeen']))

        usage = wait_for(lambda: pushed(user, 2))
        self.assertEqual(usage['identity'], 'account:alice')
        self.assertEqual(counters(usage['total'])['trxPushed'], 2)
        # The address a logged-in client came from is not recorded. (The
        # client above also sent requests without its token: the HTTP library
        # drops it when the root host redirects to another host.)
        direct = forwarded_api(a, '203.0.113.60')
        direct.session.headers['Authorization'] = 'Bearer ' + token
        requests_before = int(me(user)['usage']['total']['requests'])
        for i in range(3):
            with direct.get('/common/tapos/head', service='transact') as reply:
                reply.raise_for_status()
        wait_for(lambda: int(me(user)['usage']['total']['requests']) >= requests_before + 3)
        self.assertIsNone(identity(a, 'ip:203.0.113.60'))

        # Nobody selects another identity through /me
        with anon.get('/me', service='x-usage', params={'id': 'account:alice'}) as reply:
            self.assertEqual(reply.json()['identity'], 'ip:' + CLIENT)
        # An expired or invalid token is an anonymous client
        bad = forwarded_api(a, '203.0.113.51')
        bad.session.headers['Authorization'] = 'Bearer ' + token[:-4] + 'AAAA'
        self.assertEqual(me(bad)['identity'], 'ip:203.0.113.51')

        # The operator's report is for the operator: a remote client, with
        # or without an account that is not an admin, is refused.
        for api in [anon, user]:
            for path in ['/report', '/identity?id=account:alice', '/quotas']:
                with api.get(path, service='x-usage') as reply:
                    self.assertIn(reply.status_code, [401, 403], path)
            with api.post('/quota', service='x-usage', json={'identity': 'account:alice', 'perWindow': {}}) as reply:
                self.assertIn(reply.status_code, [401, 403])

        r = report(a)
        self.assertTrue(r['settings']['enabled'])
        self.assertEqual(int(r['settings']['flushSeconds']), 1)
        kinds = {item['kind']: item for item in r['totals']}
        self.assertEqual(sorted(kinds.keys()), ['account', 'ip', 'local', 'peer'])
        self.assertEqual(int(kinds['account']['total']['trxPushed']), 2)
        self.assertEqual(int(kinds['ip']['total']['trxPushed']), 1)
        self.assertGreaterEqual(int(kinds['local']['records']), 1)
        names = [item['identity'] for item in r['top']]
        self.assertIn('account:alice', names)
        self.assertIn('ip:' + CLIENT, names)
        self.assertIn('local:unix', names)
        # Sorted by one counter, one kind only
        r = report(a, kind='account', order='trxPushed', limit='1')
        self.assertEqual([item['identity'] for item in r['top']], ['account:alice'])
        r = report(a, kind='ip', order='trxPushed', recent='1')
        self.assertEqual(r['top'][0]['identity'], 'ip:' + CLIENT)
        self.assertTrue(all(item['kind'] == 'ip' for item in r['top']))
        # Identity strings are validated
        for bad_id in ['alice', 'account:Alice', 'bogus:x', 'ip:1.2.3', 'account:' + 'a' * 200]:
            with a.get('/identity', service='x-usage', params={'id': bad_id}) as reply:
                self.assertEqual(reply.status_code, 400, bad_id)
        with a.get('/report', service='x-usage', params={'order': 'nothing'}) as reply:
            self.assertEqual(reply.status_code, 400)

        # Quotas are stored settings; nothing enforces them
        limits = {k: '0' for k in COUNTERS}
        limits['requests'] = '1'
        with a.post('/quota', service='x-usage', json={'identity': 'account:alice', 'perWindow': limits}) as reply:
            reply.raise_for_status()
        limits['requests'] = '5'
        with a.post('/quota', service='x-usage', json={'identity': 'ip:*', 'perWindow': limits}) as reply:
            reply.raise_for_status()
        with a.post('/quota', service='x-usage', json={'identity': 'nobody', 'perWindow': limits}) as reply:
            self.assertEqual(reply.status_code, 400)
        with a.get('/quotas', service='x-usage') as reply:
            reply.raise_for_status()
            quotas = {q['identity']: int(q['perWindow']['requests']) for q in reply.json()}
        self.assertEqual(quotas, {'account:alice': 1, 'ip:*': 5})
        self.assertEqual(int(identity(a, 'account:alice')['quota']['requests']), 1)
        self.assertEqual(int(me(anon)['usage']['quota']['requests']), 5)
        # Far over the stored quota, and still served
        Transact(user).push_action('alice', 'tokens', 'credit', {"token_id":1,"debitor":"bob","amount":{"value":100}, "memo":"user3"})
        wait_for(lambda: pushed(user, 3))
        limits['requests'] = '0'
        with a.post('/quota', service='x-usage', json={'identity': 'ip:*', 'perWindow': limits}) as reply:
            reply.raise_for_status()
        with a.get('/quotas', service='x-usage') as reply:
            self.assertEqual([q['identity'] for q in reply.json()], ['account:alice'])

        # Totals per kind on the metrics endpoint
        with a.get('/native/admin/metrics', service='x-admin') as reply:
            reply.raise_for_status()
            metrics = dict(line.rsplit(' ', 1) for line in reply.text.splitlines() if line.startswith('psinode_usage_'))
        self.assertEqual(metrics['psinode_usage_pushed_transactions_total{kind="account"}'], '3')
        self.assertEqual(metrics['psinode_usage_pushed_transactions_total{kind="ip"}'], '1')
        self.assertGreaterEqual(int(metrics['psinode_usage_identities{kind="ip"}']), 2)

        # The counters survive a restart
        before = wait_for(lambda: identity(a, 'account:alice'))
        a.shutdown()
        a.start()
        after = identity(a, 'account:alice')
        self.assertEqual(after['total']['trxPushed'], 3)
        self.assertGreaterEqual(after['total']['requests'], before['total']['requests'])
        self.assertEqual(after['firstSeen'], before['firstSeen'])
        self.assertEqual(identity(a, 'ip:' + CLIENT)['total']['trxPushed'], 1)
        with a.get('/quotas', service='x-usage') as reply:
            self.assertEqual([q['identity'] for q in reply.json()], ['account:alice'])
        # and counting continues
        Transact(user).push_action('alice', 'tokens', 'credit', {"token_id":1,"debitor":"bob","amount":{"value":100}, "memo":"user4"})
        wait_for(lambda: pushed(user, 4))

    @testutil.psinode_test
    def test_failed_trial(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers'])
        a.wait(new_block())
        anon = forwarded_api(a)
        from psinode import TransactionError
        with self.assertRaises(TransactionError):
            # alice has no tokens
            Transact(anon).push_action('alice', 'tokens', 'credit', {"token_id":1,"debitor":"bob","amount":{"value":1000000000}, "memo":"fail"}, timeout=4)
        def failed():
            usage = me(anon)['usage']
            return usage if usage and int(usage['total']['trialFailed']) >= 1 else None
        total = counters(wait_for(failed)['total'])
        self.assertEqual(total['trxPushed'], 1)
        self.assertEqual(total['trialOk'], 0)

    @testutil.psinode_test
    def test_signature_and_compile(self, cluster):
        # A signed transaction costs a signature check, and a transaction
        # that needs code this node has not compiled costs a compile. Both
        # are charged to whoever pushed the transaction.
        (a,) = cluster.complete(*testutil.generate_names(1), env={'PSIBASE_NATIVE_AOT_CACHE': os.path.join(cluster.dir, 'fresh-aot-cache')})
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers'])
        a.push_action('alice', 'tokens', 'debit', FAUCET_DEBIT)
        a.wait(new_block())
        key = PrivateKey()
        AuthSig(a).set_key('alice', key)
        a.wait(new_block())

        signer = forwarded_api(a, '198.51.100.20')
        Transact(signer).push_action('alice', 'tokens', 'credit', {"token_id":1,"debitor":"bob","amount":{"value":100}, "memo":"signed"}, keys=[key])
        def verified():
            usage = me(signer)['usage']
            return usage if usage and int(usage['total']['verifyRuns']) >= 1 and int(usage['total']['trialOk']) >= 1 else None
        total = counters(wait_for(verified)['total'])
        self.assertEqual(total['trxPushed'], 1)
        self.assertGreaterEqual(total['verifyRuns'], 1)
        self.assertGreater(total['verifyNs'], 0)
        # An unsigned transaction from another client costs no signature check
        other = forwarded_api(a, '198.51.100.21')
        Transact(other).push_action('bob', 'tokens', 'debit', FAUCET_DEBIT)
        def pushed():
            usage = me(other)['usage']
            return usage if usage and int(usage['total']['trialOk']) >= 1 else None
        self.assertEqual(counters(wait_for(pushed)['total'])['verifyRuns'], 0)

        # New code: whoever pushes the transaction whose trial run has to
        # compile it pays for the compile; the others do not. The package
        # is installed by the operator's own client (local:unix) and first
        # called by an anonymous client.
        def compile_ns(api):
            return counters(me(api)['usage']['total'])['compileNs']
        before = {'signer': compile_ns(signer), 'other': compile_ns(other)}
        local_before = wait_for(lambda: identity(a, 'local:unix'))['total']['compileNs']
        a.install(sources=[testutil.test_packages()], packages=['Counter'])
        a.wait(new_block())
        caller = forwarded_api(a, '198.51.100.22')
        Transact(caller).push_action('bob', 'counter', 'inc', {"key":"","id":0})
        def compiled():
            local = identity(a, 'local:unix')['total']['compileNs'] - local_before
            usage = me(caller)['usage']
            called = int(usage['total']['compileNs']) if usage else 0
            return (local, called) if usage and int(usage['total']['trialOk']) >= 1 and local + called > 0 else None
        (local, called) = wait_for(compiled)
        print('compile charged: local:unix %d ns, the first caller %d ns' % (local, called))
        self.assertGreater(local + called, 0)
        self.assertEqual(compile_ns(signer), before['signer'])
        self.assertEqual(compile_ns(other), before['other'])

    @testutil.psinode_test
    async def test_websocket(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        XAdmin(a).install(os.path.join(testutil.test_packages(), "WSEcho.psi"))
        before = identity(a, 'local:unix')
        before = before['total'] if before else {k: 0 for k in COUNTERS}
        url = websocket_url(a, '/echo', service='x-echo')
        messages = ['lorem', 'ipsum', 'dolor', 'sit', 'amet']
        async with websockets.unix_connect(a.socketpath, url) as websocket:
            for message in messages:
                await websocket.send(message)
                await websocket.recv()
        size = sum(len(m) for m in messages)
        def echoed():
            row = identity(a, 'local:unix')
            return row if row and row['total']['messagesIn'] - before['messagesIn'] >= len(messages) and row['total']['messagesOut'] - before['messagesOut'] >= len(messages) else None
        total = wait_for(echoed)['total']
        self.assertEqual(total['messagesIn'] - before['messagesIn'], len(messages))
        self.assertEqual(total['messagesOut'] - before['messagesOut'], len(messages))
        self.assertGreaterEqual(total['bytesIn'] - before['bytesIn'], size)
        self.assertGreaterEqual(total['bytesOut'] - before['bytesOut'], size)

    @testutil.psinode_test
    def test_logged_in_peer(self, cluster):
        # A peer connection is recorded under the peer kind, also when the
        # peer logged in with an account: usage is tracked by peer and by
        # account, and a peer is a peer. Only the HTTP request that asked for
        # the connection, made before it was one, is the account's.
        a = cluster.make_node('a', p2p=False)
        b = cluster.make_node('b', p2p=False)
        a.boot(packages=['Minimal', 'Explorer'])
        with a.post('/users', service='x-peers', json={"account":"a","accept":True}) as reply:
            reply.raise_for_status()
        # p2p over local sockets uses the hostname psibase.localhost, and so
        # must the token (see test_connect.py)
        a.url = "http://psibase.localhost/"
        token = Transact(a).login('a')
        with b.post('/authorization', service='x-peers', json={"url": a.socketpath, "token": token}) as reply:
            reply.raise_for_status()
        b.connect(a)
        # b follows a's chain over the connection
        b.wait(new_block())
        a.wait(new_block())

        def peer_traffic():
            row = identity(a, 'peer:unix')
            return row if row and row['total']['messagesIn'] > 0 and row['total']['messagesOut'] > 0 else None
        peer = wait_for(peer_traffic)
        self.assertGreater(peer['total']['bytesOut'], 0)
        self.assertEqual(peer['total']['requests'], 0)
        # The account the peer logged in with has the upgrade request and
        # nothing of the connection's traffic
        account = wait_for(lambda: identity(a, 'account:a'))
        self.assertGreaterEqual(account['total']['requests'], 1)
        self.assertEqual(account['total']['messagesIn'], 0)
        self.assertEqual(account['total']['messagesOut'], 0)
        # and it stays that way as the connection goes on
        before = identity(a, 'peer:unix')['total']['messagesOut']
        a.wait(new_block())
        a.wait(new_block())
        wait_for(lambda: identity(a, 'peer:unix')['total']['messagesOut'] > before)
        self.assertEqual(identity(a, 'account:a')['total']['messagesOut'], 0)

    @testutil.psinode_test
    def test_forward(self, cluster):
        # A transaction pushed to one producer and forwarded to the others:
        # the node the client talked to charges the client; a node that
        # received it from a peer charges that peer connection (kind `peer`).
        prods = cluster.complete(*testutil.generate_names(3))
        a = testutil.boot_with_producers(prods, packages=['Minimal', 'Explorer', 'TokenUsers'])
        a.push_action('alice', 'tokens', 'debit', FAUCET_DEBIT)
        a.wait(new_block())
        # alice signs: a forwarded transaction costs the receiving node a
        # signature check too, and the peer connection pays for it
        key = PrivateKey()
        AuthSig(a).set_key('alice', key)
        a.wait(new_block())
        entry = prods[2]
        entry.wait(new_block())
        time.sleep(2)
        peers_before = [kind_total(node, 'peer')['trxPushed'] for node in prods]
        verify_before = [kind_total(node, 'peer')['verifyRuns'] for node in prods]

        anon = forwarded_api(entry)
        Transact(anon).push_action('alice', 'tokens', 'credit', {"token_id":1,"debitor":"bob","amount":{"value":100}, "memo":"forward"}, keys=[key])

        def pushed():
            usage = me(anon)['usage']
            return usage if usage and int(usage['total']['trialOk']) >= 1 else None
        self.assertEqual(wait_for(pushed)['identity'], 'ip:' + CLIENT)

        def forwarded():
            now = [kind_total(node, 'peer')['trxPushed'] for node in prods]
            return now if sum(now) > sum(peers_before) else None
        peers_after = wait_for(forwarded)
        # The entry node did not receive its own transaction from a peer
        self.assertEqual(peers_after[2], peers_before[2])
        self.assertGreaterEqual(counters(me(anon)['usage']['total'])['verifyRuns'], 1)
        def verified():
            now = [kind_total(node, 'peer') for node in prods]
            return now if sum(n['verifyRuns'] for n in now) > sum(verify_before) else None
        peer_totals = wait_for(verified)
        self.assertEqual(peer_totals[2]['verifyRuns'], verify_before[2])
        self.assertGreater(sum(n['verifyNs'] for n in peer_totals), 0)
        for node in prods[0:2]:
            # No client of these nodes pushed anything
            self.assertEqual(kind_total(node, 'ip')['trxPushed'], 0)
            self.assertEqual(kind_total(node, 'account')['trxPushed'], 0)
        # Peer traffic itself is counted on the peer connections
        self.assertGreater(kind_total(a, 'peer')['bytesIn'], 0)
        self.assertGreater(kind_total(a, 'peer')['messagesIn'], 0)

if __name__ == '__main__':
    testutil.main()

from psinode import Action, Transaction, Service
import time

class Tokens(Service):
    service = 'tokens'
    def credit(self, sender, receiver, token, amount, memo):
        self.push_action(sender, 'credit', {"tokenId":token,"receiver":receiver,"amount":{"value":amount}, "memo":memo})
    def balance(self, account, token):
        balances = self.graphql('query { userBalances(user: "%s") { edges { node { tokenId balance } } } }' % account)
        for edge in balances['userBalances']['edges']:
            node = edge['node']
            if node['tokenId'] == token:
                return int(node['balance'])

class TransactionQueue(Service):
    service = 'txqueue'
    def push_transaction(self, trx):
        packed = self.api.pack_signed_transaction(trx)
        with self.post('/push_transaction', headers={'Content-Type': 'application/octet-stream'}, data=packed) as response:
            response.raise_for_status()
    def push_action(self, sender, service, method, data):
        tapos = self.api.get_tapos()
        tapos['expiration'] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time_ns() // 1000000000 + 10))
        tapos['flags'] = 0
        return self.push_transaction(Transaction(tapos, actions=[Action(sender, service, method, data)]))

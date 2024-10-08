from psinode import Action, Transaction, TransactionError, Service
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

class Transact(Service):
    service = 'transact'
    def push_transaction(self, trx):
        packed = self.api.pack_signed_transaction(trx)
        with self.post('/push_transaction', headers={'Content-Type': 'application/octet-stream'}, data=packed) as response:
            response.raise_for_status()
            trace = response.json()
            if trace['error'] is not None:
                raise TransactionError(trace)
            return trace
    def push_action(self, sender, service, method, data, timeout=10, flags=0):
        tapos = self.api.get_tapos(timeout=timeout, flags=flags)
        return self.push_transaction(Transaction(tapos, actions=[Action(sender, service, method, data)], claims=[]))

from psinode import Action, PrivateKey, Transaction, TransactionError, Service
from decimal import Decimal
import time

class Tokens(Service):
    service = 'tokens'
    def credit(self, sender, debitor, token, amount, memo):
        self.push_action(sender, 'credit', {"tokenId":token,"debitor":debitor,"amount":{"value":amount}, "memo":memo})
    def balance(self, account, token):
        balances = self.graphql('query { userBalances(user: "%s") { edges { node { tokenId balance } } } }' % account)
        for edge in balances['userBalances']['edges']:
            node = edge['node']
            if node['tokenId'] == token:
                return Decimal(node['balance']) 

class Transact(Service):
    service = 'transact'
    def push_transaction(self, trx, keys=[], wait_for="applied"):
        packed = self.api.pack_signed_transaction(trx, keys)
        with self.post('/push_transaction?wait_for=%s' % wait_for, headers={'Content-Type': 'application/octet-stream'}, data=packed) as response:
            response.raise_for_status()
            trace = response.json()
            if trace['error'] is not None:
                raise TransactionError(trace)
            return trace
    def push_action(self, sender, service, method, data, timeout=10, flags=0, keys=[]):
        tapos = self.api.get_tapos(timeout=timeout, flags=flags)
        return self.push_transaction(Transaction(tapos, actions=[Action(sender, service, method, data)], claims=[]), keys)
    def get_jwt_key(self, token):
        with self.get('/jwt_key', headers={"Authorization": "Bearer " + token}) as reply:
            reply.raise_for_status()
            return reply.content

class Accounts(Service):
    service = 'accounts'
    def new_account(self, name, auth_service='auth-any', require_new=True, *, sender='root'):
        self.push_action(sender, 'newAccount', {"name": name, "authService": auth_service,"requireNew": require_new})
    def set_auth_service(self, account, auth_service):
        self.push_action(account, 'setAuthServ', {'authService': auth_service})

class AuthSig(Service):
    service = 'auth-sig'
    def set_key(self, account, key, set_auth=True):
        if isinstance(key, PrivateKey):
            key = key.spki_der()
        self.push_action(account, 'setKey', {"key": key})

        actions = [Action(account, self.service, 'setKey', {"key": key})]
        if set_auth:
            actions += [Action(account, Accounts.service, 'setAuthServ', {'authService': self.service})]
        self.api.push_transaction(Transaction(self.api.get_tapos(), actions=actions, claims=[]))

class StagedTx(Service):
    service = 'staged-tx'
    def get_staged(self, proposer=None):
        if proposer is not None:
            json = self.graphql( '''query {
              getStagedByProposer(proposer: "%s") {
                edges { node { id txid  } }
              }
            }''' % proposer)
            return [edge["node"] for edge in json["getStagedByProposer"]["edges"]]

    def accept(self, account, id_or_tx, txid=None, *, keys):
        if txid is None:
            id_ = id_or_tx['id']
            txid = id_or_tx['txid']
        self.push_action(account, 'accept', {"id": id_,  "txid": txid}, keys=keys)

class XAdmin(Service):
    service = 'x-admin'
    def get_admin_accounts(self):
        with self.get('/admin_accounts') as reply:
            reply.raise_for_status()
            return reply.json()
    def admin_login(self):
        with self.get('/admin_login') as reply:
            reply.raise_for_status()
            return reply.json()["access_token"]
    def get_config(self):
        with self.get('/native/admin/config') as reply:
            reply.raise_for_status()
            return reply.json()
    def set_config(self, json):
        with self.put('/native/admin/config', json=json) as reply:
            reply.raise_for_status()

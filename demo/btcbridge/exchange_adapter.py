"""Reuse the exchange's local wallet against this isolated chain, without changing its running demo."""
import importlib.util
from common import ROOT,API,CLI,WEB_PORT,NODE_PORT
spec=importlib.util.spec_from_file_location('btcbridge_exchange_wallet',ROOT/'demo/bridge.py')
wallet=importlib.util.module_from_spec(spec)
spec.loader.exec_module(wallet)
wallet.API=API
wallet.CLI=str(CLI)
wallet.PORT=WEB_PORT
ORIGIN=f'http://exchange.psibase.localhost:{NODE_PORT}'

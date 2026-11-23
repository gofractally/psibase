"""No live feed, blockchain writes, bot restarts or process signals in these tests."""
from contextlib import redirect_stdout
from concurrent.futures import Future
from decimal import Decimal
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import market_activity as bot


def market(x=13_100_000_000):
    y=x*57000//10000
    return {'id':1,'base':1,'quote':2,'x':x,'y':y,'k':str(x*y),'base_lot':10000,'quote_tick':1}


def feed():
    value=bot.LiveFeed.__new__(bot.LiveFeed)
    value.lock=threading.Lock()
    value.price,value.received,value.tick_time=None,0,None
    value.heartbeat_received=0
    return value


class MarketActivityTests(unittest.TestCase):
    def test_activity_lock_and_pid_use_the_selected_chain_state_directory(self):
        with TemporaryDirectory() as directory,patch.object(bot,'state_dir',return_value=Path(directory)),patch.object(bot,'active',return_value=None):
            with bot.activity_lock():
                self.assertTrue((Path(directory)/'market-activity.lock').exists())
                self.assertEqual((Path(directory)/'market-activity.pid').read_text(),str(bot.os.getpid()))
            self.assertFalse((Path(directory)/'market-activity.pid').exists())

    def test_external_price_is_absolute_and_never_rebased(self):
        self.assertEqual(bot.target_price(Decimal('57125.25'),57000),Decimal('57125.25'))
        self.assertEqual(bot.target_price(Decimal('56500'),57000),Decimal('56500'))

    def test_invalid_or_large_feed_jump_never_places_unbounded_trade(self):
        for live in (Decimal('0'),Decimal('-1'),Decimal('60000')):
            with self.assertRaises(ValueError):bot.target_price(live,50000)

    def test_stale_or_missing_feed_has_no_synthetic_price_fallback(self):
        value=feed()
        with self.assertRaises(ValueError):value.current()
        value.price,value.received=Decimal('50000'),time.monotonic()-6
        with self.assertRaises(ValueError):value.current()
        value.received,value.tick_time=time.monotonic(),'source-time'
        self.assertEqual(value.current(),(Decimal('50000'),'source-time'))

    def test_heartbeat_and_invalid_tickers_cannot_refresh_an_old_price(self):
        value=feed();value.price,value.received=Decimal('57000'),time.monotonic()-6
        previous=value.received
        for tick in ({'type':'heartbeat'},{'type':'ticker','price':'NaN'},
                     {'type':'ticker','price':'bad'},{'type':'ticker','price':'0'},
                     {'type':'unknown','price':'58000'}):value.accept(tick)
        self.assertEqual(value.received,previous)
        with self.assertRaises(ValueError):value.current()
        value.accept({'type':'ticker','price':'57123.45','time':'real-ticker'})
        self.assertEqual(value.current(),(Decimal('57123.45'),'real-ticker'))

    def test_dead_feed_worker_fails_closed(self):
        value=feed();value.price,value.received=Decimal('57000'),time.monotonic()
        value.process=MagicMock();value.process.poll.return_value=1
        with self.assertRaises(RuntimeError):value.current()

    def test_adaptive_cap_is_larger_but_bounded_by_reserve_and_execution_slippage(self):
        m=market()
        for target in (Decimal('56500'),Decimal('57500')):
            plan=bot.plan_trade(m,target,0)
            self.assertGreater(plan['base_amount'],2_500_000)
            self.assertLessEqual(plan['base_amount'],20_000_000)
            self.assertLessEqual(plan['base_amount'],int(Decimal(m['x'])*Decimal('.0015')))
            u,v=(m['x'],m['y']) if plan['sell'] else (m['y'],m['x'])
            actual=v-(int(m['k'])+u+plan['amount']-1)//(u+plan['amount'])
            self.assertGreaterEqual(actual,plan['min_output'])
        with self.assertRaises(ValueError):bot.plan_trade(market(1_000_000),Decimal('56500'),0)

    def test_pending_same_direction_trades_are_reserved_in_the_minimum(self):
        m=market()
        for target in (Decimal('56500'),Decimal('57500')):
            first=bot.plan_trade(m,target,0)
            pending=[{'sell':first['sell'],'amount':first['amount']} for _ in range(2)]
            planned=bot.plan_trade(m,target,0,pending)
            u,v=(m['x'],m['y']) if first['sell'] else (m['y'],m['x'])
            k=int(m['k'])
            for preceding in pending:
                u+=preceding['amount'];v=(k+u-1)//u
            actual=v-(k+u+planned['amount']-1)//(u+planned['amount'])
            # The previous stale-snapshot guard rejects this ordinary pipeline.
            self.assertGreater(first['min_output'],actual)
            self.assertGreaterEqual(actual,planned['min_output'])
            self.assertEqual(planned['pending_input'],2*first['amount'])
            opposite=[{'sell':not first['sell'],'amount':first['amount']}]
            self.assertEqual(bot.plan_trade(m,target,0,opposite)['min_output'],first['min_output'])

    def test_only_an_explicit_native_minimum_rejection_is_recoverable(self):
        actions=[bot.action(bot.TAKER,'exchange','trade',{'market':1})]
        message="service 'exchange' aborted with message: minimum output"
        complete=lambda body,code:SimpleNamespace(stdout=json.dumps(body),stderr='',returncode=code)
        rejected={'error':message,'actionTraces':[{'action':actions[0],'error':'minimum output'}]}
        with patch.object(bot.subprocess,'run',return_value=complete(rejected,1)):
            with self.assertRaises(bot.MinimumOutputRejected):bot.submit_concurrently(actions)
        for response in (complete({},0),complete({'error':message},1),complete({'error':message,'actionTraces':[]},1),
                         complete({'actionTraces':[{'action':{'sender':'other','service':'exchange','method':'trade'}}]},0),
                         SimpleNamespace(stdout='',stderr='connection closed',returncode=1)):
            with patch.object(bot.subprocess,'run',return_value=response):
                with self.assertRaises(Exception) as caught:bot.submit_concurrently(actions)
                self.assertNotIsInstance(caught.exception,bot.MinimumOutputRejected)
        trace={'actionTraces':[{'action':actions[0]}]}
        with patch.object(bot.subprocess,'run',return_value=complete(trace,0)):
            self.assertIsInstance(bot.submit_concurrently(actions),float)

    def run_after_confirmation_failure(self,failure):
        fake=MagicMock();fake.current.side_effect=[(Decimal('57500'),'old')]*2+[(Decimal('56500'),'new')]*2
        handlers={};executor=MagicMock();captured=[]
        def submit(fn,actions):
            captured.append(actions)
            future=Future()
            if len(captured)==1:future.set_exception(failure)
            else:
                future.set_result(123)
                handlers[bot.signal.SIGTERM]()
            return future
        executor.submit.side_effect=submit
        state={'markets':[market()],'balances':[{'token':1,'spendable':10**10},{'token':2,'spendable':10**10}]}
        with TemporaryDirectory() as directory,patch.object(bot,'STATUS',Path(directory)/'status.json'),patch.object(bot,'MARKER',Path(directory)/'marker.json'),patch.object(bot,'LiveFeed',return_value=fake),patch.object(bot.signal,'signal',side_effect=lambda sig,handler:handlers.__setitem__(sig,handler)),patch.object(bot,'read_state',return_value=state),patch.object(bot,'inventory',return_value=[]),patch.object(bot,'ThreadPoolExecutor',return_value=executor),redirect_stdout(io.StringIO()):
            error=None
            try:bot.run_locked({'market':1,'base':1,'quote':2,'center':57000},0)
            except BaseException as caught:error=caught
            status=json.loads(bot.STATUS.read_text())
        fake.close.assert_called_once()
        return captured,status,error

    def test_known_rejection_plans_a_new_tick_from_a_fresh_feed(self):
        actions,status,error=self.run_after_confirmation_failure(bot.MinimumOutputRejected('minimum output'))
        self.assertIsNone(error)
        self.assertEqual(len(actions),2)
        self.assertFalse(actions[0][-1]['data']['sell_base'])
        self.assertTrue(actions[1][-1]['data']['sell_base'])
        self.assertEqual((status['state'],status['submitted'],status['confirmed'],status['rejected']),('stopped',2,1,1))
        self.assertEqual(status['target'],'56500')

    def test_unknown_confirmation_stops_without_replaying_or_a_new_submission(self):
        actions,status,error=self.run_after_confirmation_failure(TimeoutError('unknown native outcome'))
        self.assertIsInstance(error,TimeoutError)
        self.assertEqual(len(actions),1)
        self.assertEqual((status['state'],status['submitted'],status['confirmed'],status['rejected']),('failed',1,0,0))

    def test_slow_query_then_fast_query_cannot_burst_submissions(self):
        clock=[0.0];submitted=[];handlers={};reads=[1.5,.01]
        class StopEvent:
            stopped=False
            def set(self):self.stopped=True
            def is_set(self):return self.stopped
            def wait(self,seconds):clock[0]+=seconds
        fake=MagicMock();fake.current.return_value=(Decimal('57500'),'source-time')
        executor=MagicMock();future=MagicMock()
        future.done.return_value=True;future.cancelled.return_value=False;future.result.return_value=123
        def state(_):
            clock[0]+=reads.pop(0)
            return {'markets':[market()],'balances':[{'token':1,'spendable':10**10},{'token':2,'spendable':10**10}]}
        def submit(fn,actions):
            submitted.append(clock[0])
            if len(submitted)==2:handlers[bot.signal.SIGTERM]()
            return future
        executor.submit.side_effect=submit
        with TemporaryDirectory() as directory,patch.object(bot,'STATUS',Path(directory)/'status.json'),patch.object(bot,'MARKER',Path(directory)/'marker.json'),patch.object(bot,'LiveFeed',return_value=fake),patch.object(bot.signal,'signal',side_effect=lambda sig,handler:handlers.__setitem__(sig,handler)),patch.object(bot,'read_state',side_effect=state),patch.object(bot,'inventory',return_value=[]),patch.object(bot,'ThreadPoolExecutor',return_value=executor),patch.object(bot.threading,'Event',StopEvent),patch.object(bot.time,'monotonic',side_effect=lambda:clock[0]),redirect_stdout(io.StringIO()):
            bot.run_locked({'market':1,'base':1,'quote':2,'center':57000},1)
        self.assertEqual(len(submitted),2)
        self.assertGreaterEqual(submitted[1]-submitted[0],1)

    def test_recentering_does_not_move_operating_band(self):
        config={'center':57000,'operating_center':57000,'quote_center':57000}
        self.assertFalse(bot.recenter_quotes(config,Decimal('57400'),59,0))
        self.assertTrue(bot.recenter_quotes(config,Decimal('57400'),60,0))
        self.assertEqual(config['quote_center'],57400)
        self.assertEqual(config['operating_center'],57000)
        with self.assertRaises(ValueError):bot.target_price(Decimal('60000'),config['operating_center'])

    def test_inventory_cancels_only_dedicated_stale_orders_and_guards_new_quotes(self):
        owner=bot.MAKERS[0];config={'market':1,'base':1,'quote':2,'center':57000,'quote_center':57000}
        state={'markets':[market()],'positions':[
            {'owner':owner,'market':1,'bid':True,'price':50000,'refund':100},
            {'owner':'alice','market':1,'bid':True,'price':49000,'refund':100},
            {'owner':owner,'market':2,'bid':True,'price':48000,'refund':100}],
            'balances':[{'token':1,'spendable':10**10},{'token':2,'spendable':10**10}]}
        with patch.object(bot,'read_state',return_value=state),patch.object(bot,'settlements',return_value=([],{})),patch.object(bot,'send') as send:
            actions=bot.inventory(config,refresh=True,owners=(owner,),plan_only=True,max_updates=4,max_cancels=4)
            send.assert_not_called()
        cancels=[a for a in actions if a['method']=='cancel']
        self.assertEqual([(a['sender'],a['data']['price']) for a in cancels],[(owner,50000)])
        quotes=[a for a in actions if a['method']=='limit']
        self.assertLessEqual(len(quotes),4)
        for a in quotes:
            self.assertEqual(a['sender'],owner)
            self.assertEqual(a['data']['market'],1)
            p=a['data']['price']
            self.assertTrue(p<57000*.998 if a['data']['bid'] else p>57000*1.002)
        with patch.object(bot,'read_state') as read:
            with self.assertRaises(ValueError):bot.inventory(config,owners=('alice',),plan_only=True)
            read.assert_not_called()

    def test_already_running_start_has_no_funding_or_order_side_effect(self):
        with patch('sys.argv',['market_activity.py','start']),patch.object(bot,'active',return_value=123),patch.object(bot,'setup') as setup,patch.object(bot,'fund_accounts') as fund,patch.object(bot,'inventory') as inventory,redirect_stdout(io.StringIO()):
            bot.main()
            setup.assert_not_called();fund.assert_not_called();inventory.assert_not_called()

    def test_failed_run_records_failure_and_closes_feed_once(self):
        fake=MagicMock();fake.current.return_value=(Decimal('57000'),'real-tick')
        with TemporaryDirectory() as directory,patch.object(bot,'STATUS',Path(directory)/'status.json'),patch.object(bot,'LiveFeed',return_value=fake),patch.object(bot.signal,'signal'),patch.object(bot,'read_state',side_effect=RuntimeError('native unavailable')),redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,'native unavailable'):
                bot.run_locked({'market':1,'base':1,'quote':2,'center':57000},1)
            status=json.loads(bot.STATUS.read_text())
            self.assertEqual(status['state'],'failed')
            self.assertIn('native unavailable',status['reason'])
            fake.close.assert_called_once()

    def test_repeated_stop_signal_cleans_once_and_never_submits_new_trade(self):
        fake=MagicMock();fake.current.return_value=(Decimal('57000'),'real-tick');handlers={}
        def remember(sig,handler):handlers[sig]=handler
        def state(_):
            handlers[bot.signal.SIGTERM]();handlers[bot.signal.SIGTERM]()
            return {'markets':[market()],'balances':[{'token':2,'spendable':10**10}]}
        with TemporaryDirectory() as directory,patch.object(bot,'STATUS',Path(directory)/'status.json'),patch.object(bot,'MARKER',Path(directory)/'marker.json'),patch.object(bot,'LiveFeed',return_value=fake),patch.object(bot.signal,'signal',side_effect=remember),patch.object(bot,'read_state',side_effect=state),patch.object(bot,'inventory',return_value=[]),patch.object(bot,'submit_concurrently') as submit,redirect_stdout(io.StringIO()):
            bot.run_locked({'market':1,'base':1,'quote':2,'center':57000},1)
            self.assertEqual(json.loads(bot.STATUS.read_text())['state'],'stopped')
            fake.close.assert_called_once();submit.assert_not_called()

    def test_latest_ticker_plan_is_used_after_maintenance_and_maintenance_is_first(self):
        fake=MagicMock();fake.current.side_effect=[(Decimal('57050'),'old'),(Decimal('56950'),'new')]
        handlers={};executor=MagicMock();future=MagicMock()
        future.cancelled.return_value=False;future.result.return_value=123
        captured=[]
        def submit(fn,actions):
            captured.extend(actions);handlers[bot.signal.SIGTERM]()
            return future
        executor.submit.side_effect=submit
        state={'markets':[market()],'balances':[{'token':1,'spendable':10**10},{'token':2,'spendable':10**10}]}
        maintenance=bot.action(bot.MAKERS[0],'exchange','limit',{'market':1,'bid':True,'price':56000,'amount':10000})
        with TemporaryDirectory() as directory,patch.object(bot,'STATUS',Path(directory)/'status.json'),patch.object(bot,'MARKER',Path(directory)/'marker.json'),patch.object(bot,'LiveFeed',return_value=fake),patch.object(bot.signal,'signal',side_effect=lambda sig,handler:handlers.__setitem__(sig,handler)),patch.object(bot,'read_state',return_value=state) as read,patch.object(bot,'inventory',return_value=[maintenance]),patch.object(bot,'ThreadPoolExecutor',return_value=executor),redirect_stdout(io.StringIO()):
            bot.run_locked({'market':1,'base':1,'quote':2,'center':57000},1)
            self.assertEqual(read.call_count,2)
            self.assertEqual(captured[0],maintenance)
            self.assertEqual(captured[-1]['sender'],bot.TAKER)
            self.assertTrue(captured[-1]['data']['sell_base'])
            self.assertEqual(json.loads(bot.STATUS.read_text())['target'],'56950')


if __name__=='__main__':unittest.main(verbosity=2)

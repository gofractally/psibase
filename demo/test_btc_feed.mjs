// Importing the decoder does not connect or start a background worker.
import assert from 'node:assert/strict';
import { decodeFeedMessage } from './btc_feed.mjs';
const message = value => decodeFeedMessage(JSON.stringify({ product_id: 'BTC-USD', ...value }));
assert.deepEqual(message({type:'ticker',price:'57123.45',time:'live',sequence:42}),
                 {type:'ticker',price:'57123.45',time:'live',sequence:42});
assert.deepEqual(message({type:'heartbeat',time:'alive'}), {type:'heartbeat',time:'alive'});
for (const price of ['NaN','Infinity','-1','0','0x10','',null])
  assert.equal(message({type:'ticker',price}),null);
assert.equal(decodeFeedMessage(JSON.stringify({product_id:'ETH-USD',type:'ticker',price:'57000'})),null);
assert.equal(message({type:'subscriptions'}),null);
assert.throws(() => decodeFeedMessage('not JSON'));
console.log('BTC feed decoding: all assertions passed; no WebSocket opened.');

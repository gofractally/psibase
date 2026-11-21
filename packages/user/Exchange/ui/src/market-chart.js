import { tradePriceAtoms } from './order-book.js';

export function candlesFromTrades(trades, basePrecision, intervalSeconds = 5, limit = 60) {
  if (![5, 15, 60].includes(intervalSeconds)) throw new Error('Unsupported candle interval');
  const ordered = trades.map(t=>({...t,timestamp:Date.parse(t.time)}))
    .filter(t=>Number.isFinite(t.timestamp)&&BigInt(t.base_amount?.value??t.base_amount??0)>0n)
    .sort((a,b)=>a.timestamp-b.timestamp || (BigInt(a.event_id)<BigInt(b.event_id)?-1:1));
  if(!ordered.length)return [];
  const width=intervalSeconds*1000;
  const lastBucket=Math.floor(ordered.at(-1).timestamp/width)*width;
  const firstBucket=lastBucket-(limit-1)*width;
  const buckets=new Map();
  for(const trade of ordered){
    const time=Math.floor(trade.timestamp/width)*width;
    if(time<firstBucket)continue;
    const price=tradePriceAtoms(trade,basePrecision);
    if(price===null)continue;
    const volume=BigInt(trade.base_amount?.value??trade.base_amount);
    const previous=buckets.get(time);
    if(previous){previous.high=price>previous.high?price:previous.high;previous.low=price<previous.low?price:previous.low;previous.close=price;previous.volume+=volume;previous.trades++;}
    else buckets.set(time,{time,open:price,high:price,low:price,close:price,volume,trades:1});
  }
  return [...buckets.values()];
}
export function depthBounds(currentPrice, percent) {
  percent=Number(percent);
  if(!Number.isFinite(percent)||percent<.05||percent>25)throw new Error('Choose a depth range from 0.05% to 25%.');
  return {low:currentPrice*(1-percent/100),high:currentPrice*(1+percent/100)};
}

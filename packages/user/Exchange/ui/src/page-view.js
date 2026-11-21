// An explicitly opened page is a point-in-time view. Keep it separate from
// the fresh scoped snapshot used for funding and portfolio arithmetic.
export function mergeRows(previous, incoming, identify) {
  const rows = new Map(previous.map(row => [identify(row), row]));
  for (const row of incoming) rows.set(identify(row), row);
  return [...rows.values()];
}
export function createPageView(scope, identify) {
  let epoch = 0, rows = [], next = null, openedAt = null, loading = false;
  return {
    reset(nextScope = scope) { scope = nextScope; epoch++; rows = []; next = null; openedAt = null; loading = false; },
    begin(requestScope = scope) {
      if (requestScope !== scope || loading) return null;
      loading = true;
      return { scope, epoch };
    },
    accept(ticket, page, { append = false, time = Date.now() } = {}) {
      if (!ticket || ticket.scope !== scope || ticket.epoch !== epoch) return false;
      if (!Array.isArray(page.rows) || page.rows.length > 200 || (page.next != null && (typeof page.next !== 'string' || !page.next.length || page.next.length > 4096))) throw new Error('Invalid bounded page.');
      rows = append ? mergeRows(rows, page.rows, identify) : [...page.rows];
      next = page.next ?? null; openedAt ??= time; loading = false;
      return true;
    },
    finish(ticket) { if (ticket?.scope === scope && ticket.epoch === epoch) loading = false; },
    get rows() { return rows; }, get next() { return next; }, get openedAt() { return openedAt; }, get loading() { return loading; }, get scope() { return scope; },
  };
}

const marketId = value => {
  if(typeof value!=='string'||!/^\d+$/.test(value))return null;
  const n=BigInt(value);return n>0n&&n<=(1n<<64n)-1n?String(n):null;
};
// Native prompt returns restore their reviewed market before resolving the
// selected scope. An old address-bar query cannot override that exact draft.
export function initialMarket(search,draft){
  return marketId(draft?.market)||marketId(new URLSearchParams(search).get('market'));
}
export function marketUrl(current,id){
  const normalized=marketId(String(id));if(!normalized)throw new Error('Invalid market ID.');
  const url=new URL(current);url.searchParams.set('market',normalized);return url.href;
}

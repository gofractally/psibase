// Authority comes from native Host/Supervisor. Private queries never select an
// owner; financial expectedOwner arguments are guards checked against Host,
// and cannot choose or impersonate the action sender.
export function createNativeWallet(supervisor, { onPrompt = () => {}, isPrompt = () => false } = {}) {
  const decode = result => typeof result === 'string' ? JSON.parse(result) : result;
  async function call(service, plugin, intf, method, params = []) {
    try {
      return await supervisor.functionCall({ service, plugin, intf, method, params }, { enabled: false, returnPath: '/' });
    } catch (error) {
      if (isPrompt(error)) {
        onPrompt(error, { service, plugin, intf, method, params });
        // A native prompt interrupts before the transaction is submitted.
        // Keep this call pending while the browser leaves for its native UI.
        return await new Promise(() => {});
      }
      throw error;
    }
  }
  const exchange = (intf, method, params) => call('exchange', 'plugin', intf, method, params).then(decode);
  function fundingResult(result){
    if(result?.status==='scan_progress'){if(result.executed!==false||result.prepared!==0||typeof result.funding_cursor!=='string'||!result.funding_cursor)throw new Error('Invalid native funding continuation.');return result;}
    if(result?.status==='executed'&&result.executed===true&&Number.isInteger(result.prepared)&&result.prepared>=0&&result.prepared<=32)return result;
    if(result?.status!=='prepared'||result.executed!==false||!Number.isInteger(result.prepared)||result.prepared<1||result.prepared>32)throw new Error('Native Exchange returned an invalid transaction result.');
    return result;
  }
  async function funded(method, params) {
    // Only confirmed useful preparation permits one automatic followup.
    for(let attempts=0;attempts<2;attempts++){
      const result=fundingResult(await exchange('user',method,params));
      if(result.status!=='prepared'||attempts===1)return result;
    }
  }
  return {
    currentUser: () => call('host', 'accounts', 'api', 'getCurrentUser'),
    accounts: () => call('host', 'accounts', 'activeApp', 'getConnectedAccounts'),
    connect: () => call('host', 'accounts', 'activeApp', 'connectAccount'),
    login: account => call('host', 'accounts', 'activeApp', 'login', [account]),
    logout: () => call('host', 'accounts', 'activeApp', 'logout'),
    snapshot: () => exchange('queries', 'snapshot', []),
    scopedSnapshot: market => exchange('queries','scopedSnapshot',[market == null ? undefined : String(market)]),
    positions: (kind,market,after,limit=100) => exchange('queries','positions',[kind,market == null ? undefined : String(market),after || undefined,limit]),
    assets: (after,limit=100) => exchange('queries','assets',[after || undefined,limit]),
    asset: token => exchange('queries','asset',[Number(token)]),
    stops: (before, limit = 100) => exchange('queries', 'stops', [before == null ? undefined : String(before), limit]),
    execute: (method,args,expectedOwner,fundingAfter) => funded('execute',[method,JSON.stringify(args),expectedOwner,fundingAfter||undefined]),
    withdraw: (tokenId,amount,expectedOwner,fundingAfter) => funded('withdraw',[Number(tokenId),String(amount),expectedOwner,fundingAfter||undefined]),
    releasePosition: (kind,market,side,price,expectedOwner) => exchange('user','releasePosition',[kind,String(market),side,price == null ? undefined : String(price),expectedOwner]),
    releaseStop: (generation, expectedOwner) => exchange('user', 'releaseStop', [String(generation), expectedOwner]),
    history: (tokenId, before, limit = 30) => exchange('queries', 'history', [Number(tokenId), before || undefined, limit]),
    trustStatus: () => call('tokens', 'plugin', 'transfer', 'trustStatus', []),
    approvalStatus: () => call('tokens', 'plugin', 'transfer', 'approvalStatus', []),
    revokeTrust: () => call('tokens', 'plugin', 'transfer', 'revokeTrust', []),
    deposit: (tokenId, amount, expectedOwner) => call('tokens', 'plugin', 'transfer', 'credit', [Number(tokenId), 'exchange', String(amount), 'Exchange deposit', expectedOwner]),
    resume: intent => {
      if(intent?.service==='tokens'&&intent.plugin==='plugin'&&intent.intf==='transfer'&&intent.method==='credit'&&intent.params?.[1]==='exchange')return call('tokens','plugin','transfer','credit',intent.params);
      if(intent?.service==='exchange'&&intent.plugin==='plugin'&&intent.intf==='user'&&['execute','withdraw'].includes(intent.method))return exchange('user',intent.method,intent.params).then(fundingResult);
      if(intent?.service==='exchange'&&intent.plugin==='plugin'&&intent.intf==='user'&&['releaseStop','releasePosition'].includes(intent.method))return exchange('user',intent.method,intent.params);
      throw new Error('This wallet request cannot be resumed. Review the form and submit again.');
    },
  };
}

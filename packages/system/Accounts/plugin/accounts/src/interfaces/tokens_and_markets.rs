use crate::bindings::exports::accounts::plugin::name_market::Guest as NameMarket;
use crate::bindings::exports::accounts::plugin::tokens::Guest as Tokens;
use crate::bindings::host::types::types::Error;
use crate::bindings::name_market::plugin as NameMarketPlugin;
use crate::bindings::tokens::plugin as TokensPlugin;
use crate::plugin::AccountsPlugin;

impl Tokens for AccountsPlugin {
    fn get_system_token() -> Result<Option<TokensPlugin::types::SystemTokenInfo>, Error> {
        TokensPlugin::helpers::get_system_token()
    }

    fn get_user_balances(user: String) -> Result<Vec<TokensPlugin::types::UserBalance>, Error> {
        TokensPlugin::helpers::get_user_balances(&user)
    }
}

impl NameMarket for AccountsPlugin {
    fn can_create_account() -> bool {
        NameMarketPlugin::api::can_create_account()
    }

    fn get_markets_overview() -> Result<NameMarketPlugin::types::MarketsOverview, Error> {
        NameMarketPlugin::api::get_markets_overview()
    }
}

#[cfg(not(feature = "legacy-platform"))]
use bindings::transact::plugin::api::add_action_to_transaction;
#[cfg(feature = "legacy-platform")]
use bindings::transact::plugin::intf::add_action_to_transaction;
use bindings::{
    exports::favor::plugin::{api::Guest as Api, authorized::Guest as Authorized},
    host::types::types::Error,
};
use psibase::{AccountNumber};

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "Read your private credit network, change credit limits, send payments and acknowledge repayments",
    }
    functions {
        Low => [],
        Medium => [],
        High => [graphql, set_line, set_receiving, create_request, revoke_request, pay, settle],
    }
}
psibase::plugin_error! {
    pub ErrorType
    InvalidInput(message: String) => "{message}"
}
fn account(value: &str) -> Result<AccountNumber, Error> {
    AccountNumber::from_exact(value)
        .map_err(|_| ErrorType::InvalidInput("Invalid account name".into()).into())
}
struct TrustPlugin;
impl Api for TrustPlugin {
    fn set_line(
        peer: String,
        symbol: String,
        limit: String,
        fee_ppm: u32,
        forwarding: bool,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_line)?;
        let args = ::favor::action_structs::set_line {
            peer: account(&peer)?,
            symbol,
            limit,
            fee_ppm,
            forwarding,
        };
        add_action_to_transaction(
            <::favor::action_structs::set_line as psio::interface::Method>::NAME,
            &psio::to_pssz(&args),
        )
    }
    fn set_receiving(request_only: bool) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::set_receiving)?;
        add_action_to_transaction(
            <::favor::action_structs::set_receiving as psio::interface::Method>::NAME,
            &psio::to_pssz(&::favor::action_structs::set_receiving { request_only }),
        )
    }
    fn create_request(
        hash: String,
        symbol: String,
        amount: String,
        expires_at: String,
        payer: Option<String>,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::create_request)?;
        let expires_at = expires_at
            .parse::<i64>()
            .map_err(|_| ErrorType::InvalidInput("Invalid request expiry".into()))?;
        let payer = payer.map(|p| account(&p)).transpose()?;
        add_action_to_transaction(
            <::favor::action_structs::create_request as psio::interface::Method>::NAME,
            &psio::to_pssz(&::favor::action_structs::create_request {
                hash,
                symbol,
                amount,
                expires_at,
                payer,
            }),
        )
    }
    fn revoke_request(hash: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::revoke_request)?;
        add_action_to_transaction(
            <::favor::action_structs::revoke_request as psio::interface::Method>::NAME,
            &psio::to_pssz(&::favor::action_structs::revoke_request { hash }),
        )
    }
    fn pay(
        payee: String,
        symbol: String,
        amount: String,
        max_total: String,
        encoded_route: String,
        reference: String,
        memo: String,
    ) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::pay)?;
        let args = ::favor::action_structs::pay {
            payee: account(&payee)?,
            symbol,
            amount,
            max_total,
            encoded_route,
            reference,
            memo,
        };
        add_action_to_transaction(<::favor::action_structs::pay as psio::interface::Method>::NAME, &psio::to_pssz(&args))
    }
    fn settle(peer: String, symbol: String, amount: String, nonce: String) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::settle)?;
        let args = ::favor::action_structs::settle {
            peer: account(&peer)?,
            symbol,
            amount,
            nonce,
        };
        add_action_to_transaction(<::favor::action_structs::settle as psio::interface::Method>::NAME, &psio::to_pssz(&args))
    }
}
impl Authorized for TrustPlugin {
    fn graphql(query: String) -> Result<String, Error> {
        trust::assert_authorized(trust::FunctionName::graphql)?;
        bindings::host::http::api::post_graphql_get_json(&query)
    }
}
bindings::export!(TrustPlugin with_types_in bindings);

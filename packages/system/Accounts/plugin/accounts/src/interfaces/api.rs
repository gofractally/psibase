use crate::bindings::exports::accounts::plugin::api::{Guest as API, *};
use crate::bindings::transact::plugin::intf as Transact;
use crate::errors::ErrorType::*;
use crate::plugin::AccountsPlugin;

use crate::trust::*;
use psibase::fracpack::Pack;
use psibase::services::accounts as AccountsService;
use psibase::AccountNumber;

impl API for AccountsPlugin {
    fn set_auth_service(service_name: String) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::set_auth_service,
            vec!["homepage".into(), "namemarket".into()],
        )?;

        let account_num: AccountNumber = AccountNumber::from_exact(&service_name)
            .map_err(|_| InvalidAccountName(service_name))?;
        Transact::add_action_to_transaction(
            "setAuthServ",
            &AccountsService::action_structs::setAuthServ {
                authService: account_num,
            }
            .packed(),
        )?;
        Ok(())
    }
}

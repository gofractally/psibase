#[psibase::service(name = "auth-guild")]
pub mod service {
    use psibase::services::transact::ServiceMethod;
    use psibase::{check_some, *};

    #[action]
    #[allow(non_snake_case)]
    fn canAuthUserSys(user: AccountNumber) {
        let guild = check_some(
            psibase::services::fractals::Wrapper::call().get_guild(user),
            "account must be a guild",
        );
        let council = psibase::services::fractals::Wrapper::call().get_g_counc(user);
        let is_council = council.is_some_and(|council| council.len() > 0);
        let is_representative = guild.rep.is_some();
        check(
            is_council || is_representative,
            "account must have a sitting council or representative",
        );
    }

    #[action]
    #[allow(non_snake_case)]
    fn checkAuthSys(
        flags: u32,
        _requester: AccountNumber,
        sender: AccountNumber,
        action: ServiceMethod,
        _allowedActions: Vec<ServiceMethod>,
        claims: Vec<Claim>,
    ) {
        abort_message("checkAuthsys not needed");
    }

    fn is_sufficient_actors(sender: AccountNumber, authorizers: Vec<AccountNumber>) -> bool {
        let guild = check_some(
            psibase::services::fractals::Wrapper::call().get_guild(sender),
            "account must be a guild",
        );
        let includes_representative = guild.rep.is_some_and(|rep| authorizers.contains(&rep));
        if includes_representative {
            return true;
        }
        let council = check_some(
            psibase::services::fractals::Wrapper::call().get_g_counc(sender),
            "no council found",
        );
        let required_council_minimum: u8 = (council.len() as u8 * 2 + 2) / 3;
        let council_approvals = authorizers.into_iter().fold(0, |acc, account| {
            if council.contains(&account) {
                acc + 1
            } else {
                acc
            }
        });
        council_approvals >= required_council_minimum
    }

    #[action]
    #[allow(non_snake_case)]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        is_sufficient_actors(sender, authorizers)
    }

    #[action]
    #[allow(non_snake_case)]
    fn isRejectSys(
        sender: AccountNumber,
        rejecters: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        is_sufficient_actors(sender, rejecters)
    }
}

#[cfg(test)]
mod tests;

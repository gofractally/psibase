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
        // check authsys runs when john proposes a tx on behalf of a guild on johns auth service
        // but this does not run at all for the guild account itself - validate this by aboring
        //
        //

        // No additional checks needed beyond isAuthSys?
        // add abort message here

        // 1. Either the guild is the sender, then we check if the guild is authed to do it
        // or
        // 2. Fractal is the sender, john is proposer, we take the sender
        // lookup the fractal, find the legislative guid council and representative
        // check if john is in either group sufficently or other authorizers are in the list

        // James
        // The sender of the propose action is john
        // the sender of the internal action is the fractal
        // so there will be a hop to get to the guild auth
        // the fractal will use auth-delegate, delegated to legislative account.
        // that account uses guild auth.
        //
        // there are certain actions that are defined on the fractals service
        // that are not auth by legilative

        // 3 roles
        // Legislative - Create a new law, the same thing, change the name
        // Judicial - Exile a member
        // Fractal -  auth-delegate for everything else,

        // the proposer is john
        // sender is the guild
        //
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

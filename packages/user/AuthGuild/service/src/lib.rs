#[psibase::service(name = "auth-guild")]
pub mod service {
    use psibase::fracpack::{Pack, Unpack};
    use psibase::services::auth_delegate;
    use psibase::services::fractals::Wrapper as Fractals;
    use psibase::services::transact::{self, ServiceMethod};
    use psibase::{check_some, *};

    fn council_approval_threshold(len: usize) -> u8 {
        (len as u8 * 2 + 2) / 3
    }

    fn check_council_or_delegate(
        sender: AccountNumber,
        signers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
        is_approval: bool,
    ) -> bool {
        if auth_set
            .as_ref()
            .is_some_and(|auth_set| auth_set.contains(&sender))
        {
            return false;
        }

        let guild_rep = check_some(
            Fractals::call().get_guild(sender),
            "account must be a guild",
        )
        .rep;

        let council = Fractals::call().get_g_counc(sender).unwrap_or_default();

        let representative_included = guild_rep.is_some_and(|rep| signers.contains(&rep));
        let council_member_included = council
            .iter()
            .any(|council_member| signers.contains(council_member));

        let is_guild_consultation_required = council_member_included && !is_approval;

        if representative_included && !is_guild_consultation_required {
            return true;
        }

        let council_success = {
            if council.is_empty() {
                false
            } else {
                let council_members_signed = signers
                    .iter()
                    .filter(|&account| council.contains(account))
                    .count() as u8;

                let approval_min = council_approval_threshold(council.len());

                let threshold = if is_approval {
                    approval_min
                } else {
                    (council.len() as u8).saturating_sub(approval_min) + 1
                };
                council_members_signed >= threshold
            }
        };

        if council_success {
            return true;
        }
        if is_guild_consultation_required {
            return false;
        }

        let mut auth_set_next = auth_set.unwrap_or_default();
        auth_set_next.push(sender);

        guild_rep.map_or(false, |rep| {
            let auth_service = psibase::services::accounts::Wrapper::call().getAuthOf(rep);

            let is_auth_action = Action {
                service: auth_service,
                method: auth_delegate::action_structs::isAuthSys::ACTION_NAME.into(),
                sender: Wrapper::SERVICE,
                rawData: auth_delegate::action_structs::isAuthSys {
                    sender: rep,
                    authorizers: signers,
                    auth_set: Some(auth_set_next),
                }
                .packed()
                .into(),
            };

            bool::unpacked(&transact::Wrapper::call().runAs(is_auth_action, vec![])).unwrap()
        })
    }

    #[action]
    #[allow(non_snake_case)]
    fn canAuthUserSys(account: AccountNumber) {
        let guild = check_some(
            psibase::services::fractals::Wrapper::call().get_guild(account),
            "account must be a guild",
        );
        let council = psibase::services::fractals::Wrapper::call().get_g_counc(account);
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
        _flags: u32,
        _requester: AccountNumber,
        _sender: AccountNumber,
        _action: ServiceMethod,
        _allowedActions: Vec<ServiceMethod>,
        _claims: Vec<Claim>,
    ) {
        abort_message("checkAuthsys not needed");
    }

    #[action]
    #[allow(non_snake_case)]
    fn isAuthSys(
        sender: AccountNumber,
        authorizers: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        check_council_or_delegate(sender, authorizers, auth_set, true)
    }

    #[action]
    #[allow(non_snake_case)]
    fn isRejectSys(
        sender: AccountNumber,
        rejecters: Vec<AccountNumber>,
        auth_set: Option<Vec<AccountNumber>>,
    ) -> bool {
        check_council_or_delegate(sender, rejecters, auth_set, false)
    }
}

#[cfg(test)]
mod tests;

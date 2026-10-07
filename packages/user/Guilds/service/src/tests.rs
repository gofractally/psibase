#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper as Guilds;
    use psibase::services::fractals::Wrapper as Fractals;
    use psibase::*;

    const ALICE: AccountNumber = account!("alice");
    const BOB: AccountNumber = account!("bob");
    const FRACTAL: AccountNumber = account!("testfrac");
    const GUILD: AccountNumber = account!("testgild");

    fn gql(chain: &Chain, query: &str) -> serde_json::Value {
        chain
            .graphql(Guilds::SERVICE, query)
            .expect("guild graphql query")
    }

    /// A guild representative's endorsement is recorded as one vote. It does not
    /// satisfy the guild account's authority, so the applicant stays out.
    #[psibase::test_case(packages("Fractals", "AuthDyn", "TokenStream"))]
    fn rep_endorsement_does_not_admit_member(chain: Chain) -> Result<(), psibase::Error> {
        chain.new_account(ALICE).unwrap();
        chain.new_account(BOB).unwrap();

        Fractals::push_from(&chain, ALICE)
            .create_frac(FRACTAL, "Test".into(), "Mission".into())
            .get()?;
        Guilds::push_from(&chain, ALICE)
            .create_guild(FRACTAL, GUILD, "Guild".into())
            .get()?;
        Guilds::push_from(&chain, BOB)
            .apply_guild(GUILD, String::new())
            .get()?;
        Guilds::push_from(&chain, ALICE)
            .at_mem_app(GUILD, BOB, String::new(), true)
            .get()?;

        chain.start_block();

        let reply = gql(
            &chain,
            &format!(
                r#"query {{
                    guildMembership(guild: "{GUILD}", member: "{BOB}") {{ member }}
                    guildApplication(guild: "{GUILD}", applicant: "{BOB}") {{
                        applicant
                        score {{ current required }}
                    }}
                }}"#
            ),
        );
        let data = &reply["data"];
        let membership = &data["guildMembership"];
        let application = &data["guildApplication"];
        let current = application["score"]["current"].as_i64();
        let required = application["score"]["required"].as_i64();

        assert!(
            membership.is_null(),
            "bob was admitted by the representative's endorsement: {reply}"
        );
        assert!(
            application.is_object(),
            "application did not stay pending: {reply}"
        );
        assert_eq!(
            (current, required),
            (Some(1), Some(3)),
            "representative endorsement was not a single vote toward the threshold: {reply}"
        );

        Ok(())
    }
}

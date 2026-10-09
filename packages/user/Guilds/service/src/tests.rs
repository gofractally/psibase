#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::constants::GUILDS_QUERY_SERVICE;
    use crate::Wrapper as Guilds;
    use psibase::fracpack::Pack;
    use psibase::services::credentials::Wrapper as Credentials;
    use psibase::services::fractals::Wrapper as Fractals;
    use psibase::services::http_server;
    use psibase::services::invite::{InvPayload, Wrapper as Invite};
    use psibase::*;
    use serde_json::Value;

    const FRACTALS_WASM: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/wasm32-wasip1/release/fractals.wasm"
    ));
    const GUILDS_WASM: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/wasm32-wasip1/release/guilds.wasm"
    ));
    const R_GUILDS_WASM: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/wasm32-wasip1/release/r-guilds.wasm"
    ));
    const CREDENTIAL_WASM: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../system/target/wasm32-wasip1/release/credentials.wasm"
    ));

    fn invite_payload() -> Result<Vec<u8>, psibase::Error> {
        let (public_key, _private_key) = generate_keypair()?;
        let inv_pubkey_der = pem::parse(public_key.trim())
            .map_err(|e| psibase::Error::new(e))?
            .into_contents();
        let fingerprint = sha256(&inv_pubkey_der);

        Ok(InvPayload {
            fingerprint: fingerprint.to_vec(),
            secret: String::new(),
        }
        .packed())
    }

    fn assert_expiry_field_error(response: &Value, invite_id: u32) {
        let errors = response
            .get("errors")
            .and_then(|e| e.as_array())
            .expect("expected GraphQL errors");
        assert!(
            !errors.is_empty(),
            "expected a field error, not an abort: {response}"
        );

        let expiry_error = errors.iter().find(|error| {
            error
                .get("path")
                .and_then(|path| path.as_array())
                .is_some_and(|path| path.iter().any(|part| part == "expiry"))
        });
        let expiry_error = expiry_error.expect("expected an expiry field error");

        let message = expiry_error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or_default();
        assert!(
            message.contains(&format!("guild invite {invite_id}")),
            "expected Guilds-domain error text, got: {message}"
        );
        assert!(
            message.contains("no expiry"),
            "expected missing-credential/expiry error, got: {message}"
        );
    }

    fn deploy_test_services(chain: &Chain) {
        chain
            .deploy_service(Fractals::SERVICE, FRACTALS_WASM)
            .expect("deploy fractals service");
        chain
            .deploy_service(Guilds::SERVICE, GUILDS_WASM)
            .expect("deploy guilds service");
        chain
            .deploy_service(Credentials::SERVICE, CREDENTIAL_WASM)
            .expect("deploy credential service");
        psibase::services::setcode::Wrapper::push_from(chain, GUILDS_QUERY_SERVICE)
            .setCode(
                GUILDS_QUERY_SERVICE,
                0,
                0,
                R_GUILDS_WASM.to_vec().into(),
            )
            .get()
            .expect("deploy guilds query service");
        http_server::Wrapper::push_from(chain, Guilds::SERVICE)
            .registerServer(GUILDS_QUERY_SERVICE)
            .get()
            .expect("register guilds query server");
    }

    fn setup_guild(chain: &Chain) -> Result<AccountNumber, psibase::Error> {
        let producer = PRODUCER_ACCOUNT;
        let fractal = account!("gf001fract");
        let guild = account!("gf001guild");

        Fractals::push_from(chain, producer)
            .create_frac(fractal, "Test Fractal".into(), "Test mission".into())
            .get()?;

        Guilds::push_from(chain, producer)
            .create_guild(fractal, guild, "Test Guild".into())
            .get()?;

        Ok(guild)
    }

    #[psibase::test_case(packages(
        "Guilds",
        "Fractals",
        "Invite",
        "Credentials",
        "AuthDyn",
        "AuthDelegate",
        "Producers",
        "Evaluations",
        "Accounts",
        "Permissions",
        "Sites",
        "HttpServer",
        "Host",
        "Transact",
        "SetCode",
        "TokenStream",
    ))]
    fn test_guild_invite_expiry_missing_credential(
        chain: psibase::Chain,
    ) -> Result<(), psibase::Error> {
        deploy_test_services(&chain);

        let guild = setup_guild(&chain)?;
        let inviter = PRODUCER_ACCOUNT;
        let invite_id: u32 = 4242;
        let payload = invite_payload()?;

        Guilds::push_from(&chain, inviter)
            .inv_g_member(guild, invite_id, payload, 1, false)
            .get()?;

        let cid = Invite::push(&chain)
            .getInvite(invite_id)
            .get()?
            .expect("invite record should exist")
            .credential_id();

        Credentials::push_from(&chain, Invite::SERVICE)
            .consume(cid)
            .get()?;

        let query = format!(r#"query {{ guildInvite(id: {invite_id}) {{ expiry }} }}"#);
        let response: Value = chain.graphql(Guilds::SERVICE, &query)?;

        assert_expiry_field_error(&response, invite_id);

        Ok(())
    }
}

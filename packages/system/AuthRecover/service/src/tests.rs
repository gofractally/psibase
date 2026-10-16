#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::fracpack::Pack;
    use psibase::services::auth_sig::SubjectPublicKeyInfo;
    use psibase::*;

    const BOBKEY: &'static str = r#"-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4Jw8jwL4Yno9j3aqw5DL+HbsycEd
j/AzX82KcJ6DAv8m0bA7bCi4j0Clslq6sU/80vgq8MWqQRDh0DAZ/Ycpgg==
-----END PUBLIC KEY-----
"#;

    const RECOVERYKEY: &'static str = r#"-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDR3UnfN5DKcSWyVgQDijnOK6kJjN
NIkZtaNwUbRF7vWce01NqajaiOnNtjTTPluCsR8GhTSGV4RVokrRT1AgLw==
-----END PUBLIC KEY-----
"#;

    const BOBKEY2: &'static str = r#"-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEay21JDU2rSOGWbR+St+53yDbnQIZ
s2vjfI4TO+IYj/Kebav3qNYEdW0wpurC4SlSZPMHLK46fgGsLarhdvRIDQ==
-----END PUBLIC KEY-----
"#;

    const BOB: AccountNumber = account!("bob45678");

    fn do_test(
        chain: &psibase::Chain,
        recover: Option<&str>,
        delay: Option<MicroSeconds>,
        set_key: Option<&str>,
        activate: bool,
        keys: Vec<&str>,
        err: Option<&str>,
    ) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice).unwrap();
        let bobkey: SubjectPublicKeyInfo = BOBKEY.parse()?;
        Wrapper::push_from(&chain, alice)
            .newAccount(BOB, bobkey)
            .get()?;

        if let Some(recover) = recover {
            let recovery_key: SubjectPublicKeyInfo = recover.parse()?;
            Wrapper::push_from(&chain, alice)
                .recover(BOB, recovery_key.clone())
                .get()?;
        }

        if let Some(delay) = delay {
            chain.start_block_after(delay)
        }

        let mut actions = Vec::new();
        if let Some(set_key) = set_key {
            actions.push(Wrapper::pack_from(BOB).setKey(set_key.parse()?))
        }
        if activate {
            actions.push(Wrapper::pack_from(BOB).activate())
        }
        let claims = keys
            .into_iter()
            .map(|k| {
                Ok::<_, Error>(Claim {
                    service: services::verify_sig::SERVICE,
                    rawData: k.parse::<SubjectPublicKeyInfo>()?.0.into(),
                })
            })
            .collect::<Result<_, _>>()?;
        let mut tx = Transaction {
            tapos: Default::default(),
            actions,
            claims,
        };
        chain.fill_tapos(&mut tx, 2);
        let res = ChainEmptyResult {
            trace: chain.push(&SignedTransaction {
                transaction: tx.packed().into(),
                ..Default::default()
            }),
        };
        if let Some(err) = err {
            res.match_error(err)?;
        } else {
            res.get()?
        }
        Ok(())
    }

    #[psibase::test_case(packages("AuthRecover"))]
    fn test_recover(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(RECOVERYKEY),
            None,
            Some(BOBKEY2),
            true,
            vec![RECOVERYKEY, BOBKEY2],
            None,
        )?
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_recover_missing_new_key(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(RECOVERYKEY),
            None,
            Some(BOBKEY2),
            true,
            vec![RECOVERYKEY],
            Some("Authorization for bob45678 -> auth-rcovr::activate failed"),
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_recover_missing_recovery_key(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(RECOVERYKEY),
            None,
            Some(BOBKEY2),
            true,
            vec![BOBKEY2],
            Some("Authorization for bob45678 -> auth-rcovr::setkey failed"),
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_recover_missing_activate(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(RECOVERYKEY),
            None,
            Some(BOBKEY2),
            false,
            vec![RECOVERYKEY],
            Some("Work not completed: auth-rcovr"),
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_set_key(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            None,
            None,
            Some(BOBKEY2),
            true,
            vec![BOBKEY, BOBKEY2],
            None,
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_timeout_not_reached(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(RECOVERYKEY),
            Some(MicroSeconds::new(899000000)),
            Some(BOBKEY2),
            true,
            vec![RECOVERYKEY, BOBKEY2],
            None,
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_timeout_expired(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(RECOVERYKEY),
            Some(MicroSeconds::new(900000000)),
            Some(BOBKEY2),
            true,
            vec![RECOVERYKEY, BOBKEY2],
            Some("Authorization for bob45678 -> auth-rcovr::setkey failed"),
        )
    }
}

#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use p256::{
        ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey},
        pkcs8::EncodePublicKey,
    };
    use psibase::fracpack::Pack;
    use psibase::services::auth_sig::SubjectPublicKeyInfo;
    use psibase::*;

    // Public, deterministic test fixtures; never use these keys for deployment.
    #[derive(Clone, Copy)]
    enum TestKey {
        Bob = 1,
        Recovery = 2,
        NewBob = 3,
    }

    impl TestKey {
        fn signing_key(self) -> SigningKey {
            SigningKey::from_bytes((&[self as u8; 32]).into()).unwrap()
        }

        fn public_key(self) -> SubjectPublicKeyInfo {
            SubjectPublicKeyInfo(
                self.signing_key()
                    .verifying_key()
                    .to_public_key_der()
                    .unwrap()
                    .as_bytes()
                    .to_vec(),
            )
        }
    }

    const BOB: AccountNumber = account!("bob45678");

    fn do_test(
        chain: &psibase::Chain,
        recover: Option<TestKey>,
        delay: Option<MicroSeconds>,
        set_key: Option<TestKey>,
        activate: bool,
        keys: Vec<TestKey>,
        err: Option<&str>,
    ) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice).unwrap();
        let bobkey = TestKey::Bob.public_key();
        Wrapper::push_from(&chain, alice)
            .newAccount(BOB, bobkey)
            .get()?;

        if let Some(recover) = recover {
            let recovery_key = recover.public_key();
            Wrapper::push_from(&chain, alice)
                .recover(BOB, recovery_key.clone())
                .get()?;
        }

        if let Some(delay) = delay {
            chain.start_block_after(delay)
        }

        let mut actions = Vec::new();
        if let Some(set_key) = set_key {
            actions.push(Wrapper::pack_from(BOB).setKey(set_key.public_key()))
        }
        if activate {
            actions.push(Wrapper::pack_from(BOB).activate())
        }
        let claims = keys
            .iter()
            .map(|k| Claim {
                service: services::verify_sig::SERVICE,
                rawData: k.public_key().0.into(),
            })
            .collect();
        let mut tx = Transaction {
            tapos: Default::default(),
            actions,
            claims,
        };
        chain.fill_tapos(&mut tx, 2);
        let transaction = tx.packed();
        let digest = psibase::sha256(&transaction);
        let proofs = keys
            .iter()
            .map(|key| {
                let signature: Signature = key
                    .signing_key()
                    .sign_prehash(&digest.0)
                    .map_err(Error::new)?;
                // verify-sig only accepts the low-S form.
                let signature = signature.normalize_s().unwrap_or(signature);
                Ok(signature.to_bytes().to_vec().into())
            })
            .collect::<Result<_, Error>>()?;
        let res = ChainEmptyResult {
            trace: chain.push(&SignedTransaction {
                transaction: transaction.into(),
                proofs,
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
            Some(TestKey::Recovery),
            None,
            Some(TestKey::NewBob),
            true,
            vec![TestKey::Recovery, TestKey::NewBob],
            None,
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_recover_missing_new_key(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(TestKey::Recovery),
            None,
            Some(TestKey::NewBob),
            true,
            vec![TestKey::Recovery],
            Some("Authorization for bob45678 -> auth-rcovr::activate failed"),
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_recover_missing_recovery_key(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(TestKey::Recovery),
            None,
            Some(TestKey::NewBob),
            true,
            vec![TestKey::NewBob],
            Some("Authorization for bob45678 -> auth-rcovr::setkey failed"),
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_recover_missing_activate(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(TestKey::Recovery),
            None,
            Some(TestKey::NewBob),
            false,
            vec![TestKey::Recovery],
            Some("Work not completed: auth-rcovr"),
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_set_key(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            None,
            None,
            Some(TestKey::NewBob),
            true,
            vec![TestKey::Bob, TestKey::NewBob],
            None,
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_timeout_not_reached(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(TestKey::Recovery),
            Some(MicroSeconds::new(899000000)),
            Some(TestKey::NewBob),
            true,
            vec![TestKey::Recovery, TestKey::NewBob],
            None,
        )
    }
    #[psibase::test_case(packages("AuthRecover"))]
    fn test_timeout_expired(chain: psibase::Chain) -> Result<(), psibase::Error> {
        do_test(
            &chain,
            Some(TestKey::Recovery),
            Some(MicroSeconds::new(900000000)),
            Some(TestKey::NewBob),
            true,
            vec![TestKey::Recovery, TestKey::NewBob],
            Some("Authorization for bob45678 -> auth-rcovr::setkey failed"),
        )
    }
}

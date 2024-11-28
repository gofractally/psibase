#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::fracpack::Unpack;
    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::transact::Wrapper as Transact;
    use psibase::*;
    use serde::Deserialize;

    #[allow(non_snake_case)]
    #[derive(Deserialize, Unpack, Debug)]
    struct PartialTapos {
        refBlockIndex: u8,
        refBlockSuffix: u32,
    }

    // use psibase::services::accounts::Wrapper as Accounts;
    // use psibase::services::auth_sig::Wrapper as AuthSig;
    // fn set_auth(name: AccountNumber, pubkey: &str) -> Result<(), anyhow::Error> {
    //     let pubkey_pem = pem::parse(pubkey.trim()).expect("Invalid PEM");
    //     AuthSig::call_from(name).setKey(pubkey_pem.contents().to_vec().into());
    //     Accounts::call_from(name).setAuthServ(AuthSig::SERVICE);
    //     Ok(())
    // }
    // let priv_pem = "-----BEGIN PRIVATE KEY-----\n\
    //         MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n\
    //         HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n\
    //         CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n\
    //         -----END PRIVATE KEY-----";
    // let pub_pem = "-----BEGIN PUBLIC KEY-----\n\
    //     MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n\
    //     WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n\
    //     -----END PUBLIC KEY-----";

    fn get_tapos(chain: &psibase::Chain) -> Tapos {
        let block = Transact::push(chain)
            .currentBlock()
            .get()
            .expect("Failed to get current block");

        let tapos_reply = chain
            .get(Wrapper::SERVICE, "/common/tapos/head")
            .expect("Failed to get tapos head");
        let partial_tapos =
            <PartialTapos>::unpacked(&tapos_reply.body.0).expect("Failed to unpack partial tapos");

        Tapos {
            expiration: TimePointSec::from(block.time.seconds() + Seconds::new(10)),
            refBlockSuffix: partial_tapos.refBlockSuffix,
            flags: 0,
            refBlockIndex: partial_tapos.refBlockIndex,
        }
    }

    #[psibase::test_case(packages("StagedTx", "Nft", "AuthSig"))]
    fn test_propose(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = AccountNumber::from("alice");
        chain.new_account(alice).unwrap();

        let bob = AccountNumber::from("bob");
        chain.new_account(bob).unwrap();

        Wrapper::push_from(&chain, alice)
            .propose(vec![Action {
                sender: bob,
                service: Nft::SERVICE,
                method: MethodNumber::from("mint"),
                rawData: Hex(vec![]),
            }])
            .get()?;

        Ok(())
    }
}

/*

Tests:
1. Stage a transaction for an account that uses auth-any - Check executes
2. Stage a transaction for an account that uses auth-sig - Check fails

// Tests that come after I implement auth-delegate:
3. Stage a transaction with an account that uses auth-delegate
4. Accept w/non-delegate - Check fails
5. Accept w/delegate - Check succeeds, check executes
6. Reject w/non-delegate- check fails
7. Reject w/delegate - check succeeds, check deletes staged tx
*/

#![allow(non_snake_case)]

#[cfg(test)]
mod tests {
    use crate::Wrapper;
    use psibase::fracpack::Pack;
    use psibase::services::accounts::Wrapper as Accounts;
    use psibase::services::auth_delegate::Wrapper as AuthDelegate;
    use psibase::services::nft as Nft;
    use psibase::*;
    use serde::Deserialize;
    use serde_json::Value;
    use Nft::Nft as NftRecord;

    #[derive(Deserialize)]
    struct Response {
        data: Data,
    }

    #[derive(Deserialize)]
    struct Data {
        userNfts: UserNfts,
    }

    #[derive(Deserialize)]
    struct UserNfts {
        edges: Vec<Edge>,
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Edge {
        node: NftRecord,
    }

    fn get_nr_nfts(chain: &Chain, user: AccountNumber) -> Result<usize, psibase::Error> {
        let res: Value = chain.graphql(
            Nft::SERVICE,
            &format!(
                r#"
                query UserNfts {{
                    userNfts(user: "{}") {{
                        edges {{
                            node {{
                                id
                                issuer
                                owner
                            }}
                        }}
                    }}
                }}"#,
                user
            ),
        )?;

        let response_root: Response = serde_json::from_value(res)?;
        Ok(response_root.data.userNfts.edges.len())
    }

    #[psibase::test_case(packages("StagedTx", "Nft", "AuthSig"))]
    fn test_propose(chain: psibase::Chain) -> Result<(), psibase::Error> {
        Wrapper::push(&chain).init();

        let alice = account!("alice");
        chain.new_account(alice).unwrap();

        let bob = account!("bob");
        chain.new_account(bob).unwrap();

        assert_eq!(get_nr_nfts(&chain, bob)?, 0);

        let id = Wrapper::push_from(&chain, alice)
            .propose(
                vec![Action {
                    sender: bob,
                    service: Nft::SERVICE,
                    method: MethodNumber::from("mint"),
                    rawData: Nft::action_structs::mint {}.packed().into(),
                }],
                true,
            )
            .get()?;

        assert_eq!(get_nr_nfts(&chain, bob)?, 0);

        let txid = Wrapper::push(&chain).get_staged_tx(id).get()?.txid;

        Wrapper::push_from(&chain, bob).accept(id, txid).get()?;

        assert_eq!(get_nr_nfts(&chain, bob)?, 1);

        Ok(())
    }

    struct TestTransaction<'a> {
        chain: &'a Chain,
        id: u32,
        account: AccountNumber,
    }

    impl<'a> TestTransaction<'a> {
        // Creates a new staged transaction that must be approved
        // by all the given accounts
        pub fn new(chain: &'a Chain, accounts: &[AccountNumber]) -> Result<Self, Error> {
            let id = Wrapper::push(&chain)
                .propose(
                    accounts
                        .iter()
                        .map(|account| Nft::Wrapper::pack_from(*account).mint())
                        .collect(),
                    true,
                )
                .get()?;
            Ok(Self {
                chain,
                id,
                account: accounts[0],
            })
        }
        // Returns true if the staged transaction was executed
        pub fn approve(&self, account: AccountNumber) -> Result<bool, Error> {
            let prev_nfts = get_nr_nfts(self.chain, self.account)?;
            let txid = Wrapper::push(self.chain).get_staged_tx(self.id).get()?.txid;
            Wrapper::push_from(self.chain, account)
                .accept(self.id, txid)
                .get()?;
            Ok(get_nr_nfts(self.chain, self.account)? != prev_nfts)
        }
    }

    #[psibase::test_case(packages("StagedTx"))]
    fn test_change_auth_serv(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice)?;
        let bob = account!("bob");
        chain.new_account(bob)?;
        let carol = account!("carol");
        chain.new_account(carol)?;

        let tx = TestTransaction::new(&chain, &[alice, bob])?;
        assert!(!tx.approve(alice)?);

        // Setting the account owner should invalidate the approval from alice
        AuthDelegate::push_from(&chain, alice)
            .setOwner(carol)
            .get()?;
        Accounts::push_from(&chain, alice)
            .setAuthServ(AuthDelegate::SERVICE)
            .get()?;

        assert!(!tx.approve(bob)?);
        assert!(tx.approve(carol)?);
        Ok(())
    }

    #[psibase::test_case(packages("StagedTx"))]
    fn test_change_set_unused_owner(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice)?;
        let bob = account!("bob");
        chain.new_account(bob)?;
        let carol = account!("carol");
        chain.new_account(carol)?;

        let tx = TestTransaction::new(&chain, &[alice, bob])?;
        assert!(!tx.approve(alice)?);

        // This should have no effect, because auth-delegate is not alice's
        // auth service
        AuthDelegate::push_from(&chain, alice)
            .setOwner(carol)
            .get()?;

        assert!(tx.approve(bob)?);

        Ok(())
    }

    #[psibase::test_case(packages("StagedTx"))]
    fn test_change_owner(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice)?;
        let bob = account!("bob");
        chain.new_account(bob)?;
        let carol = account!("carol");
        chain.new_account(carol)?;
        let dave = account!("dave");
        chain.new_account(dave)?;

        AuthDelegate::push_from(&chain, alice)
            .setOwner(carol)
            .get()?;
        Accounts::push_from(&chain, alice)
            .setAuthServ(AuthDelegate::SERVICE)
            .get()?;

        let tx = TestTransaction::new(&chain, &[alice, bob])?;
        assert!(!tx.approve(alice)?);

        // Changing the account owner should invalidate the approval from alice
        AuthDelegate::push_from(&chain, alice)
            .setOwner(dave)
            .get()?;

        assert!(!tx.approve(bob)?);
        assert!(tx.approve(dave)?);

        Ok(())
    }

    #[psibase::test_case(packages("StagedTx"))]
    fn test_change_auth_chained(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice)?;
        let bob = account!("bob");
        chain.new_account(bob)?;
        let carol = account!("carol");
        chain.new_account(carol)?;
        let dave = account!("dave");
        chain.new_account(dave)?;

        AuthDelegate::push_from(&chain, alice)
            .setOwner(carol)
            .get()?;
        Accounts::push_from(&chain, alice)
            .setAuthServ(AuthDelegate::SERVICE)
            .get()?;

        let tx = TestTransaction::new(&chain, &[alice, bob])?;
        assert!(!tx.approve(carol)?);

        // Changing the account owner should invalidate the approval from carol
        AuthDelegate::push_from(&chain, carol)
            .setOwner(dave)
            .get()?;
        Accounts::push_from(&chain, carol)
            .setAuthServ(AuthDelegate::SERVICE)
            .get()?;

        assert!(!tx.approve(bob)?);
        assert!(tx.approve(dave)?);

        Ok(())
    }

    #[psibase::test_case(packages("StagedTx"))]
    fn test_change_owner_chained(chain: psibase::Chain) -> Result<(), psibase::Error> {
        let alice = account!("alice");
        chain.new_account(alice)?;
        let bob = account!("bob");
        chain.new_account(bob)?;
        let carol = account!("carol");
        chain.new_account(carol)?;
        let dave = account!("dave");
        chain.new_account(dave)?;
        let eliza = account!("eliza");
        chain.new_account(eliza)?;

        AuthDelegate::push_from(&chain, alice)
            .setOwner(carol)
            .get()?;
        Accounts::push_from(&chain, alice)
            .setAuthServ(AuthDelegate::SERVICE)
            .get()?;
        AuthDelegate::push_from(&chain, carol)
            .setOwner(dave)
            .get()?;
        Accounts::push_from(&chain, carol)
            .setAuthServ(AuthDelegate::SERVICE)
            .get()?;

        let tx = TestTransaction::new(&chain, &[alice, bob])?;
        assert!(!tx.approve(carol)?);

        // Changing the account owner should invalidate the approval from carol
        AuthDelegate::push_from(&chain, carol)
            .setOwner(eliza)
            .get()?;

        assert!(!tx.approve(bob)?);
        assert!(tx.approve(eliza)?);

        Ok(())
    }
}

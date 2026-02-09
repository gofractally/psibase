#[psibase::service_tables]
pub mod tables {
    use psibase::fracpack::{Pack, Unpack};
    use psibase::services::{
        nft::{NftHolderFlags, Wrapper as Nft},
        tokens::{BalanceFlags, Wrapper as Tokens},
        transact::Wrapper as Transact,
    };
    use psibase::{Checksum256, *};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Pack, Unpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    impl InitRow {
        pub fn init() {
            let table = InitTable::read_write();
            if table.get_index_pk().get(&()).is_some() {
                return;
            }
            table.put(&InitRow {}).unwrap();

            Tokens::call().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), true);
            Nft::call().setUserConf(NftHolderFlags::MANUAL_DEBIT.index(), true);

            Nft::call_as(crate::CRED_SYS).setUserConf(NftHolderFlags::MANUAL_DEBIT.index(), true);
            Tokens::call_as(crate::CRED_SYS).setUserConf(BalanceFlags::MANUAL_DEBIT.index(), true);
        }
    }

    #[table(name = "CredentialIdTable", index = 1)]
    #[derive(Default, Pack, Unpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct CredentialId {
        pub id: u32,
    }

    impl CredentialId {
        #[primary_key]
        fn pk(&self) {
            ()
        }

        pub fn next_id() -> u32 {
            let table = CredentialIdTable::new();
            let id = table.get_index_pk().get(&()).unwrap_or_default().id;

            table.put(&CredentialId { id: id + 1 }).unwrap();

            id
        }
    }

    #[table(name = "CredentialTable", index = 2)]
    #[derive(Pack, Unpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct Credential {
        pub id: u32,
        pub pubkey_fingerprint: Checksum256,
        pub creation_date: TimePointSec,

        // Optional issuer data
        pub issuer: AccountNumber, // 0 -> no issuer
        pub expiry_date: Option<TimePointSec>,
        pub allowed_actions: Vec<MethodNumber>,
    }

    impl Credential {
        #[primary_key]
        fn pk(&self) -> u32 {
            self.id
        }

        #[secondary_key(1)]
        fn by_pkh(&self) -> Checksum256 {
            self.pubkey_fingerprint.clone()
        }

        #[secondary_key(2)]
        fn by_expiry_date(&self) -> (Option<TimePointSec>, u32) {
            (self.expiry_date, self.id)
        }
    }

    impl Credential {
        pub fn add(
            pubkey_fingerprint: Checksum256,
            expires: Option<u32>,
            allowed_actions: Vec<MethodNumber>,
        ) -> u32 {
            let id = CredentialId::next_id();
            let now = Transact::call().currentBlock().time.seconds();

            let table = CredentialTable::read_write();
            check(
                table.get_index_by_pkh().get(&pubkey_fingerprint).is_none(),
                "Credential already exists",
            );

            table
                .put(&Credential {
                    id,
                    pubkey_fingerprint,
                    creation_date: now,
                    issuer: get_sender(),
                    expiry_date: expires.map(|e| now + psibase::Seconds::new(e as i64)),
                    allowed_actions,
                })
                .unwrap();

            id
        }
    }
}

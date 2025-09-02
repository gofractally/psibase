#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::{Fracpack, TimePointSec, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "SecretsTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Secret {
        pub id: u32,
        pub secret: Vec<u8>,
        pub created_at: TimePointSec,
    }

    impl Secret {
        #[primary_key]
        fn pk(&self) -> u32 {
            self.id
        }

        #[secondary_key(1)]
        fn by_created_at(&self) -> (TimePointSec, u32) {
            (self.created_at, self.id)
        }
    }
}

const TWO_WEEKS_SECONDS: i64 = 14 * 24 * 60 * 60;
const MAX_DELETIONS: i32 = 10;

#[psibase::service(name = "secrets", tables = "tables")]
pub mod service {
    use crate::{
        tables::{Secret, SecretsTable},
        MAX_DELETIONS, TWO_WEEKS_SECONDS,
    };
    use psibase::{services::transact, *};

    /// Stores an encrypted secret.
    /// A secret expires after two weeks.
    /// Adding a secret will also delete up to 10 expired secrets.
    #[action]
    #[allow(non_snake_case)]
    fn add_secret(id: u32, secret: Vec<u8>) {
        let table = SecretsTable::new();
        check(
            table.get_index_pk().get(&id).is_none(),
            "secret already exists",
        );
        let now = transact::Wrapper::call().currentBlock().time;
        table
            .put(&Secret {
                id,
                secret,
                created_at: now.seconds(),
            })
            .unwrap();

        // Delete up to 10 expired secrets
        let expiration_threshold =
            TimePointSec::from(now.seconds() - Seconds::new(TWO_WEEKS_SECONDS));
        table
            .get_index_by_created_at()
            .iter()
            .take(MAX_DELETIONS as usize)
            .take_while(|s| s.created_at < expiration_threshold)
            .for_each(|s| {
                table.remove(&s);
            });
    }
}

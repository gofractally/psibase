#[psibase::service_tables]
mod tables {
    use psibase::{Pack, ToSchema, Unpack};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Pack, Unpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }
}

#[psibase::service(name = "battlezone", tables = "tables")]
mod service {
    use crate::tables::{InitRow, InitTable};
    use psibase::*;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
    }

    /// HTTP is served from Sites SPA assets packaged under `/`.
    #[action]
    #[allow(non_snake_case)]
    fn serveSys(_request: HttpRequest) -> Option<HttpReply> {
        None
    }
}

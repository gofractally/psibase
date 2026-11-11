#[psibase::service_tables]
pub mod tables {
    use psibase::{Pack, TimePointSec, ToSchema, Unpack};

    pub(crate) const STORE_PREFIX_LEN: usize = 16;
    pub(crate) const GC_LIMIT: usize = 16;

    #[table(name = "KvTable", index = 0, db = "Subjective")]
    #[derive(Pack, Unpack, ToSchema)]
    pub struct KvRow {
        pub store: Vec<u8>,
        pub key: Vec<u8>,
        pub value: Vec<u8>,
    }

    impl KvRow {
        #[primary_key]
        fn by_store_key(&self) -> (Vec<u8>, Vec<u8>) {
            (self.store.clone(), self.key.clone())
        }
    }

    #[table(name = "SessionKvTable", index = 1, db = "Subjective")]
    #[derive(Pack, Unpack, ToSchema)]
    pub struct SessionKvRow {
        pub store: Vec<u8>,
        pub session: Vec<u8>,
        pub key: Vec<u8>,
        pub value: Vec<u8>,
        pub last_access: TimePointSec,
    }

    impl SessionKvRow {
        #[primary_key]
        fn by_store_session_key(&self) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
            (self.store.clone(), self.session.clone(), self.key.clone())
        }

        #[secondary_key(1)]
        fn by_last_access(&self) -> (TimePointSec, Vec<u8>, Vec<u8>, Vec<u8>) {
            (
                self.last_access,
                self.store.clone(),
                self.session.clone(),
                self.key.clone(),
            )
        }
    }

    #[table(name = "DeviceTable", index = 2, db = "Subjective")]
    #[derive(Pack, Unpack, ToSchema)]
    pub struct DeviceRow {
        pub device: Vec<u8>,
        pub last_seen: TimePointSec,
        pub store: Vec<u8>,
    }

    impl DeviceRow {
        #[primary_key]
        fn by_device(&self) -> Vec<u8> {
            self.device.clone()
        }

        #[secondary_key(1)]
        fn by_last_seen(&self) -> (TimePointSec, Vec<u8>) {
            (self.last_seen, self.device.clone())
        }
    }
}

mod device;
mod kv;
mod session_kv;

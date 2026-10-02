#[psibase::service_tables]
pub mod tables {
    use psibase::{Pack, ToSchema, Unpack};

    #[table(name = "KvTable", index = 0, db = "Subjective")]
    #[derive(Pack, Unpack, ToSchema)]
    pub struct KvRow {
        pub device: Vec<u8>,
        pub key: Vec<u8>,
        pub value: Vec<u8>,
    }

    impl KvRow {
        #[primary_key]
        fn by_device_key(&self) -> (Vec<u8>, Vec<u8>) {
            (self.device.clone(), self.key.clone())
        }
    }

    #[table(name = "SessionKvTable", index = 1, db = "Subjective")]
    #[derive(Pack, Unpack, ToSchema)]
    pub struct SessionKvRow {
        pub device: Vec<u8>,
        pub session: Vec<u8>,
        pub key: Vec<u8>,
        pub value: Vec<u8>,
        pub last_access: u64,
    }

    impl SessionKvRow {
        #[primary_key]
        fn by_device_session_key(&self) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
            (self.device.clone(), self.session.clone(), self.key.clone())
        }

        /// `last_access` leads so the index is oldest-first. The row identity
        /// follows so each row has its own index entry.
        #[secondary_key(1)]
        fn by_last_access(&self) -> (u64, Vec<u8>, Vec<u8>, Vec<u8>) {
            (
                self.last_access,
                self.device.clone(),
                self.session.clone(),
                self.key.clone(),
            )
        }
    }

    #[table(name = "DeviceTable", index = 2, db = "Subjective")]
    #[derive(Pack, Unpack, ToSchema)]
    pub struct DeviceRow {
        pub device: Vec<u8>,
        pub last_seen: u64,
    }

    impl DeviceRow {
        #[primary_key]
        fn by_device(&self) -> Vec<u8> {
            self.device.clone()
        }

        #[secondary_key(1)]
        fn by_last_seen(&self) -> (u64, Vec<u8>) {
            (self.last_seen, self.device.clone())
        }
    }
}

use psibase::{native_raw, services, DbId, KvHandle, KvMode};

#[no_mangle]
unsafe extern "C" fn psibase_proxy_kv_open_impl(
    db: DbId,
    prefix: *const u8,
    prefix_len: u32,
    mode: KvMode,
) -> native_raw::KvHandle {
    let prefix = std::slice::from_raw_parts(prefix, prefix_len as usize);
    match db {
        DbId::Service | DbId::WriteOnly | DbId::BlockLog | DbId::Native => KvHandle::import_raw(
            services::db::Wrapper::call().open(db, prefix.to_vec().into(), mode as u8),
        ),
        DbId::Subjective | DbId::Session | DbId::Temporary => KvHandle::import_raw(
            services::x_db::Wrapper::call().open(db, prefix.to_vec().into(), mode as u8),
        ),
        _ => native_raw::kvOpen(db, prefix.as_ptr(), prefix.len() as u32, mode),
    }
}

pub fn force_use() {}

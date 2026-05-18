use psibase::{native_raw, services, DbId, KvHandle, KvMode};

pub unsafe fn psibase_proxy_kv_open_impl(
    db: u32,
    prefix: *const u8,
    prefix_len: u32,
    mode: u8,
) -> u32 {
    let db = *(&db as *const u32 as *const DbId);
    let mode = *(&mode as *const u8 as *const KvMode);
    let prefix = std::slice::from_raw_parts(prefix, prefix_len as usize);
    let result = match db {
        DbId::Service | DbId::WriteOnly | DbId::BlockLog | DbId::Native => KvHandle::import_raw(
            services::db::Wrapper::call().open(db, prefix.to_vec().into(), mode as u8),
        ),
        DbId::Subjective | DbId::Session | DbId::Temporary => KvHandle::import_raw(
            services::x_db::Wrapper::call().open(db, prefix.to_vec().into(), mode as u8),
        ),
        _ => native_raw::kvOpen(db, prefix.as_ptr(), prefix.len() as u32, mode),
    };
    *(&result as *const native_raw::KvHandle as *const u32)
}

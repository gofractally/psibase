pub(crate) const KV_BATCH_PATH: &str = "/kv/batch";
pub(crate) const KV_PERSISTENT_PREFIX: &str = "/kv/persistent/";
pub(crate) const KV_SESSION_PREFIX: &str = "/kv/session/";

pub(crate) fn is_kv_item_path(path: &str) -> bool {
    path.starts_with(KV_PERSISTENT_PREFIX) || path.starts_with(KV_SESSION_PREFIX)
}

pub(crate) fn is_storage_path(path: &str) -> bool {
    path == KV_BATCH_PATH || is_kv_item_path(path)
}

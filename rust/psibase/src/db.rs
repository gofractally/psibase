/// Identify key-value map to operate on
///
/// Key-value intrinsics expose a set of key-value maps which serve
/// various purposes. This enum identifies which key-value map to
/// use when invoking those intrinsics.
#[repr(u32)]
pub enum KvMap {
    /// Most contracts should store their tables here.
    Contract,

    /// Native tables which enforce constraints during write. Only
    /// writable by whitelisted contracts, but readable by all
    /// contracts.
    NativeConstrained,

    /// Native tables which don't enforce constraints during write.
    /// Only writable by whitelisted contracts, but readable by all
    /// contracts.
    NativeUnconstrained,

    /// Data that is not part of consensus. Only accessible to
    /// whitelisted contracts during transactions, but readable
    /// by all contracts during RPC. Individual nodes may modify
    /// this map or wipe it entirely at will.
    Subjective,

    /// Write-only during transactions, and read-only during RPC.
    /// Individual nodes may modify this map, expire data from this
    /// map, or wipe it entirely at will.
    WriteOnly,
}

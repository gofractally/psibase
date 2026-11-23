
use serde::{Deserialize, Serialize};

pub use crate::services::events::EventDb;

/// Identify database to operate on
///
/// Native functions expose a set of databases which serve
/// various purposes. This enum identifies which database to
/// use when invoking those functions.
#[repr(u32)]
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    psio::PsszPack,
    psio::PsszUnpack,
    psio::ToPsszSchema,
    psio::JsonText,
)]
#[serde(rename_all = "camelCase")]
pub enum DbId {
    /// Services should store their tables here
    ///
    /// The first 64 bits of the key match the service.
    Service,

    /// Data for RPC
    ///
    /// Write-only during transactions, and read-only during RPC.
    /// Individual nodes may modify this database, expire data from this
    /// database, or wipe it entirely at will.
    ///
    /// The first 64 bits of the key match the service.
    WriteOnly,

    /// Tables used by native code
    ///
    /// This database enforces constraints during write. Only
    /// writable by privileged services, but readable by all
    /// services.
    ///
    /// Some writes to this database indicate chain upgrades. If a
    /// privileged service writes to a table that an older
    /// node version doesn't know about, or writes new fields
    /// to an existing table that an older node doesn't know about,
    /// then that node will reject the write. If the producers
    /// accepted the write into a block, then the node will stop
    /// following the chain until it's upgraded to a newer version.
    Native,

    /// Block log
    ///
    /// Transactions don't have access to this, but RPC does.
    BlockLog,

    /// block signatures
    BlockProof,

    /// Not accessible to WASM. During joint consensus, this holds a
    /// subset of native as of the last irreversible block. Outside
    /// joint consensus, it is empty.
    #[doc(hidden)]
    PrevAuthServices,

    /// Data that is not part of consensus
    ///
    /// Only accessible to subjective services during transactions,
    /// but readable by all services during RPC. Doesn't undo
    /// from aborting transactions, aborting blocks, or forking
    /// blocks. Individual nodes may modify this database or wipe
    //  it entirely at will.
    ///
    /// The first 64 bits of the key match the service.
    Subjective = BEGIN_INDEPENDENT,

    /// Subjective tables used by native code
    ///
    /// Not fully implemented yet and not available to services. Doesn't
    /// undo from aborting transactions, aborting blocks, or forking
    /// blocks.
    NativeSubjective,

    /// Data that is not part of consensus and is not preserved when the
    /// server exits
    Session,

    /// Native subjective tables that are not preserved when the server
    /// exits
    NativeSession,

    /// Subjective tables that are local to the transaction/query/callback
    /// context.
    Temporary,
}

const BEGIN_INDEPENDENT: u32 = 64;


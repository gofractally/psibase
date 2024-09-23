use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

/// Identify database to operate on
///
/// Native functions expose a set of databases which serve
/// various purposes. This enum identifies which database to
/// use when invoking those functions.
#[repr(u32)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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

    /// Data that is not part of consensus
    ///
    /// Only accessible to subjective services during transactions,
    /// but readable by all services during RPC. Doesn't undo
    /// from aborting transactions, aborting blocks, or forking
    /// blocks. Individual nodes may modify this database or wipe
    //  it entirely at will.
    ///
    /// The first 64 bits of the key match the service.
    Subjective,

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

    /// Long-term history event storage
    ///
    /// Write-only during transactions, and read-only during RPC.
    /// Individual nodes may modify this database, expire data from this
    /// database, or wipe it entirely at will.
    ///
    /// TODO: this policy may eventually change to allow time-limited
    /// read access during transactions.
    ///
    /// Key is an auto-incremented, 64-bit unsigned number.
    ///
    /// Value must begin with:
    /// * 32 bit: block number
    /// * 64 bit: service
    ///
    /// Only usable with these native functions:
    /// * [crate::native_raw::putSequential]
    /// * [crate::native_raw::getSequential]
    ///
    /// TODO: right now the value must begin with the service. Revisit
    /// whether beginning with the block number is useful.
    HistoryEvent,

    /// Short-term history event storage
    ///
    /// These events are erased once the block that produced them becomes final.
    /// They notify user interfaces which subscribe to activity.
    ///
    /// Write-only during transactions, and read-only during RPC.
    /// Individual nodes may modify this database, expire data from this
    /// database, or wipe it entirely at will.
    ///
    /// Key is an auto-incremented, 64-bit unsigned number.
    ///
    /// Value must begin with:
    /// * 32 bit: block number
    /// * 64 bit: service
    ///
    /// Only usable with these native functions:
    /// * [crate::native_raw::putSequential]
    /// * [crate::native_raw::getSequential]
    ///
    /// TODO: right now the value must begin with the service. Revisit
    /// whether beginning with the block number is useful.
    UiEvent,

    /// Events which go into the merkle tree
    ///
    /// TODO: read support; right now only RPC mode can read
    ///
    /// Services may produce these events during transactions and may read them
    /// up to 1 hour (configurable) after they were produced, or they reach finality,
    /// which ever is longer.
    ///
    /// Key is an auto-incremented, 64-bit unsigned number.
    ///
    /// Value must begin with:
    /// * 32 bit: block number
    /// * 64 bit: service
    ///
    /// Only usable with these native functions:
    /// * [crate::native_raw::putSequential]
    /// * [crate::native_raw::getSequential]
    ///
    /// TODO: right now the value must begin with the service. Revisit
    /// whether beginning with the block number is useful.
    MerkleEvent,

    /// block signatures
    BlockProof,

    /// Number of defined databases
    ///
    /// This number may grow in the future
    NumDatabases,
}

impl Pack for DbId {
    const FIXED_SIZE: u32 = 4;

    const VARIABLE_SIZE: bool = false;

    fn pack(&self, dest: &mut Vec<u8>) {
        (*self as u32).pack(dest);
    }
}
impl<'a> Unpack<'a> for DbId {
    const FIXED_SIZE: u32 = 4;

    const VARIABLE_SIZE: bool = false;

    fn unpack(src: &'a [u8], pos: &mut u32) -> fracpack::Result<Self> {
        let u32_form = u32::unpack(src, pos)?;
        if u32_form >= DbId::NumDatabases as u32 {
            return Err(fracpack::Error::BadEnumIndex);
        }
        Ok(unsafe { std::mem::transmute(u32_form) })
    }

    fn verify(src: &'a [u8], pos: &mut u32) -> fracpack::Result<()> {
        u32::verify(src, pos)
    }
}

impl ToSchema for DbId {
    fn schema(_builder: &mut fracpack::SchemaBuilder) -> fracpack::AnyType {
        todo!()
    }
}

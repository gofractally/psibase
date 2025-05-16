#[crate::service(name = "chainmail", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use crate::{AccountNumber, Checksum256, TimePointSec};

    // Legacy public interface:

    /// Send a public message
    #[action]
    fn send(receiver: AccountNumber, subject: String, body: String) {
        unimplemented!()
    }

    /// Archive a public message
    #[action]
    fn archive(msg_id: u64) {
        unimplemented!()
    }

    /// Save a public message
    /// Events can be pruned by nodes. Since Chainmail relies on events to "store" messages,
    /// `save` copies a message into state where it can be stored indefinitely at the saver's expense.
    #[action]
    fn save(
        msg_id: u64,
        receiver: AccountNumber,
        sender: AccountNumber,
        subject: String,
        body: String,
        datetime: i64,
    ) {
        unimplemented!()
    }

    /// Unsave a publicly saved message
    /// `unsave` releases the state storage for a previously saved message
    #[action]
    fn unsave(msg_id: u64, sender: AccountNumber, subject: String, body: String, datetime: i64) {
        unimplemented!()
    }

    // Actions for private message groups:

    /// Store a public key that can be used to allow others to send you private messages
    ///
    /// # Arguments
    /// * `key` - The sender's public secp256k1 encryption key in DER format
    #[action]
    fn set_key(key: Vec<u8>) {
        unimplemented!()
    }

    /// Create a private messaging group. The group is only created once. If a second user from the group tries to create
    /// it, the call will succeed, but won't do anything.
    ///
    /// If an expiry is provided, the group will expire, at which time no more messages can be sent. The group can only
    /// be deleted by a group member *after* the provided expiry.
    ///
    /// If no expiry is provided, the group will be open indefinitely but can be deleted by anyone at any time.
    ///
    /// If a group is created and an expired one already exists, the expiry will be updated to the new value. Nothing else
    /// about the group changes.
    ///
    /// # Arguments
    /// * `members` - The members of the group
    /// * `secrets` - The secret, encrypted for each user in the group using their public encryption key.
    ///               This secret is used with a KDF to generate the symmetric key for the group.
    /// * `key_digest` - The sha256 hash of the symmetric key, used for each member to verify their decrypted symmetric key.
    /// * `expiry` - The time at which the group is closed (no more messages can be sent) and can be deleted by anyone.
    /// * `name` - The name of the group (encrypted)
    /// * `description` - The description of the group (encrypted)
    #[action]
    fn create_group(
        members: Vec<AccountNumber>,
        secrets: Vec<Vec<u8>>,
        key_digest: Checksum256,
        expiry: Option<TimePointSec>,
        name: Option<Vec<u8>>,
        description: Option<Vec<u8>>,
    ) {
        unimplemented!()
    }

    /// Allows an expired group to be deleted.
    ///
    /// Groups that were not created with an explicit expiry can be deleted
    /// by any group member at any time.
    #[action]
    fn delete_group(id: Checksum256) {
        unimplemented!()
    }

    /// A member of a group can send a message to the group.
    ///
    /// # Arguments
    /// * `id` - The group id
    /// * `message` - The encrypted message to send
    #[action]
    fn send_to_group(id: Checksum256, message: Vec<u8>) {
        unimplemented!()
    }

    /// Rotate the key for a group. Only callable by a group member.
    ///
    /// The order of the secrets must match the ordering of the accounts in the group
    ///
    /// # Arguments
    /// * `id` - The group id
    /// * `secrets` - The secret, encrypted for each user in the group using their public encryption key.
    ///               This secret is used with a KDF to generate the symmetric key for the group.
    /// * `key_digest` - The sha256 hash of the new symmetric key, used for each member to verify their decrypted symmetric key
    #[action]
    fn rotate_key(id: Checksum256, secrets: Vec<Vec<u8>>, key_digest: Checksum256) {
        unimplemented!()
    }
}

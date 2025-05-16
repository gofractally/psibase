mod group_event;
mod tables;

use psibase::{fracpack::Pack, AccountNumber, Checksum256};
use sha2::{Digest, Sha256};

pub fn get_group_id(mut users: Vec<AccountNumber>) -> Checksum256 {
    users.sort_by(|a, b| a.value.cmp(&b.value));
    Checksum256::from(<[u8; 32]>::from(Sha256::digest(&users.packed())))
}

pub fn now() -> psibase::TimePointSec {
    psibase::TimePointSec::from(
        psibase::services::transact::Wrapper::call()
            .currentBlock()
            .time
            .seconds(),
    )
}

#[psibase::service(tables = "tables::tables")]
pub mod service {
    pub use crate::group_event::GroupEvent;
    pub use crate::tables::tables::*;

    use crate::now;
    use psibase::services::{
        accounts::Wrapper as AccountsSvc, //
        events::Wrapper as EventsSvc,
        sites::Wrapper as SitesSvc,
    };
    use psibase::*;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();

        SitesSvc::call().enableSpa(true);

        EventsSvc::call().addIndex(DbId::HistoryEvent, SERVICE, MethodNumber::from("sent"), 0);
        EventsSvc::call().addIndex(DbId::HistoryEvent, SERVICE, MethodNumber::from("sent"), 1);
    }

    /// Send a public message
    #[action]
    fn send(receiver: AccountNumber, subject: String, body: String) {
        check(
            AccountsSvc::call().exists(receiver),
            &format!("receiver account {} doesn't exist", receiver),
        );
        Wrapper::emit()
            .history()
            .sent(get_sender(), receiver, subject, body, now());
    }

    /// Archive a public message
    #[action]
    fn archive(msg_id: u64) {
        let saved_messages_table = SavedMessageTable::new();
        if let Some(rec) = saved_messages_table.get_index_pk().get(&msg_id) {
            unsave(
                msg_id,
                rec.sender,
                rec.subject,
                rec.body,
                rec.datetime.seconds,
            );
        }

        Wrapper::emit()
            .history()
            .archive(get_sender().to_string() + &msg_id.to_string());
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
        check(
            get_sender() == receiver,
            &format!("only receiver of email can save it"),
        );

        let saved_messages_table = SavedMessageTable::new();
        saved_messages_table
            .put(&SavedMessage {
                msg_id,
                receiver,
                sender,
                subject,
                body,
                datetime: TimePointSec::from(datetime),
            })
            .unwrap();
    }

    /// Unsave a publicly saved message
    /// `unsave` releases the state storage for a previously saved message
    #[action]
    fn unsave(msg_id: u64, sender: AccountNumber, subject: String, body: String, datetime: i64) {
        let saved_messages_table = SavedMessageTable::new();

        saved_messages_table.remove(&SavedMessage {
            msg_id,
            receiver: get_sender(),
            sender,
            subject,
            body,
            datetime: TimePointSec::from(datetime),
        });
    }

    /// Store a public key that can be used to allow others to send you private messages
    ///
    /// # Arguments
    /// * `key` - The sender's public secp256k1 encryption key in DER format
    #[action]
    fn set_key(key: Vec<u8>) {
        UserSettings::add(get_sender(), key);
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
    /// * `keys` - The symmetric decryption key, encrypted for each user in the group using their public encryption key
    /// * `key_digest` - The sha256 hash of the symmetric key, used for each member to verify their decrypted symmetric key
    /// * `expiry` - The time at which the group is closed (no more messages can be sent) and can be deleted by anyone.
    /// * `name` - The name of the group (encrypted)
    /// * `description` - The description of the group (encrypted)
    #[action]
    fn create_group(
        members: Vec<AccountNumber>,
        keys: Vec<Vec<u8>>,
        key_digest: Checksum256,
        expiry: Option<TimePointSec>,
        name: Option<Vec<u8>>,
        description: Option<Vec<u8>>,
    ) {
        check(
            members.contains(&get_sender()),
            "sender must be part of group",
        );
        check(
            members.len() == keys.len(),
            "Each user must be given the symmetric key",
        );
        check(
            members.len() > 1,
            "At least two members are required to create a group",
        );

        let (added, id) = Group::add(members, keys, key_digest.clone(), expiry, name, description);

        if added {
            Wrapper::emit().history().group_event(
                get_sender(),
                id.clone(),
                Group::get_assert(id).created,
                GroupEvent::CREATED,
            );
        }
    }

    /// Allows an expired group to be deleted.
    ///
    /// Groups that were not created with an explicit expiry can be deleted
    /// by any group member at any time.
    #[action]
    fn delete_group(id: Checksum256) {
        let group = Group::get_assert(id.clone());
        group.remove();

        Wrapper::emit()
            .history()
            .group_event(get_sender(), id, now(), GroupEvent::DELETED);
    }

    /// A member of a group can send a message to the group.
    ///
    /// # Arguments
    /// * `id` - The group id
    /// * `message` - The encrypted message to send
    #[action]
    fn send_to_group(id: Checksum256, message: Vec<u8>) {
        let user_groups = UserGroupsTable::new();
        let user_group = user_groups.get_index_pk().get(&(get_sender(), id.clone()));
        check(user_group.is_some(), "sender is not a member of group");

        let mut group = Group::get_assert(id.clone());

        Wrapper::emit().history().sent_to_group(
            get_sender(),
            id,
            group.use_msg_id(),
            now(),
            message,
        );
    }

    /// Rotate the key for a group. Only callable by a group member.
    ///
    /// The order of the keys must match the ordering of the accounts in the group
    ///
    /// # Arguments
    /// * `id` - The group id
    /// * `keys` - The new symmetric keys, encrypted for each user in the group using their public encryption key
    /// * `key_digest` - The sha256 hash of the new symmetric key, used for each member to verify their decrypted symmetric key
    #[action]
    fn rotate_key(id: Checksum256, keys: Vec<Vec<u8>>, key_digest: Checksum256) {
        let sender = get_sender();
        let mut group = Group::get_assert(id.clone());
        check(group.is_member(sender), "sender must be part of group");

        group.rotate_key(keys, key_digest);

        Wrapper::emit()
            .history()
            .group_event(sender, id, now(), GroupEvent::KEY_ROTATED);
    }

    #[event(history)]
    pub fn sent(
        sender: AccountNumber,
        receiver: AccountNumber,
        subject: String,
        body: String,
        datetime: TimePointSec,
    ) {
    }

    #[event(history)]
    pub fn archive(msg_id: String) {}

    #[event(history)]
    pub fn group_event(actor: AccountNumber, id: Checksum256, datetime: TimePointSec, event: u8) {}

    #[event(history)]
    pub fn sent_to_group(
        sender: AccountNumber,
        id: Checksum256,
        msg_id: u32,
        datetime: TimePointSec,
        message: Vec<u8>,
    ) {
    }
}

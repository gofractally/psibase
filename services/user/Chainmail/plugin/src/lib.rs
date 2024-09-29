#[allow(warnings)]
mod bindings;

use bindings::exports::chainmail::plugin::api::{Error, Guest as API};
use bindings::exports::chainmail::plugin::queries::{Guest as QUERY, Message};
use bindings::transact::plugin::intf as Transact;
use psibase::fracpack::Pack;
use psibase::services::r_events::Wrapper as REventsSvc;
use psibase::AccountNumber;

struct ChainmailPlugin;

fn build_query(
    archived_requested: bool,
    sender: Option<String>,
    receiver: Option<String>,
) -> String {
    let where_clause_sender_receiver = String::from("");

    let select_clause = format!("DISTINCT sent.rowid as msg_id, archive.event_id, sent.*");
    let from_clause = format!("\"history.chainmail.sent\" AS sent LEFT JOIN \"history.chainmail.archive\" AS archive ON CONCAT(sent.receiver, sent.rowid) = archive.event_id" );
    let where_clause_archived_or_not = format!(
        "archive.event_id IS {} NULL",
        if archived_requested { "NOT" } else { "" }
    );
    let order_by_clause = "sent.ROWID";

    let sql_query_str = format!(
        "SELECT {} FROM {} WHERE {} {} {} ORDER BY {}",
        select_clause,
        from_clause,
        where_clause_archived_or_not,
        if sender.is_some() || receiver.is_some() {
            "AND"
        } else {
            ""
        },
        where_clause_sender_receiver,
        order_by_clause
    );
    let resp = REventsSvc::call().sqlQuery(sql_query_str);
    println!("response: {}", resp);
    resp
}

impl API for ChainmailPlugin {
    fn send(receiver: String, subject: String, body: String) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "send",
            &chainmail::action_structs::send {
                receiver: AccountNumber::from(receiver.as_str()),
                subject,
                body,
            }
            .packed(),
        )?;
        Ok(())
    }

    fn archive(event_id: u64) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "archive",
            &chainmail::action_structs::archive { event_id }.packed(),
        )?;
        Ok(())
    }
}

impl QUERY for ChainmailPlugin {
    fn get_msgs(sender: Option<String>, receiver: Option<String>) -> Result<Vec<Message>, Error> {
        let archived_requested = false;
        let _resp = build_query(archived_requested, sender, receiver);

        Ok(vec![])
    }

    fn get_archived_msgs(
        _sender: Option<String>,
        _receiver: Option<String>,
    ) -> Result<Vec<Message>, Error> {
        Ok(vec![])
    }
}

bindings::export!(ChainmailPlugin with_types_in bindings);

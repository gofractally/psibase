#[allow(warnings)]
mod bindings;
use bindings::*;

mod helpers;
use helpers::*;

use exports::host::auth::api::Guest as Api;

use psibase::fracpack::{Pack, Unpack};

use crate::bindings::accounts::plugin::api as AccountsApi;

use crate::bindings::host::common::{
    admin as HostAdmin, store as KvStore,
    store::{Database, DbMode, StorageDuration},
    types::{BodyTypes, Error, PostRequest},
};
use crate::bindings::transact::plugin::auth as TransactAuthApi;

const QUERY_TOKEN_BUCKET: &str = "query_tokens";

struct HostAuth;

fn get_query_token_butcket_name(user: &str) -> String {
    format!("{}-{}", QUERY_TOKEN_BUCKET, user)
}

fn set_active_query_token(query_token: &str, app: &str, user: &str) {
    let req: PostRequest = PostRequest {
        endpoint: String::from("/common/set-auth-cookie"),
        body: BodyTypes::Json(format!("{{\"accessToken\": \"{}\"}}", query_token)),
    };
    HostAdmin::post(app, &req).unwrap();

    let bucket = KvStore::Bucket::new(DB, &get_query_token_butcket_name(user));

    bucket.set(&app, &query_token.to_string().packed());
}

const DB: Database = Database {
    mode: DbMode::NonTransactional,
    duration: StorageDuration::Persistent,
};

impl Api for HostAuth {
    fn set_logged_in_user(user: String, app: String) -> Result<(), Error> {
        check_caller(&["accounts"], "set-logged-in-user@host:common/admin");

        let bucket = KvStore::Bucket::new(DB, &get_query_token_butcket_name(&user));
        let query_token = bucket.get(&&app);

        let query_token = if query_token.is_none() {
            TransactAuthApi::get_query_token(&app, &user).unwrap()
        } else {
            let query_token = query_token.unwrap();
            <String>::unpacked(&query_token).unwrap()
        };
        set_active_query_token(&query_token, &app, &user);

        bucket.set(&app, &query_token.packed());

        Ok(())
    }

    fn get_active_query_token(app: String) -> Option<String> {
        check_caller(
            &["host", "supervisor"],
            "get-active-query-token@host:common/admin",
        );

        let user = AccountsApi::get_current_user()?;

        let bucket = KvStore::Bucket::new(DB, &get_query_token_butcket_name(&user));

        let record = bucket.get(&app);

        if let Some(value) = record {
            Some(String::unpacked(&value).expect("Failed to get auth cookie"))
        } else {
            None
        }
    }
}

bindings::export!(HostAuth with_types_in bindings);

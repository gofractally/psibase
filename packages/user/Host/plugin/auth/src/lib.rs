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
    types::{BodyTypes, PostRequest},
};
use crate::bindings::transact::plugin::auth as TransactAuthApi;

const QUERY_TOKEN_BUCKET: &str = "query-token-cookie";

struct HostAuth;

fn get_auth_cookie_store_key(user: &str, app: &str) -> String {
    format!("{}-{}", user, app)
}

fn set_active_query_token(query_token: &str, app: &str, user: &str) {
    let req: PostRequest = PostRequest {
        endpoint: String::from("/common/set-auth-cookie"),
        body: BodyTypes::Json(format!("{{\"accessToken\": \"{}\"}}", query_token)),
    };
    HostAdmin::post(app, &req).unwrap();

    let bucket = KvStore::Bucket::new(DB, &QUERY_TOKEN_BUCKET);

    bucket.set(
        &get_auth_cookie_store_key(user, app),
        &query_token.to_string().packed(),
    );
}

const DB: Database = Database {
    mode: DbMode::NonTransactional,
    duration: StorageDuration::Persistent,
};

impl Api for HostAuth {
    fn set_logged_in_user(user: String, app: String) {
        check_caller(&["accounts"], "set-logged-in-user@host:common/admin");

        let bucket = KvStore::Bucket::new(DB, &QUERY_TOKEN_BUCKET);
        let query_token = bucket.get(&get_auth_cookie_store_key(&user, &app));

        let query_token = if query_token.is_none() {
            TransactAuthApi::get_query_token(&app, &user).unwrap()
        } else {
            let query_token = query_token.unwrap();
            <String>::unpacked(&query_token).unwrap()
        };
        set_active_query_token(&query_token, &app, &user);

        bucket.set(
            &get_auth_cookie_store_key(&user, &app),
            &query_token.packed(),
        );
    }

    fn get_active_query_token(app: String) -> Option<String> {
        check_caller(&["host"], "get-active-query-token@host:common/admin");

        let user = AccountsApi::get_current_user()?;

        let bucket = KvStore::Bucket::new(DB, &QUERY_TOKEN_BUCKET);

        let record = bucket.get(&get_auth_cookie_store_key(&user, &app));

        if let Some(value) = record {
            Some(String::unpacked(&value).expect("Failed to get auth cookie"))
        } else {
            None
        }
    }
}

bindings::export!(HostAuth with_types_in bindings);

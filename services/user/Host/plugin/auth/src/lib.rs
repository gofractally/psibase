#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;

// mod helpers;
// use helpers::*;

use exports::host::auth::api::Guest as Api;

use psibase::fracpack::{Pack, Unpack};
use serde::Serialize;

use crate::bindings::host::common::{
    admin as HostAdmin, client as Client, store as KvStore,
    store::{Database, DbMode, StorageDuration},
    types::{BodyTypes, PostRequest},
};

const AUTH_COOKIE_KEY: &str = "auth-cookie";

fn get_sender() -> String {
    Client::get_sender_app()
        .app
        .expect("ClientData interface can only be used from plugins.")
}
struct HostAuth;

fn get_auth_cookie_store_key(user: String) -> String {
    format!("{}-{}-{}", AUTH_COOKIE_KEY, user, get_sender())
}

impl Api for HostAuth {
    fn get_query_token(app: String, user: String) -> Option<String> {
        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &app);

        let record = bucket.get(&get_auth_cookie_store_key(user));

        if let Some(value) = record {
            return Some(String::unpacked(&value).expect("Failed to get auth cookie"));
        }
        None
    }

    fn set_query_token(query_token: String, app: String, user: String) {
        // check_caller(&["accounts"], "set-auth-cookie@host:common/admin");

        #[derive(Serialize, Debug)]
        #[allow(non_snake_case)]
        struct SetAuthCookieReqPayload {
            #[allow(non_snake_case)]
            accessToken: String,
        }

        // call set-cookie to get HttpOnly cookie set
        let payload = SetAuthCookieReqPayload {
            accessToken: query_token.to_string(),
        };

        let req: PostRequest = PostRequest {
            endpoint: String::from("/common/set-auth-cookie"),
            body: BodyTypes::Json(serde_json::to_string(&payload).unwrap()),
        };
        HostAdmin::post(&app, &req).unwrap();

        // store query-token in localstorage (for Supervisor use)
        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &app);

        bucket.set(
            &get_auth_cookie_store_key(user),
            &query_token.to_string().packed(),
        );
    }
}

bindings::export!(HostAuth with_types_in bindings);

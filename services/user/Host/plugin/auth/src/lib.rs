#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;

mod helpers;
use helpers::*;

use exports::host::auth::api::Guest as Api;

use psibase::fracpack::{Pack, Unpack};
use serde::Serialize;

use crate::bindings::host::common::{
    admin as HostAdmin, store as KvStore,
    store::{Database, DbMode, StorageDuration},
    types::{BodyTypes, PostRequest},
};
use crate::bindings::transact::plugin::auth as TransactAuthApi;

const AUTH_COOKIE_KEY: &str = "auth-cookie";

struct HostAuth;

fn get_auth_cookie_store_key(user: String, app: String) -> String {
    format!("{}-{}-{}", AUTH_COOKIE_KEY, user, app)
}

impl Api for HostAuth {
    fn set_logged_in_user(user: String, app: String) {
        check_caller(&["accounts"], "set-logged-in-user@host:common/admin");

        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &app);
        let query_token = bucket.get(&format!("{}:{}", &user, &app));

        let query_token = if query_token.is_none() {
            println!("Getting fresh query_token...");
            TransactAuthApi::get_query_token(&app, &user).unwrap()
        } else {
            println!("Found cached");
            let query_token = query_token.unwrap();
            <String>::unpacked(&query_token).unwrap()
        };
        println!("query_token: {}", query_token);
        Self::set_query_token(query_token.clone(), app.clone(), user);
        HostAdmin::set_active_query_token(&query_token, &app);

        bucket.set(&format!("{}", app), &query_token.packed());
    }

    fn get_query_token(app: String, user: String) -> Option<String> {
        check_caller(&["host"], "get-query-token@host:common/admin");

        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &app);

        let record = bucket.get(&get_auth_cookie_store_key(user, app));

        if let Some(value) = record {
            return Some(String::unpacked(&value).expect("Failed to get auth cookie"));
        }
        None
    }

    fn set_query_token(query_token: String, app: String, user: String) {
        check_caller(&["host", "accounts"], "set-query-token@host:common/admin");

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
            &get_auth_cookie_store_key(user, app),
            &query_token.to_string().packed(),
        );
    }
}

bindings::export!(HostAuth with_types_in bindings);

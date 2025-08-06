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

const QUERY_TOKEN_KEY: &str = "query-token-cookie";

struct HostAuth;

fn get_auth_cookie_store_key(user: String, app: String) -> String {
    println!(
        "host:auth/get_auth_cookie_store_key(): {}-{}-{}",
        QUERY_TOKEN_KEY, user, app
    );
    format!("{}-{}-{}", QUERY_TOKEN_KEY, user, app)
}

fn set_query_token(query_token: String, app: String, user: String) {
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

    println!(
        "host:auth/set_query_token() storying query-token at key[{}]",
        get_auth_cookie_store_key(user.clone(), app.clone())
    );
    bucket.set(
        &get_auth_cookie_store_key(user, app),
        &query_token.to_string().packed(),
    );
}

impl Api for HostAuth {
    fn set_logged_in_user(user: String, app: String) {
        println!("set_logged_in_user(app[{}], user[{}]", &app, &user);
        check_caller(&["accounts"], "set-logged-in-user@host:common/admin");

        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        let bucket = KvStore::Bucket::new(db, &app);
        let query_token = bucket.get(&get_auth_cookie_store_key(user.clone(), app.clone()));

        let query_token = if query_token.is_none() {
            println!("Getting fresh query_token...");
            TransactAuthApi::get_query_token(&app, &user).unwrap()
        } else {
            println!("Found cached");
            let query_token = query_token.unwrap();
            <String>::unpacked(&query_token).unwrap()
        };
        println!("query_token: {}", query_token);
        println!("setting_query_token()...");
        set_query_token(query_token.clone(), app.clone(), user.clone());
        println!("setting_active_query_token()...");
        HostAdmin::set_active_query_token(&query_token, &app);

        println!(
            "Saving query_token to key[{}]",
            &get_auth_cookie_store_key(user.clone(), app.clone())
        );
        bucket.set(&get_auth_cookie_store_key(user, app), &query_token.packed());
    }

    fn get_query_token(app: String, user: String) -> Option<String> {
        println!(
            "host:auth/get_query_token(app[{}], user[{}]).top",
            app, &user
        );
        check_caller(&["host"], "get-query-token@host:common/admin");

        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        println!(
            "getting query_token from key[{}], app[{}]",
            &get_auth_cookie_store_key(user.clone(), app.clone()),
            &user
        );
        let bucket = KvStore::Bucket::new(db, &app);

        let record = bucket.get(&get_auth_cookie_store_key(user, app));

        let ret_val = if let Some(value) = record {
            Some(String::unpacked(&value).expect("Failed to get auth cookie"))
        } else {
            None
        };
        println!("get_query_token() returning [{:?}]", ret_val);
        ret_val
    }
}

bindings::export!(HostAuth with_types_in bindings);

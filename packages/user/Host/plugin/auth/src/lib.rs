#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;

mod helpers;
use helpers::*;

use exports::host::auth::api::Guest as Api;

use psibase::fracpack::{Pack, Unpack};
use serde::Serialize;

use crate::bindings::accounts::plugin::api as AccountsApi;

use crate::bindings::host::common::{
    admin as HostAdmin, store as KvStore,
    store::{Database, DbMode, StorageDuration},
    types::{BodyTypes, PostRequest},
};
use crate::bindings::transact::plugin::auth as TransactAuthApi;

const QUERY_TOKEN_BUCKET: &str = "query-token-cookie";

struct HostAuth;

fn get_auth_cookie_store_key(user: String, app: String) -> String {
    println!("host:auth/get_auth_cookie_store_key(): {}-{}", user, app);
    format!("{}-{}", user, app)
}

fn set_active_query_token(query_token: String, app: String, user: String) {
    // let user = AccountsApi::get_current_user().unwrap();
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
    let bucket = KvStore::Bucket::new(db, &QUERY_TOKEN_BUCKET);

    println!(
        "host:auth/set_active_query_token() storing query-token in bucket[{}] at key[{}]",
        QUERY_TOKEN_BUCKET,
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
        println!(
            "Getting query-token from bucket[{}] at key[{}]",
            QUERY_TOKEN_BUCKET,
            get_auth_cookie_store_key(user.clone(), app.clone())
        );
        let bucket = KvStore::Bucket::new(db, &QUERY_TOKEN_BUCKET);
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
        println!("setting_active_query_token()...");
        set_active_query_token(query_token.clone(), app.clone(), user.clone());

        println!(
            "Saving query_token to bucket[{}] at key[{}]",
            QUERY_TOKEN_BUCKET,
            &get_auth_cookie_store_key(user.clone(), app.clone())
        );
        bucket.set(&get_auth_cookie_store_key(user, app), &query_token.packed());
    }

    // fn get_active_query_token(app: String) -> Option<String> {
    //     let db = Database {
    //         mode: DbMode::NonTransactional,
    //         duration: StorageDuration::Persistent,
    //     };
    //     let bucket: Bucket = GuestBucket::new(db, String::from(QUERY_TOKEN_BUCKET));
    //
    //     println!(
    //         "host:common/GET_active_query_token().from bucket[{}], at key[{}]",
    //         QUERY_TOKEN_BUCKET,
    //         app.clone()
    //     );
    //     let query_token = bucket.get(app);
    //     let query_token = if query_token.is_some() {
    //         let query_token = query_token.unwrap();
    //         Some(<String>::unpacked(&query_token).unwrap())
    //     } else {
    //         None
    //     };
    //     println!(
    //         "get_active_query_token() returning query_token [{:?}]",
    //         query_token
    //     );
    //     query_token
    // }

    fn get_active_query_token(app: String) -> Option<String> {
        let user = AccountsApi::get_current_user();
        if user.is_none() {
            return None;
        }
        let user = user.unwrap();
        println!(
            "host:auth/get_active_query_token(app[{}], user[{}]).top",
            app, user
        );
        check_caller(&["host"], "get-active-query-token@host:common/admin");

        let db = Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        };
        println!(
            "getting query_token from bucket[{}] from key[{}], app[{}]",
            QUERY_TOKEN_BUCKET,
            &get_auth_cookie_store_key(user.clone(), app.clone()),
            &user
        );
        let bucket = KvStore::Bucket::new(db, &QUERY_TOKEN_BUCKET);

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

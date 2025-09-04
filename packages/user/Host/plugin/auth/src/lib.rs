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
};
use crate::bindings::host::types::types::{BodyTypes, Error, PostRequest};
use crate::bindings::transact::plugin::auth as TransactAuthApi;

const QUERY_TOKEN_BUCKET: &str = "query_tokens";

struct HostAuth;

fn get_query_token_bucket_name(user: &str) -> String {
    format!("{}-{}", QUERY_TOKEN_BUCKET, user)
}

fn set_active_query_token(query_token: &str, app: &str, user: &str) {
    let req: PostRequest = PostRequest {
        endpoint: String::from("/common/set-auth-cookie"),
        body: BodyTypes::Json(format!("{{\"accessToken\": \"{}\"}}", query_token)),
    };
    HostAdmin::post(app, &req).unwrap();

    let bucket = KvStore::Bucket::new(DB, &get_query_token_bucket_name(user));

    bucket.set(&app, &query_token.to_string().packed());
}

fn remove_active_query_token(app: &str, user: &str) {
    let req: PostRequest = PostRequest {
        endpoint: String::from("/common/remove-auth-cookie"),
        body: BodyTypes::Json(format!("{{}}")),
    };
    HostAdmin::post(app, &req).unwrap();

    let bucket = KvStore::Bucket::new(DB, &get_query_token_bucket_name(&user));
    bucket.delete(&&app);
}

const DB: Database = Database {
    mode: DbMode::NonTransactional,
    duration: StorageDuration::Persistent,
};

impl Api for HostAuth {
    fn set_logged_in_user(user: String, app: String) -> Result<(), Error> {
        println!("set_logged_in_user().1");
        check_caller(&["accounts"], "set-logged-in-user@host:auth/api");

        let bucket = KvStore::Bucket::new(DB, &get_query_token_bucket_name(&user));
        let query_token = bucket.get(&&app);

        println!("set_logged_in_user().2");
        let query_token = if query_token.is_none() {
            TransactAuthApi::get_query_token(&app, &user).unwrap()
        } else {
            let query_token = query_token.unwrap();
            <String>::unpacked(&query_token).unwrap()
        };
        println!("set_logged_in_user().3");
        set_active_query_token(&query_token, &app, &user);
        println!("set_logged_in_user().4");

        Ok(())
    }

    fn log_out_user(user: String, app: String) {
        check_caller(&["accounts"], "log_out_user@host:auth/api");
        remove_active_query_token(&app, &user);
    }

    fn get_active_query_token(app: String) -> Option<String> {
        check_caller(
            &["host", "supervisor"],
            "get-active-query-token@host:auth/api",
        );

        let user = AccountsApi::get_current_user()?;

        let bucket = KvStore::Bucket::new(DB, &get_query_token_bucket_name(&user));

        let record = bucket.get(&app);

        if let Some(value) = record {
            Some(String::unpacked(&value).expect("Failed to get auth cookie"))
        } else {
            None
        }
    }
}

bindings::export!(HostAuth with_types_in bindings);

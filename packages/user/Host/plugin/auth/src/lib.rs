#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;

mod helpers;
use helpers::*;

use exports::host::auth::api::Guest as Api;

use psibase::fracpack::{Pack, Unpack};

use crate::bindings::{
    host::{
        common::admin as HostAdmin,
        db::store::{Bucket, Database, DbMode, StorageDuration},
        types::types::{BodyTypes, Claim, Error, PostRequest},
    },
    transact::plugin::auth as Transact,
};

struct HostAuth;

const DB: Database = Database {
    mode: DbMode::NonTransactional,
    duration: StorageDuration::Persistent,
};

fn bucket_id(user: &str) -> String {
    format!("query_tokens-{}", user)
}

fn install_cookie(query_token: &str, app: &str) {
    let req: PostRequest = PostRequest {
        endpoint: String::from("/common/set-auth-cookie"),
        body: BodyTypes::Json(format!("{{\"accessToken\": \"{}\"}}", query_token)),
    };
    HostAdmin::post_with_credentials(app, &req).unwrap();
}

fn cache_token(query_token: &str, app: &str, user: &str) {
    Bucket::new(DB, &bucket_id(user)).set(&app, &query_token.to_string().packed());
}

fn cached_token(app: &str, user: &str) -> Option<String> {
    Bucket::new(DB, &bucket_id(user))
        .get(&app)
        .map(|t| String::unpacked(&t).unwrap())
}

fn remove_active_query_token(app: &str, user: &str) {
    let req: PostRequest = PostRequest {
        endpoint: String::from("/common/remove-auth-cookie"),
        body: BodyTypes::Json(format!("{{}}")),
    };
    HostAdmin::post_with_credentials(app, &req).unwrap();

    Bucket::new(DB, &bucket_id(user)).delete(&&app);
}

impl Api for HostAuth {
    fn use_session(user: String, app: String) -> Result<(), Error> {
        check_caller(&["accounts"], "use-session@host:auth/api");

        let token =
            cached_token(&app, &user).ok_or_else(|| Error::from(ReauthorizationRequired(user)))?;
        install_cookie(&token, &app);
        Ok(())
    }

    fn new_session(user: String, app: String, claim: Option<Claim>) -> Result<(), Error> {
        check_caller(&["accounts"], "new-session@host:auth/api");

        let token = Transact::get_query_token(&app, &user, claim.as_ref())?;
        cache_token(&token, &app, &user);
        install_cookie(&token, &app);
        Ok(())
    }

    fn end_session(user: String, app: String) {
        check_caller(&["accounts"], "end-session@host:auth/api");
        remove_active_query_token(&app, &user);
    }

    fn get_active_query_token(app: String, user: String) -> Option<String> {
        check_caller(
            &["host", "supervisor"],
            "get-active-query-token@host:auth/api",
        );

        cached_token(&app, &user)
    }
}

bindings::export!(HostAuth with_types_in bindings);

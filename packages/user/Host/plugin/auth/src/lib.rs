#[allow(warnings)]
mod bindings;
use bindings::*;

mod helpers;
use helpers::*;

use exports::host::auth::api::Guest as Api;

use psibase::fracpack::{Pack, Unpack};

use crate::bindings::{
    host::{
        client::api as CallContext,
        db::store::{Bucket, Database, DbMode, StorageDuration},
        types::types::{Claim, Error},
    },
    supervisor::bridge::{
        intf as Supervisor,
        types::{BodyTypes, Header, HttpRequest},
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

fn post_to_app(app: &str, endpoint: &str, body: String) -> HttpRequest {
    HttpRequest {
        uri: format!(
            "{}/{}",
            CallContext::get_app_url(app),
            endpoint.trim_start_matches('/')
        ),
        method: "POST".to_string(),
        headers: vec![Header {
            key: "Content-Type".to_string(),
            value: "application/json".to_string(),
        }],
        body: Some(BodyTypes::Json(body)),
    }
}

fn set_active_query_token(query_token: &str, app: &str, user: &str) {
    let req = post_to_app(
        app,
        "/common/set-auth-cookie",
        format!("{{\"accessToken\": \"{}\"}}", query_token),
    );
    Supervisor::send_request(&req, true).unwrap();

    Bucket::new(DB, &bucket_id(user)).set(&app, &query_token.to_string().packed());
}

fn cached_token(app: &str, user: &str) -> Option<String> {
    Bucket::new(DB, &bucket_id(user))
        .get(&app)
        .map(|t| String::unpacked(&t).unwrap())
}

fn remove_active_query_token(app: &str, user: &str) {
    let req = post_to_app(app, "/common/remove-auth-cookie", "{}".to_string());
    Supervisor::send_request(&req, true).unwrap();

    Bucket::new(DB, &bucket_id(user)).delete(&&app);
}

impl Api for HostAuth {
    fn set_logged_in_user(user: String, app: String, claim: Option<Claim>) -> Result<(), Error> {
        check_caller(&["accounts"], "set-logged-in-user@host:auth/api");

        let token = match cached_token(&app, &user) {
            Some(t) => t,
            None => Transact::get_query_token(&app, &user, claim.as_ref())?,
        };
        set_active_query_token(&token, &app, &user);
        Ok(())
    }

    fn log_out_user(user: String, app: String) {
        check_caller(&["accounts"], "log-out-user@host:auth/api");
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

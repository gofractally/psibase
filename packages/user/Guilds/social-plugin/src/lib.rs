#[allow(warnings)]
mod bindings;
mod errors;

use bindings::exports::social::plugin::authorized::Guest as Authorized;
use bindings::exports::social::plugin::posts::Guest as Posts;
use bindings::exports::social::plugin::threads::Guest as Threads;
use bindings::tokens::plugin::helpers::decimal_to_u64;
use bindings::tokens::plugin::user as TokensUser;
use bindings::transact::plugin::api::set_propose_latch;

use std::str::FromStr;

use psibase::{AccountNumber, Subaccount};
use psibase_plugin::{trust::*, *};
use social::Wrapper as Social;

use crate::errors::ErrorType;

const JUDICIARY: u8 = 2;

struct SocialPlugin;

impl TrustConfig for SocialPlugin {
    fn capabilities() -> Capabilities {
        Capabilities {
            low: &[],
            medium: &[
                "Posting in a thread you can see",
                "Bidding on a post you can see",
            ],
            high: &[
                "Creating a thread",
                "Changing who can read or moderate a thread",
                "Changing a thread's posting fee",
                "Removing a post",
            ],
        }
    }
}

fn stage(account: &str) -> Result<(), Error> {
    set_propose_latch(Some(account))
}

fn judiciary(fractal: &str) -> String {
    AccountNumber::from_str(fractal)
        .unwrap()
        .with_subaccount(Subaccount(JUDICIARY))
        .to_string()
}

fn credit(token_id: u32, amount: &str) -> Result<(), Error> {
    let amount = amount.to_string();
    let memo = "Thread".to_string();
    TokensUser::credit(token_id, &Social::SERVICE.to_string(), &amount, &memo)?;
    Ok(())
}

impl Threads for SocialPlugin {
    #[psibase_plugin::authorized(High)]
    fn create_thread(
        guild: String,
        account: String,
        title: String,
        public: bool,
        initial_fee: u64,
        window_seconds: u32,
    ) -> Result<(), Error> {
        stage(&guild)?;
        Social::add_to_tx().create_thread(
            account.parse().unwrap(),
            title.parse().map_err(|_| ErrorType::TitleTooLong)?,
            public,
            initial_fee,
            window_seconds,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn set_open(fractal: String, open: bool) -> Result<(), Error> {
        stage(&fractal)?;
        Social::add_to_tx().set_open(fractal.parse().unwrap(), open);
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn set_reader(
        fractal: String,
        thread: String,
        guild: String,
        allow: bool,
    ) -> Result<(), Error> {
        stage(&judiciary(&fractal))?;
        Social::add_to_tx().set_reader(
            fractal.parse().unwrap(),
            thread.parse().unwrap(),
            guild.parse().unwrap(),
            allow,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn set_mod(fractal: String, thread: String, guild: String, allow: bool) -> Result<(), Error> {
        stage(&judiciary(&fractal))?;
        Social::add_to_tx().set_mod(
            fractal.parse().unwrap(),
            thread.parse().unwrap(),
            guild.parse().unwrap(),
            allow,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn set_public(
        as_account: String,
        fractal: String,
        thread: String,
        public: bool,
    ) -> Result<(), Error> {
        stage(&as_account)?;
        Social::add_to_tx().set_public(fractal.parse().unwrap(), thread.parse().unwrap(), public);
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn set_fee(
        as_account: String,
        fractal: String,
        thread: String,
        window_seconds: u32,
        target_min: u32,
        target_max: u32,
        floor: u64,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) -> Result<(), Error> {
        stage(&as_account)?;
        Social::add_to_tx().set_fee(
            fractal.parse().unwrap(),
            thread.parse().unwrap(),
            window_seconds,
            target_min,
            target_max,
            floor,
            increase_ppm,
            decrease_ppm,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn set_bid_secs(
        as_account: String,
        fractal: String,
        thread: String,
        seconds: u32,
    ) -> Result<(), Error> {
        stage(&as_account)?;
        Social::add_to_tx().set_bid_secs(
            fractal.parse().unwrap(),
            thread.parse().unwrap(),
            seconds,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn rm_post(as_account: String, id: u32) -> Result<(), Error> {
        stage(&as_account)?;
        Social::add_to_tx().rm_post(id);
        Ok(())
    }
}

impl Posts for SocialPlugin {
    #[psibase_plugin::authorized(Medium)]
    fn post(
        fractal: String,
        thread: String,
        subject: String,
        body: String,
        token_id: u32,
        amount: String,
    ) -> Result<(), Error> {
        credit(token_id, &amount)?;
        let paid = decimal_to_u64(token_id, &amount)?;
        Social::add_to_tx().post(
            fractal.parse().unwrap(),
            thread.parse().unwrap(),
            subject,
            body,
            paid,
        );
        Ok(())
    }

    #[psibase_plugin::authorized(Medium)]
    fn bid(id: u32, token_id: u32, amount: String) -> Result<(), Error> {
        credit(token_id, &amount)?;
        let paid = decimal_to_u64(token_id, &amount)?;
        Social::add_to_tx().bid(id, paid);
        Ok(())
    }

    #[psibase_plugin::authorized(Medium)]
    fn claim(id: u32) -> Result<(), Error> {
        Social::add_to_tx().claim(id);
        Ok(())
    }
}

impl Authorized for SocialPlugin {
    #[psibase_plugin::authorized(None)]
    fn graphql(query: String) -> Result<String, Error> {
        psibase_plugin::host::server::post_graphql_get_json(&query)
    }
}

bindings::export!(SocialPlugin with_types_in bindings);

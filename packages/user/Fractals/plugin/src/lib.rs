#[allow(warnings)]
mod bindings;

use bindings::exports::fractals::plugin::admin_fractal::Guest as AdminFractal;
use bindings::exports::fractals::plugin::queries::Guest as Queries;
use bindings::exports::fractals::plugin::user_fractal::Guest as UserFractal;

use psibase_plugin::{trust::*, *};

use fractals::Wrapper as Fractals;

mod errors;
mod graphql;
mod helpers;

use crate::bindings::accounts::plugin::api::gen_rand_account;
use crate::bindings::exports::fractals::plugin::types;
use crate::bindings::guilds::plugin as Guilds;
use crate::bindings::transact::plugin::intf::set_propose_latch;
use crate::graphql::fractal::get_fractal;
use crate::helpers::{get_sender_app, validate_account_name};

struct FractallyPlugin;

impl TrustConfig for FractallyPlugin {
    fn capabilities() -> Capabilities {
        Capabilities {
            low: &["Triggering a fractal-wide token distribution"],
            medium: &[
                "Creating a new fractal",
                "Claiming accrued fractal token rewards",
            ],
            high: &["Setting the occupation service for a fractal role"],
        }
    }
}

impl AdminFractal for FractallyPlugin {
    #[psibase_plugin::authorized(Medium)]
    fn create_fractal(
        fractal_account: String,
        guild_account: String,
        name: String,
        mission: String,
    ) -> Result<(), Error> {
        use psibase::services::fractals::FractalRole::{
            Executive, Judiciary, Legislature, Recruitment,
        };

        validate_account_name(&fractal_account)?;
        validate_account_name(&guild_account)?;

        let fractal = fractal_account.parse().unwrap();

        Fractals::add_to_tx().create_frac(
            fractal,
            gen_rand_account(Some("leg"))?.as_str().into(),
            gen_rand_account(Some("jud"))?.as_str().into(),
            gen_rand_account(Some("exec"))?.as_str().into(),
            gen_rand_account(Some("rec"))?.as_str().into(),
            name,
            mission,
        );

        Guilds::admin_guild::create_guild("Genesis", &fractal_account, &guild_account)?;
        set_propose_latch(Some(&fractal_account))?;

        Guilds::admin_fractal::set_role_map(Legislature.into(), &guild_account)?;
        Guilds::admin_fractal::set_role_map(Judiciary.into(), &guild_account)?;
        Guilds::admin_fractal::set_role_map(Executive.into(), &guild_account)?;
        Guilds::admin_fractal::set_role_map(Recruitment.into(), &guild_account)?;

        set_propose_latch(None)?;

        let set_role_occ = |role_id: u8| {
            Fractals::add_to_tx().set_r_occ(fractal, role_id, "guilds".into());
        };

        set_role_occ(Legislature.into());
        set_role_occ(Judiciary.into());
        set_role_occ(Executive.into());
        set_role_occ(Recruitment.into());
        Ok(())
    }

    #[psibase_plugin::authorized(High)]
    fn set_role_occupation(role_id: u8, occupation: String) -> Result<(), Error> {
        Fractals::add_to_tx().set_r_occ(get_sender_app()?, role_id, occupation.as_str().into());
        Ok(())
    }

    #[psibase_plugin::authorized(None)]
    fn init_token() -> Result<(), Error> {
        Fractals::add_to_tx().init_token(get_sender_app()?);
        Ok(())
    }

    #[psibase_plugin::authorized(None)]
    fn exile_member(member: String) -> Result<(), Error> {
        Fractals::add_to_tx().exile_member(get_sender_app()?, member.parse().unwrap());
        Ok(())
    }

    #[psibase_plugin::authorized(None)]
    fn set_dist_interval(distribution_interval_secs: u32) -> Result<(), Error> {
        Fractals::add_to_tx().set_dist_int(get_sender_app()?, distribution_interval_secs);
        Ok(())
    }
}

impl UserFractal for FractallyPlugin {
    #[psibase_plugin::authorized(Medium)]
    fn claim_rewards(member: String) -> Result<(), Error> {
        Fractals::add_to_tx().claim_rew(get_sender_app()?, member.parse().unwrap());
        Ok(())
    }

    #[psibase_plugin::authorized(Low)]
    fn dist_token() -> Result<(), Error> {
        Fractals::add_to_tx().dist_token(get_sender_app()?);
        Ok(())
    }
}

impl Queries for FractallyPlugin {
    fn get_fractal(fractal_account: String) -> Result<types::Fractal, Error> {
        let fractal = get_fractal(fractal_account)?;
        Ok(types::Fractal {
            fractal: fractal.account.to_string(),
            judiciary: fractal.judiciary.to_string(),
            legislature: fractal.legislature.to_string(),
            token_id: fractal.token_id,
        })
    }
}

bindings::export!(FractallyPlugin with_types_in bindings);

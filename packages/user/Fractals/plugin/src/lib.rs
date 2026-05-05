#[allow(warnings)]
mod bindings;

use bindings::exports::fractals::plugin::admin_fractal::Guest as AdminFractal;
use bindings::exports::fractals::plugin::queries::Guest as Queries;
use bindings::exports::fractals::plugin::user_fractal::Guest as UserFractal;

use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
mod graphql;
mod helpers;

use crate::bindings::accounts::plugin::api::gen_rand_account;
use crate::bindings::exports::fractals::plugin::types;
use crate::graphql::fractal::get_fractal;
use crate::helpers::get_sender_app;
use crate::trust::assert_authorized;
use psibase::define_trust;
use trust::FunctionName;

use crate::bindings::transact::plugin::intf::set_propose_latch;

use crate::bindings::guilds::plugin as Guilds;

define_trust! {
    descriptions {
        Low => "
            - Triggering a fractal-wide token distribution
        ",
        Medium => "
            - Creating a new fractal
            - Joining the fractal
            - Claiming accrued fractal token rewards
            - Inviting a new member to a guild
        ",
        High => "
            - Attesting a finalized ranking proposal
            - Setting the occupation service for a fractal role
        ",
    }
    functions {
        None => [exile_member, init_token, set_dist_interval],
        Low => [dist_token],
        Medium => [claim_rewards, invite_member, create_fractal, join],
        High => [attest, set_role_occupation],
    }
}

struct FractallyPlugin;

impl AdminFractal for FractallyPlugin {
    fn create_fractal(
        fractal_account: String,
        guild_account: String,
        name: String,
        mission: String,
    ) -> Result<(), Error> {
        assert_authorized(FunctionName::create_fractal)?;

        let fractal = fractal_account.parse().unwrap();
        let legislature = gen_rand_account(Some("leg"))?.as_str().into();

        let packed_args = fractals::action_structs::create_frac {
            fractal_account: fractal,
            name,
            mission,
            legislature,
            judiciary: gen_rand_account(Some("jud"))?.as_str().into(),
            executive: gen_rand_account(Some("exec"))?.as_str().into(),
            recruitment: gen_rand_account(Some("rec"))?.as_str().into(),
        }
        .packed();

        add_action_to_transaction(
            fractals::action_structs::create_frac::ACTION_NAME,
            &packed_args,
        )?;

        Guilds::admin_guild::create_guild("Genesis", &fractal_account, &guild_account)?;
        set_propose_latch(Some(&fractal_account))?;

        Guilds::admin_fractal::set_role_map(1, &guild_account)?;
        Guilds::admin_fractal::set_role_map(2, &guild_account)?;
        Guilds::admin_fractal::set_role_map(3, &guild_account)?;
        Guilds::admin_fractal::set_role_map(4, &guild_account)?;

        set_propose_latch(Some(&legislature.to_string()))?;

        let set_role_occ = |role_id: u8| {
            let packed_args = fractals::action_structs::set_r_occ {
                fractal,
                new_occupation: "guilds".into(),
                role_id,
            }
            .packed();
            add_action_to_transaction(
                fractals::action_structs::set_r_occ::ACTION_NAME,
                &packed_args,
            )
        };

        set_role_occ(1)?; // Legislature
        set_role_occ(2)?; // Judiciary
        set_role_occ(3)?; // Executive
        set_role_occ(4) // Recruitment
    }

    fn set_role_occupation(role_id: u8, occupation: String) -> Result<(), Error> {
        assert_authorized(FunctionName::set_role_occupation)?;
        let packed_args = fractals::action_structs::set_r_occ {
            fractal: get_sender_app()?,
            new_occupation: occupation.as_str().into(),
            role_id,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::set_r_occ::ACTION_NAME,
            &packed_args,
        )
    }

    fn init_token() -> Result<(), Error> {
        assert_authorized(FunctionName::init_token)?;

        let packed_args = fractals::action_structs::init_token {
            fractal: get_sender_app()?,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::init_token::ACTION_NAME,
            &packed_args,
        )
    }

    fn exile_member(member: String) -> Result<(), Error> {
        assert_authorized(FunctionName::exile_member)?;
        let packed_args = fractals::action_structs::exile_member {
            fractal: get_sender_app()?,
            member: member.parse().unwrap(),
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::exile_member::ACTION_NAME,
            &packed_args,
        )
    }

    fn set_dist_interval(distribution_interval_secs: u32) -> Result<(), Error> {
        assert_authorized(FunctionName::set_dist_interval)?;
        let packed_args = fractals::action_structs::set_dist_int {
            fractal: get_sender_app()?,
            distribution_interval_secs,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::set_dist_int::ACTION_NAME,
            &packed_args,
        )
    }
}

impl UserFractal for FractallyPlugin {
    fn claim_rewards(member: String) -> Result<(), Error> {
        assert_authorized(FunctionName::claim_rewards)?;
        let packed_args = fractals::action_structs::claim_rew {
            fractal: get_sender_app()?,
            member: member.parse().unwrap(),
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::claim_rew::ACTION_NAME,
            &packed_args,
        )
    }

    fn dist_token() -> Result<(), Error> {
        assert_authorized(FunctionName::dist_token)?;
        let packed_args = fractals::action_structs::dist_token {
            fractal: get_sender_app()?,
        }
        .packed();
        add_action_to_transaction(
            fractals::action_structs::dist_token::ACTION_NAME,
            &packed_args,
        )
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

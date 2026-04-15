#[allow(warnings)]
mod bindings;

use bindings::exports::fractal_core::plugin::admin_fractal::Guest as AdminFractal;
use bindings::exports::fractal_core::plugin::user_fractal::Guest as UserFractal;

use bindings::host::types::types::Error;

use psibase::define_trust;
mod errors;
mod propose;

use bindings::fractals::plugin as FractalsPlugin;

use trust::{assert_authorized, FunctionName};

define_trust! {
    descriptions {
        Low => "
            - Trigger a fractal wide token distribution
            - Initialise fractal token
        ",
        Medium => "",
        High => "
            - Exiling a member from a fractal
            - Set the fractal token distribution schedule
        ",
    }
    functions {
        None => [get_group_users],
        Low => [dist_token, init_token],
        Medium => [],
        High => [exile_member, set_dist_interval],
    }
}

struct FractalCorePlugin;

impl AdminFractal for FractalCorePlugin {
    fn set_dist_interval(interval_seconds: u32) -> Result<(), Error> {
        assert_authorized(FunctionName::set_dist_interval)?;
        propose::legislature()?;

        FractalsPlugin::admin_fractal::set_dist_interval(interval_seconds)
    }

    fn exile_member(member_account: String) -> Result<(), Error> {
        assert_authorized(FunctionName::exile_member)?;
        propose::judiciary()?;

        FractalsPlugin::admin_fractal::exile_member(&member_account)
    }

    fn init_token() -> Result<(), Error> {
        assert_authorized(FunctionName::init_token)?;
        propose::legislature()?;

        FractalsPlugin::admin_fractal::init_token()
    }
}

impl UserFractal for FractalCorePlugin {
    fn dist_token() -> Result<(), Error> {
        assert_authorized(FunctionName::dist_token)?;
        FractalsPlugin::user_fractal::dist_token()
    }
}

bindings::export!(FractalCorePlugin with_types_in bindings);

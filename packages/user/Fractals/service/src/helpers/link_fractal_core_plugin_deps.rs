use psibase::services::dyn_ld::{self, DynDep};
use psibase::{account, AccountNumber, ServiceWrapper};

/// Dyn-ld mappings for the FractalCore UI plugin.
///
/// Fractal accounts proxy Sites content from `fractal-cr`, but the supervisor
/// resolves plugin dependencies via `depsFor(<fractal account>)`. Without these
/// links, WIT namespaces are treated as service names (e.g. `permissions`),
/// which is wrong for renamed accounts (`permissions` → `perms`).
pub fn link_fractal_core_plugin_deps(fractal: AccountNumber) {
    let deps = vec![
        DynDep {
            name: "host".into(),
            service: account!("host"),
        },
        DynDep {
            name: "transact".into(),
            service: account!("transact"),
        },
        DynDep {
            name: "permissions".into(),
            service: account!("perms"),
        },
        DynDep {
            name: "fractals".into(),
            service: account!("fractals"),
        },
        DynDep {
            name: "guilds".into(),
            service: account!("guilds"),
        },
        DynDep {
            name: "staged-tx".into(),
            service: account!("staged-tx"),
        },
        DynDep {
            name: "accounts".into(),
            service: account!("accounts"),
        },
        DynDep {
            name: "sites".into(),
            service: account!("sites"),
        },
    ];

    dyn_ld::Wrapper::call_as(fractal).link("FractalCore".into(), deps);
}

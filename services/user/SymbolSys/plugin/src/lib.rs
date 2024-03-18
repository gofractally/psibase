#[allow(warnings)]
mod bindings;

struct Component;

use bindings::exports::symbol_sys::plugin as SymbolSysPlugin;

impl SymbolSysPlugin::symbol_sys::Guest for Component {
    fn create() -> String {
        "derp".to_string()
    }

    fn list_symbol(
        symbol_name: String,
        price: SymbolSysPlugin::types::Quantity,
    ) -> Result<(), String> {
        Ok(())
    }

    fn unlist_symbol(symbol_id: String) -> Result<(), String> {
        Ok(())
    }

    fn buy_symbol(symbol_id: String) -> Result<(), String> {
        Ok(())
    }

    fn derp() -> String {
        "mate".to_string()
    }
}

bindings::export!(Component with_types_in bindings);

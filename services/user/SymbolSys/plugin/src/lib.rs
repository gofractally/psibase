#[allow(warnings)]
mod bindings;

struct Component;

use bindings::exports::symbol_sys::plugin as SymbolSysPlugin;

impl SymbolSysPlugin::symbol_sys::Guest for Component {
    fn create(symbol_name: String) -> Result<(), String> {
        Ok(())
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
}

bindings::export!(Component with_types_in bindings);

use fracpack::Packable;
use libpsibase::Action;
use psi_macros::contract;

// Move to a proper package, reusable lib
extern "C" {
    fn __wasm_call_ctors(); // TODO: do we really need this?
    fn writeConsole(message: *const u8, len: u32);
    fn getResult(dest: *const u8, dest_size: u32, offset: u32);
    fn getCurrentAction() -> u32;
}

pub fn get_result(size: u32) -> Vec<u8> {
    let mut result: Vec<u8> = Vec::with_capacity(size as usize);
    if size != 0 {
        unsafe {
            getResult(result.as_ptr(), size, 0);
        }
    }
    result
}

pub fn write_console(msg: &str) {
    unsafe {
        writeConsole(msg.as_ptr(), msg.len() as u32);
    }
}

pub fn get_current_action() -> Action {
    let data = get_result(unsafe { getCurrentAction() });
    Action::unpack(&data, &mut 0).unwrap()
}

#[contract(example)]
pub mod example_contract {
    #[action]
    pub fn hi() {
        super::write_console("hello2");
    }

    #[action]
    pub fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    #[action]
    pub fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }
}

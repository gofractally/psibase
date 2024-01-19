use anyhow::anyhow;
use walrus::{FunctionId, ir::Instr, Module, TypeId, FunctionBuilder};

/// The polyfill module must not have the following sections, since they require 
/// relocatable wasms to merge:
/// * Tables
/// * Start
/// * Elements
/// * Data
/// 
/// The polyfill must include the following sections:
/// * Types
/// * Imports
/// * Functions
/// * Exports
/// 
/// Any local functions in the polyfill must have >0 instructions
fn validate_polyfill(polyfill: &walrus::Module) -> Result<(), anyhow::Error> {
    if polyfill.tables.iter().next().is_some()
        || polyfill.start.is_some()
        || polyfill.elements.iter().next().is_some()
        || polyfill.data.iter().next().is_some()
    {
        // Rust uses lld, which currently errors out when attempting to 
        // produce relocatable wasms. If it could produce relocatable wasms,
        // there is an alternative solution to writing this custom
        // linker: feed lld's output, along with the polyfill, back
        // into lld, after repairing names which unfortunately vary
        // over time, e.g.
        // "$_ZN4wasi13lib_generated22wasi_snapshot_preview18fd_write17haadc9440e6dddc5cE"
        //
        // Another option that we may try in the future: rustc doesn't
        // give us enough control over library link order to insert
        // polyfills into the right spot. We could create a linker wrapper
        // which invokes lld after doing the name translation, giving
        // us that control. We'd still have to remove unused functions
        // after link, since neither lld nor binaryen currently do that.
        // wasm-gc does it, but its repo is archived.
        return Err(anyhow!("Polyfill has unexpected section"));
    }
    if polyfill.types.iter().next().is_none()
        || polyfill.imports.iter().next().is_none()
        || polyfill.funcs.iter().next().is_none()
        || polyfill.funcs.iter_local().any(|(_, local_function)| local_function.size() == 0) 
        || polyfill.exports.iter().next().is_none()
    {
        return Err(anyhow!("Polyfill has missing section"));
    }

    Ok(())
}

/// The module is not a supported target for polyfilling if it has the following:
/// * A start module
fn validate_fill_target(module: &walrus::Module) -> Result<(), anyhow::Error> {
    if module.start.is_some() {
        return Err(anyhow!("Target module has unsupported section: start"))?;
    }
    Ok(())
}

/// A module is not a candidate for polyfilling if it has any of the following:
/// * No types
/// * No imports
/// * No functions
/// * No function bodies
/// * No exports
/// * No function exports
fn should_polyfill(module : &walrus::Module) -> bool {
    if module.types.iter().next().is_none()
        || module.imports.iter().next().is_none()
        || module.funcs.iter().next().is_none()
        || module.funcs.iter_local().all(|f| f.1.size() == 0) 
        || module.exports.iter().next().is_none()
        || !module.funcs.iter().any(|f| module.exports.get_exported_func(f.id()).is_some()) {
        return false;
    }
    true
}

/// Matches imported functions in a destination module to exported functions in a source module
struct PolyfillTarget {
    source_fid : FunctionId,
    dest_fid : FunctionId,
}

/// Confirms that the parameters and results are the same given two type IDs and their 
/// corresponding modules.
fn same_signature(tid1 : &TypeId, m1 : &Module, tid2 : &TypeId, m2 : &Module) -> bool {
    let t1 = m1.types.get(*tid1);
    let t2 = m2.types.get(*tid2);
    
    return t1.params() == t2.params() 
        && t1.results() == t2.results();
}

/// Returns a list of function IDs exported from the `source` module mapped to the 
/// corresponding function IDs imported in the `dest` module.
/// 
/// Only functions that are actually imported in the `dest` module will be considered for polyfilling. 
/// This function also checks that the signature of the replacement function matches the signature of 
/// the imported function.
fn get_polyfill_targets(source: &walrus::Module, dest: &walrus::Module) -> Result<Option<Vec<PolyfillTarget>>, anyhow::Error> {
    
    let targets : Vec<PolyfillTarget> = dest.imports.iter().filter_map(|import| {
        let name = &import.name;
        
        // If the import is a function, get it
        let dest_func = match import.kind {
            walrus::ImportKind::Function(import_fid) => dest.funcs.get(import_fid),
            _ => return None,
        };

        // Get the corresponding export function
        let source_func = match source.exports.get_func(name) {
            // Match guard ensures the export function has a local definition
            Ok(exp_fid) if matches!(source.funcs.get(exp_fid).kind, walrus::FunctionKind::Local(_)) => source.funcs.get(exp_fid),
            _ => return None,
        };

        // Check that the signatures match
        assert!(same_signature(&dest_func.ty(), dest, &source_func.ty(), source), 
            "Destination import {} matches source export by name but not by type.", name);
        // Todo - this should more gracefully handle the error, rather than panic

        Some(PolyfillTarget{
            source_fid: source_func.id(),
            dest_fid: dest_func.id(),
        })
    }).collect();

    return Ok(Some(targets));
}

/// Gets the instructions of the local `fid` function from the specified module.
fn get_instructions(fid : FunctionId, module: & mut walrus::Module) -> Result<Vec<Instr>, anyhow::Error> {
    let func = module.funcs.get_mut(fid);
    
    if let walrus::FunctionKind::Local(local_func) = &mut func.kind {
        let instructions = local_func.builder_mut().func_body().instrs().iter().map(|(i, _)| i.clone()).collect();
        return Ok(instructions);
    }
    return Err(anyhow!("No instructions found for requested local function"));
}

/// Validates an instruction.
/// An instruction is valid if it is not of type: `CallIndirect`, `GlobalGet`, or `GlobalSet`.
fn validate_instruction(instr : &Instr) -> Result<(), anyhow::Error> {
    match &instr {
        Instr::CallIndirect(_) => {
            return Err(anyhow!("Error: Polyfill module is not allowed to use an indirect call."));
        }
        Instr::GlobalGet(_) => {
            return Err(anyhow!("Error: Polyfill module is not allowed to get a global."));    
        }
        Instr::GlobalSet(_) => {
            return Err(anyhow!("Error: Polyfill module is not allowed to set a global."));
        }
        _ => {
            return Ok(());
        }
    }
}

/// Calls `validate_instruction` on each instruction in `instrs`.
fn validate_instructions(instrs : &Vec<Instr>) -> Result<(), anyhow::Error> {
    for instr in instrs {
        validate_instruction(&instr)?;
    }
    Ok(())
}

/// Gets the FunctionID if it exists for a function in a `wasm_module` based on a function `name`
/// and `function_module`.
/// If the function does not exist, an empty optional will be returned.
fn get_import_fid(name : &String, function_module : &String, wasm_module : &Module) -> Result<Option<FunctionId>, anyhow::Error> {
    
    if let Some(imp_func) = wasm_module.imports.iter().find(|&i|{
        return &i.name == name && &i.module == function_module;
    }) {
        match imp_func.kind {
            walrus::ImportKind::Function(dest_fid) => {
                return Ok(Some(dest_fid)); 
            },
            _ => {
                return Err(anyhow!("Import kind mismatch"));
            }

        }
        
    } else {
        Ok(None)
    }
}

/// This is a recursive function that ensures that all call instructions refer 
/// to valid functions in the `dest` module.
/// 
/// If a call instruction refers to an import in the `source` module, the `dest`
/// module will contain the same import. If a call instruction refers to a local
/// function in the `source` module, the `dest` module will contain the same 
/// local function.
fn add_missing_calls(instrs : &mut Vec<Instr>, source : &mut Module, dest : &mut Module ) -> Result<(), anyhow::Error> {
    
    validate_instructions(instrs)?;

    // Check for calls within these instructions
    // If there are call instructions, they must reference either imported or local functions.
    for i in instrs {
        match i {
            Instr::Call(call) => {           
                let called_fid = call.func;
                
                if let Some(import) = source.imports.get_imported_func(called_fid) {
                    // Call is to an imported function
                    
                    let import_ty = &source.funcs.get(called_fid).ty();
                    if let Some(import_fid) = get_import_fid(&import.name, &import.module, &dest)? {
                        // The same import already exists in dest. Update the called fid.
                        if !same_signature(&dest.funcs.get(import_fid).ty(), dest, import_ty, source) {
                            return Err(anyhow!("Type mismatch between imports"));
                        }
                        call.func = import_fid;
                        
                    } else {
                        // The import needs to be added to the dest. Update the called fid.
                        call.func = dest.add_import_func(&import.module, &import.name, import_ty.clone()).0;
                    }                    
                    
                } else {
                    // Call is to a local function

                    // Build the new local function declaration
                    let local_function = source.funcs.get(called_fid);
                    let local_func_type = source.types.get(local_function.ty());
                    let mut builder = FunctionBuilder::new(&mut dest.types, local_func_type.params(), local_func_type.results());

                    // Get the instructions from the `source` module, and update the instructions to 
                    // ensure they are valid
                    let mut called_instrs = get_instructions(called_fid, source)?;
                    add_missing_calls(&mut called_instrs, source, dest)?;
                    
                    // Copy the (valid) instructions into the new function
                    for called_instr in called_instrs {
                        builder.func_body().instr(called_instr);
                    }

                    // Save the function into `funcs` section of the `dest` module.
                    dest.funcs.add_local(builder.local_func(Vec::new()));
                }
            }
            _ =>
             { /* No-op when the instruction is anything other than a call */ }
        }
    }    

    Ok(())
}


/// Replaces the imported function `dest_fid` in the `dest` module with a new (and valid) 
/// local function.
/// 
/// The instructions in the new local function are copied from the `source_fid` function 
/// in the `source` module. 
fn fill(source_fid : FunctionId, source : &mut Module, dest_fid : FunctionId, dest : &mut Module) -> Result<(), anyhow::Error>
{
    let mut instrs = get_instructions(source_fid, source)?;

    add_missing_calls(&mut instrs, source, dest)?;

    dest.replace_imported_func(dest_fid, |(body, _)| {
        for instr in instrs {
            body.instr(instr);
        }
    })?;
    
    Ok(())
}

/// Link polyfill module (source) to code module (dest) and strip out unused functions
pub fn link(dest: &[u8], source: &[u8]) -> Result<Vec<u8>, anyhow::Error> {
    
    let mut source_module = Module::from_buffer(source)?;
    let mut dest_module = Module::from_buffer(dest)?;
        
    validate_polyfill(&source_module)?;
    validate_fill_target(&dest_module)?;
    
    if should_polyfill(&dest_module) {
        if let Some(targets) = get_polyfill_targets(&source_module, &dest_module)? 
        {
            for target in targets {
                fill(target.source_fid, &mut source_module, target.dest_fid, &mut dest_module)?;
            }
        }
    }

    walrus::passes::gc::run(&mut dest_module);

    Ok(dest_module.emit_wasm())


    // // Remove all custom sections; psibase doesn't need them
    // // and this is easier than translating them.
    // //
    // // TODO: need an option to to support debugging.
    // //       * Don't trim out or reorder functions, since
    // //         editing DWARF is a PITA
    // //       * Leave custom sections as-is
    // //       * Might also need to skip binaryen
    // let sections = module.sections_mut();
    // *sections = sections
    //     .drain(..)
    //     .filter(|s| !matches!(s, Section::Custom(_)))
    //     .collect();
}

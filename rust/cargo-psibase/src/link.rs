use anyhow::anyhow;
use walrus::{FunctionId, Module, InstrSeqBuilder, LocalFunction, FunctionKind};
use walrus::FunctionKind::{Import, Local, Uninitialized};
use walrus::ir::{Instr, InstrSeqId};

// Helper traits
trait TypeFromFid {
    fn func_type(&self, id: FunctionId) -> &walrus::Type;
}

impl TypeFromFid for walrus::Module {
    fn func_type(&self, id : FunctionId) -> &walrus::Type {
        &self.types.get(self.funcs.get(id).ty())
    }
}

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
/// * A start function
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

/// Maps imported function IDs in a destination module to their corresponding exported 
/// function IDs from a source module
struct PolyfillTarget {
    source_fid : FunctionId,
    dest_fid : FunctionId,
}

/// Returns a list of `PolyfillTarget` objects.
/// 
/// Only functions that are actually imported in the `dest` module will be considered
/// for polyfilling.
fn get_polyfill_targets(source: &walrus::Module, dest: &walrus::Module) -> Result<Option<Vec<PolyfillTarget>>, anyhow::Error> {

    let mut error : Option<anyhow::Error> = None;
    let targets : Vec<PolyfillTarget> = dest.imports.iter().filter_map(|import| {
        let name = &import.name;

        // Only consider imported functions
        let dest_func = match import.kind {
            walrus::ImportKind::Function(import_fid) => dest.funcs.get(import_fid),
            _ => return None,
        };

        // Check if there's a corresponding export in the `source` module
        let source_func = match source.exports.get_func(name) {
            // This match guard ensures the export function has a local definition
            Ok(exp_fid) if matches!(source.funcs.get(exp_fid).kind, walrus::FunctionKind::Local(_)) => source.funcs.get(exp_fid),
            _ => return None,
        };

        // Check function types match
        if source.func_type(source_func.id()) != dest.func_type(dest_func.id()) {
            error = Some(anyhow!("Destination import {} matches source export by name but not by type.", name));
        }

        Some(PolyfillTarget{
            source_fid: source_func.id(),
            dest_fid: dest_func.id(),
        })
    }).collect();

    if error.is_some() {
        return Err(error.unwrap());
    }

    return Ok(Some(targets));
}

/// Gets the FunctionID if it exists for a function in a `wasm_module` based on a 
/// `function_module` and `name`.
fn get_import_fid(function_module : &str, name : &str, wasm_module : &Module) -> Result<Option<FunctionId>, anyhow::Error> {
    wasm_module
        .imports
        .iter()
        .find(|&i| &i.name == name && &i.module == function_module)
        .map_or(Ok(None), |i| match i.kind {
            walrus::ImportKind::Function(fid) => Ok(Some(fid)),
            _ => Err(anyhow!("Import kind mismatch")),
        })
}

/// Get the corresponding FunctionID in the `dest` module for a given FunctionID from the `source`
/// module. If the function does not exist in the `dest` module, it will be added.
fn get_dest_fid(source_fid : FunctionId, source : &Module, dest : &mut Module ) -> Result<FunctionId, anyhow::Error> {

    let f = source.funcs.get(source_fid);
    let (source_func_kind, source_func_ty) = (&f.kind, f.ty());

    let new_fid = match &source_func_kind {
        Import(_) => {
            let s = source.imports.get_imported_func(source_fid).unwrap();
            let (module, name) = (&s.module, &s.name);

            let dest_fid_opt = get_import_fid(module, name, &dest)?;

            if let Some(dest_fid) = dest_fid_opt {
                if dest.func_type(dest_fid) != source.func_type(source_fid) {
                    return Err(anyhow!("Type mismatch between imports"));
                }
                dest_fid
            } else {
                // The import needs to be added to the dest. Update the called fid.
                dest.add_import_func(module, name, source_func_ty.clone()).0
            }
        },
        Local(_) => {
            let new_local_func = copy_func(source_fid, source, dest)?;
            dest.funcs.add_local(new_local_func)
        },
        Uninitialized(_) => {
            return Err(anyhow!("Error: Source function uninitialized."));
        },
    };
    Ok(new_fid)
}



/// Copies one instruction sequence from a function in a `source` module to a sequence 
/// in a `dest` module.
fn copy_instr_block(source_block_id : InstrSeqId, source_function : &LocalFunction, source : &Module, dest_seq : &mut InstrSeqBuilder, dest : &mut Module) -> Result<(), anyhow::Error> {

    // Get the instructions from the specified source block
    let instrs = source_function.block(source_block_id).instrs.iter().map(|(instr, _)|{instr});

    // Map each source instruction to an instruction injected into the new target sequence
    for instr in instrs {

        match instr {
            Instr::RefFunc(ref_func_ins ) => {
                let mut i = ref_func_ins.clone();
                i.func = get_dest_fid(i.func, source, dest)?;
                dest_seq.instr(i);
            }
            Instr::Call(call_ins) => {
                let mut i = call_ins.clone();
                i.func = get_dest_fid(i.func, source, dest)?;
                dest_seq.instr(i);
            }
            
            Instr::Block(block_ins) => {
                let mut i = block_ins.clone();
                let mut new_dest_sequence = dest_seq.dangling_instr_seq(None);
                copy_instr_block(i.seq, source_function, source, &mut new_dest_sequence, dest)?;
                i.seq = new_dest_sequence.id();
                dest_seq.instr(i);
            }
            Instr::Loop(loop_ins) => {
                let mut i = loop_ins.clone();
                let mut new_dest_sequence = dest_seq.dangling_instr_seq(None);
                copy_instr_block( i.seq, source_function, source, &mut new_dest_sequence, dest)?;
                i.seq = new_dest_sequence.id();
                dest_seq.instr(i);
            }
            Instr::IfElse(if_else_ins) => {
                let mut i = if_else_ins.clone();
                let mut new_dest_seq_1 = dest_seq.dangling_instr_seq(None);
                copy_instr_block(i.consequent, source_function, source, &mut new_dest_seq_1, dest)?;
                i.consequent = new_dest_seq_1.id();

                let mut new_dest_seq_2 = dest_seq.dangling_instr_seq(None);
                copy_instr_block(i.alternative, source_function, source, &mut new_dest_seq_2, dest)?;
                i.alternative = new_dest_seq_2.id();
                
                dest_seq.instr(i);
            }

            // Invalid instructions
            Instr::CallIndirect(_) => {
                return Err(anyhow!("Error: Polyfill module has invalid instruction: Indirect call"));
            }
            Instr::GlobalGet(_) => {
                return Err(anyhow!("Error: Polyfill module has invalid instruction: Get global"));
            }
            Instr::GlobalSet(_) => {
                return Err(anyhow!("Error: Polyfill module has invalid instruction: Set global"));
            }

            // List every other option, to enforce that new instructions are properly handled
            Instr::LocalGet(i)           => {dest_seq.instr(i.clone());}
            Instr::LocalSet(i)           => {dest_seq.instr(i.clone());}
            Instr::LocalTee(i)           => {dest_seq.instr(i.clone());}
            Instr::Const(i)                 => {dest_seq.instr(i.clone());}
            Instr::Binop(i)                 => {dest_seq.instr(i.clone());}
            Instr::Unop(i)                   => {dest_seq.instr(i.clone());}
            Instr::Select(i)               => {dest_seq.instr(i.clone());}
            Instr::Unreachable(i)     => {dest_seq.instr(i.clone());}
            Instr::Br(i)                       => {dest_seq.instr(i.clone());}
            Instr::BrIf(i)                   => {dest_seq.instr(i.clone());}
            Instr::BrTable(i)             => {dest_seq.instr(i.clone());}
            Instr::Drop(i)                   => {dest_seq.instr(i.clone());}
            Instr::Return(i)               => {dest_seq.instr(i.clone());}
            Instr::MemorySize(i)       => {dest_seq.instr(i.clone());}
            Instr::MemoryGrow(i)       => {dest_seq.instr(i.clone());}
            Instr::MemoryInit(i)       => {dest_seq.instr(i.clone());}
            Instr::DataDrop(i)           => {dest_seq.instr(i.clone());}
            Instr::MemoryCopy(i)       => {dest_seq.instr(i.clone());}
            Instr::MemoryFill(i)       => {dest_seq.instr(i.clone());}
            Instr::Load(i)                   => {dest_seq.instr(i.clone());}
            Instr::Store(i)                 => {dest_seq.instr(i.clone());}
            Instr::AtomicRmw(i)         => {dest_seq.instr(i.clone());}
            Instr::Cmpxchg(i)             => {dest_seq.instr(i.clone());}
            Instr::AtomicNotify(i)   => {dest_seq.instr(i.clone());}
            Instr::AtomicWait(i)       => {dest_seq.instr(i.clone());}
            Instr::AtomicFence(i)     => {dest_seq.instr(i.clone());}
            Instr::TableGet(i)           => {dest_seq.instr(i.clone());}
            Instr::TableSet(i)           => {dest_seq.instr(i.clone());}
            Instr::TableGrow(i)         => {dest_seq.instr(i.clone());}
            Instr::TableSize(i)         => {dest_seq.instr(i.clone());}
            Instr::TableFill(i)         => {dest_seq.instr(i.clone());}
            Instr::RefNull(i)             => {dest_seq.instr(i.clone());}
            Instr::RefIsNull(i)         => {dest_seq.instr(i.clone());}
            Instr::V128Bitselect(i) => {dest_seq.instr(i.clone());}
            Instr::I8x16Swizzle(i)   => {dest_seq.instr(i.clone());}
            Instr::I8x16Shuffle(i)   => {dest_seq.instr(i.clone());}
            Instr::LoadSimd(i)           => {dest_seq.instr(i.clone());}
            Instr::TableInit(i)         => {dest_seq.instr(i.clone());}
            Instr::ElemDrop(i)           => {dest_seq.instr(i.clone());}
            Instr::TableCopy(i)         => {dest_seq.instr(i.clone());}
        }
    }

    Ok(())
}


/// Copy all instructions from a function in a `source` module to a new function 
/// in a `dest` module.
fn copy_func(source_fid : FunctionId, source : &Module, dest : &mut Module) -> Result<LocalFunction, anyhow::Error>
{
    // Get source local function
    let source_func = source.funcs.get(source_fid);
    let source_local_func = match &source_func.kind {
        walrus::FunctionKind::Local(loc) => loc,
        _ => return Err(anyhow!("Requested local function not found"))
    };

    // Build the new local function with the correct signature
    let tid = source_local_func.ty();
    let ty = source.types.get(tid);
    let (params, results) = (ty.params().to_vec(), ty.results().to_vec());
    let mut builder = walrus::FunctionBuilder::new(&mut dest.types, &params, &results);

    // Copy the first sequence of instructions in a function from a `source` module into the 
    let instr_seq_id = source_local_func.entry_block();
    let dest_instr_builder = &mut builder.func_body();
    copy_instr_block(instr_seq_id, &source_local_func, source, dest_instr_builder, dest)?;

    // Make the new local function
    let args = params
        .iter()
        .map(|val_type| dest.locals.add(*val_type))
        .collect::<Vec<_>>();
    
    Ok(builder.local_func(args))
}

/// Produce a module that links exported functions in the `source` module to 
/// their corresponding imported functions in a `dest` module.
/// 
/// This also strips out unused functions from the final module.
pub fn link(source: &[u8], dest: &[u8]) -> Result<Vec<u8>, anyhow::Error> {
    let source_module = Module::from_buffer(source)?;
    let mut dest_module = Module::from_buffer(dest)?;

    validate_polyfill(&source_module)?;
    validate_fill_target(&dest_module)?;

    if should_polyfill(&dest_module) {
        if let Some(targets) = get_polyfill_targets(&source_module, &dest_module)? 
        {
            for target in targets {
                let PolyfillTarget {source_fid, dest_fid} = target;

                // Get import ID
                let import_id = dest_module.imports.get_imported_func(dest_fid).map(|i| i.id()).unwrap();
                
                // Copy the function into a new local function in the `dest_module`
                let new_func = copy_func(source_fid, &source_module, &mut dest_module)?;

                // Replace the old imported function with the new local function and delete the old import.
                let dest_func = dest_module.funcs.get_mut(dest_fid);
                dest_func.kind = FunctionKind::Local(new_func);
                dest_module.imports.delete(import_id);
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

Meeting summary

1. Positional arguments sent to the supervisor vs named arguments.
   Decision - Parsing of Wit file is going to required for auto-generation of importables functions to the WASM, therefore, we may as well add named arguments.
   Rust - fn (arg1: string, arg2: string)
   JS - ({ arg1: 'John', arg2: 'Sparky' })

2. Dynamic imports
   The ability for the Rust (WASM Compoennt environment) to import a plugin function from another

WIT Parsing, so that the loader can determine the external depencies to then offer to the WASM component,
should any of these functions be called, it should then pass that request onto the supervisor using it's parent window.postmessage relationship.

The origin needs to be locked down on the penpal relationship.

Figure out the WIT parsing, dynamic imports. + Get Caller.

Someone else, create the psibase-wasm package and bring me the WIT imports..?

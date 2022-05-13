# Native Functions

Native functions give contracts the ability to print debugging messages, abort transactions on errors, access databases and event logs, and synchronously call other contracts. There aren't many native functions since contracts implement most Psibase functionality.

- [Types For Native Functions](#types-for-native-functions)
- [Wrapped Native Functions](#wrapped-native-functions)
- [Raw Native Functions](#raw-native-functions)

## Types For Native Functions

- [psibase::Action]
- [psibase::DbId]

{{#cpp-doc ::psibase::Action}}
{{#cpp-doc ::psibase::DbId}}

## Wrapped Native Functions

These functions wrap the [Raw Native Functions](#raw-native-functions).

- [psibase::abortMessage]
- [psibase::call]
- [psibase::check]
- [psibase::getCurrentAction]
- [psibase::getCurrentActionView]
- [psibase::getKey]
- [psibase::getResult]
- [psibase::kvGet]
- [psibase::kvGetOrDefault]
- [psibase::kvGetRaw]
- [psibase::kvGetSequential]
- [psibase::kvGetSequentialRaw]
- [psibase::kvGetSize]
- [psibase::kvGetSizeRaw]
- [psibase::kvGreaterEqual]
- [psibase::kvGreaterEqualRaw]
- [psibase::kvLessThan]
- [psibase::kvLessThanRaw]
- [psibase::kvMax]
- [psibase::kvMaxRaw]
- [psibase::kvPut]
- [psibase::kvPutRaw]
- [psibase::kvPutSequential]
- [psibase::kvPutSequentialRaw]
- [psibase::kvRemove]
- [psibase::kvRemoveRaw]
- [psibase::setRetval]
- [psibase::setRetvalBytes]
- [psibase::writeConsole]

{{#cpp-doc ::psibase::abortMessage}}
{{#cpp-doc ::psibase::call}}
{{#cpp-doc ::psibase::check}}
{{#cpp-doc ::psibase::getCurrentAction}}
{{#cpp-doc ::psibase::getCurrentActionView}}
{{#cpp-doc ::psibase::getKey}}
{{#cpp-doc ::psibase::getResult}}
{{#cpp-doc ::psibase::kvGet}}
{{#cpp-doc ::psibase::kvGetOrDefault}}
{{#cpp-doc ::psibase::kvGetRaw}}
{{#cpp-doc ::psibase::kvGetSequential}}
{{#cpp-doc ::psibase::kvGetSequentialRaw}}
{{#cpp-doc ::psibase::kvGetSize}}
{{#cpp-doc ::psibase::kvGetSizeRaw}}
{{#cpp-doc ::psibase::kvGreaterEqual}}
{{#cpp-doc ::psibase::kvGreaterEqualRaw}}
{{#cpp-doc ::psibase::kvLessThan}}
{{#cpp-doc ::psibase::kvLessThanRaw}}
{{#cpp-doc ::psibase::kvMax}}
{{#cpp-doc ::psibase::kvMaxRaw}}
{{#cpp-doc ::psibase::kvPut}}
{{#cpp-doc ::psibase::kvPutRaw}}
{{#cpp-doc ::psibase::kvPutSequential}}
{{#cpp-doc ::psibase::kvPutSequentialRaw}}
{{#cpp-doc ::psibase::kvRemove}}
{{#cpp-doc ::psibase::kvRemoveRaw}}
{{#cpp-doc ::psibase::setRetval}}
{{#cpp-doc ::psibase::setRetvalBytes}}
{{#cpp-doc ::psibase::writeConsole}}

## Raw Native Functions

This is the set of raw native functions (wasm imports). They are available for contracts to use directly, but we recommend using the [Wrapped Native Functions](#wrapped-native-functions) instead.

- [psibase::raw::abortMessage]
- [psibase::raw::call]
- [psibase::raw::getCurrentAction]
- [psibase::raw::getKey]
- [psibase::raw::getResult]
- [psibase::raw::kvGet]
- [psibase::raw::kvGetSequential]
- [psibase::raw::kvGreaterEqual]
- [psibase::raw::kvLessThan]
- [psibase::raw::kvMax]
- [psibase::raw::kvPut]
- [psibase::raw::kvPutSequential]
- [psibase::raw::kvRemove]
- [psibase::raw::setRetval]
- [psibase::raw::writeConsole]

{{#cpp-doc ::psibase::raw::abortMessage}}
{{#cpp-doc ::psibase::raw::call}}
{{#cpp-doc ::psibase::raw::getCurrentAction}}
{{#cpp-doc ::psibase::raw::getKey}}
{{#cpp-doc ::psibase::raw::getResult}}
{{#cpp-doc ::psibase::raw::kvGet}}
{{#cpp-doc ::psibase::raw::kvGetSequential}}
{{#cpp-doc ::psibase::raw::kvGreaterEqual}}
{{#cpp-doc ::psibase::raw::kvLessThan}}
{{#cpp-doc ::psibase::raw::kvMax}}
{{#cpp-doc ::psibase::raw::kvPut}}
{{#cpp-doc ::psibase::raw::kvPutSequential}}
{{#cpp-doc ::psibase::raw::kvRemove}}
{{#cpp-doc ::psibase::raw::setRetval}}
{{#cpp-doc ::psibase::raw::writeConsole}}

# Native Functions

Native functions give contracts the ability to print debugging messages, abort transactions on errors, access databases and event logs, and synchronously call other contracts. There are very few native functions since contracts implement most Psibase functionality.

## Raw Native Functions

This is the set of raw native functions. They are fully documented and available for contracts to use directly, but we recommend using the [Wrapped Native Functions](#wrapped-native-functions) instead.

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

## Wrapped Native Functions

These functions wrap the [Raw Native Functions](#raw-native-functions).

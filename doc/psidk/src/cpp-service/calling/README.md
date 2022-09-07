# Calling Other Contracts

Contracts may synchronously call into other contracts, for example to transfer tokens, fetch database rows, or even to use common library facilities (this example).

# Arithmetic Contract

Let's start by breaking up our previous example into a header file (`.hpp`) and an implementation file (`.cpp`). This makes it easier for other contracts to call into it.

## `arithmetic.hpp`

```cpp
{{#include arithmetic.hpp}}
```

## `arithmetic.cpp`

```cpp
{{#include arithmetic.cpp}}
```

# Caller Contract

This contract calls into the arithmetic contract.

## `caller.hpp`

```cpp
{{#include caller.hpp}}
```

## `caller.cpp`

```cpp
{{#include caller.cpp}}
```

## CMakeLists.txt

[CMakeLists.txt](CMakeLists.txt) is almost the same as previous examples, but instead of building 1 contract, it builds 2.

## Building

This is the same as before.

```sh
mkdir build
cd build
cmake `psidk-cmake-args` ..
make -j $(nproc)
```

## Deploying the contract

Let's deploy both contracts.

```sh
psibase deploy -ip arithmetic arithmetic.wasm
psibase deploy -ip caller caller.wasm
```

## Trying the contract

If you're running a test chain locally, then the caller contract's user interface is at [http://caller.psibase.127.0.0.1.sslip.io:8080/](http://caller.psibase.127.0.0.1.sslip.io:8080/).

# What's Happening?

When a contract calls another, the system pauses its execution and runs that other contract. The system returns the result back to the original caller and resumes execution. This behavior is core to most of psibase's functionality. e.g. the [system_contract::TransactionSys] contract receives a transaction then calls a contract for each action within the transaction. These contracts may call more contracts, creating a tree of actions.

"Action" may refer to:

- One of the actions (requests) within a transaction
- A call from one contract to another
- A method on a contract

The system keeps each contract alive during the entire transaction. This allows some interesting capabilities:

- Contracts may call each other many times without repeating the WASM startup overhead.
- Contracts may call into each other recursively. Be careful; you need to either plan for this or disable it. TODO: make it easy for contracts to opt out of recursion.
- A contract method may store intermediate results in global variables then return. Future calls to that contract, within the same transaction, have access to those global variables. They're wiped at the end of the transaction.

# Unpack()?

The system transfers packed data between contracts. `unpack()` unpacks it.

# Who called me?

A contract may call its `getSender()` method to find out:

- Which contract called it, or
- Which account authorized it if it's a top-level action or a [system_contract::TransactionSys::runAs] request

```c++
void MyContract::doSomething()
{
   psibase::check(
       getSender() == expectedAccount,
       "you're not who I expected");
}
```

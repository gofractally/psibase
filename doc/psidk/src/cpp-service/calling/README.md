# Calling Other Services (C++)

Services may synchronously call into other services, for example to transfer tokens, fetch database rows, or even to use common library facilities (this example).

# Arithmetic Service

Let's start by breaking up our previous example into a header file (`.hpp`) and an implementation file (`.cpp`). This makes it easier for other services to call into it.

## `arithmetic.hpp`

```cpp
{{#include arithmetic.hpp}}
```

## `arithmetic.cpp`

```cpp
{{#include arithmetic.cpp}}
```

# Caller Service

This service calls into the arithmetic service.

## `caller.hpp`

```cpp
{{#include caller.hpp}}
```

## `caller.cpp`

```cpp
{{#include caller.cpp}}
```

## CMakeLists.txt

[CMakeLists.txt](CMakeLists.txt) is almost the same as previous examples, but instead of building 1 service, it builds 2.

## Building

This is the same as before.

```sh
mkdir build
cd build
cmake `psidk-cmake-args` ..
make -j $(nproc)
```

## Deploying the service

Let's deploy both services.

```sh
psibase deploy -ip arithmetic arithmetic.wasm
psibase deploy -ip caller caller.wasm
```

## Trying the service

If you're running a test chain locally, then the caller service's user interface is at [http://caller.psibase.127.0.0.1.sslip.io:8080/](http://caller.psibase.127.0.0.1.sslip.io:8080/).

# What's Happening?

When a service calls another, the system pauses its execution and runs that other service. The system returns the result back to the original caller and resumes execution. This behavior is core to most of psibase's functionality. e.g. the [SystemService::TransactionSys] service receives a transaction then calls a service for each action within the transaction. These services may call more services, creating a tree of actions.

"Action" may refer to:

- One of the actions (requests) within a transaction
- A call from one service to another
- A method on a service

The system keeps each service alive during the entire transaction. This allows some interesting capabilities:

- Services may call each other many times without repeating the WASM startup overhead.
- Services may call into each other recursively. Be careful; you need to either plan for this or disable it. TODO: make it easy for services to opt out of recursion.
- A service method may store intermediate results in global variables then return. Future calls to that service, within the same transaction, have access to those global variables. They're wiped at the end of the transaction.

# Who called me?

A service may call [psibase::getSender] to find out which service or user called it. A service also may use [psibase::getReceiver] to get the account that the service is running on.

```c++
void MyService::doSomething()
{
   psibase::check(
       psibase::getSender() == expectedAccount,
       "you're not who I expected");
}
```

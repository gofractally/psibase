# Psibase OS

Psibase OS is the name for the operating-system-like infrastructure that runs client-side as the parent context for every psibase app. This infrastructure is responsible for core capabilities of psibase apps, such as transaction packing and submission, executing smart-authorization, and more.

## Artifacts

Psibase OS is a collection of javascript/typescript libraries and wasms. The wasm modules are intended to execute client-side. Using wasm in the browser allows these libraries to be written in fast and safe systems languages like Rust with their own robust library support for cryptography and other desired capabilities. 

## The concept

Psibase OS is itself a psibase app, and it is served by every psibase node whenever any psibase app is requested. It then dynamically loads the specific app which was requested (according to the URL in the browser) within an iFrame object.

The app then communicates via the [`Window.PostMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) API to the parent window (Developers don't need to manually use the Window.PostMessage API, as libraries are provided to simplify these interactions).

PsibaseOS can then receive those messages and react to them, in some cases opening other psibase [app interfaces](../development/app-interfaces/README.md) in a hidden iFrame and sending them messages. This is known as Inter-App Communication (IAC). 

## Capabilities

Psibase OS facilitates:

* [Inter-app communication](../development/app-interfaces/README.md#inter-app-communication)
* Transaction packing
* Smart authorization (e.g. transaction signing)
* WebRTC connections with other peers
* Polling for [events](../development/services/events.md) emitted by services

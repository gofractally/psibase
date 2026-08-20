# C++ Web Services

## Registration

Services which wish to serve HTTP requests need to register using the [SystemService::HttpServer] service's [SystemService::HttpServer::registerServer] action. This is usually done by setting the `SERVER` option of `psibase_package` in `CMakeLists.txt` to add this action to the package installation process.

A service doesn't have to serve HTTP requests itself; it may delegate this to another service during registration.

## HTTP Interfaces

Services which serve HTTP implements this interface:

- [psibase::ServerInterface] (required)
  - [psibase::HttpRequest]
  - [psibase::HttpReply]

{{#cpp-doc ::psibase::ServerInterface}}
{{#cpp-doc ::psibase::HttpRequest}}
{{#cpp-doc ::psibase::HttpReply}}

## Helpers

These help implement basic functionality:

- [psibase::serveSimpleUI]
- [psibase::serveActionTemplates]
- [psibase::servePackAction]
- [psibase::serveGraphQL]
- [psibase::makeConnection]
  - [psibase::PageInfo]
  - [psibase::Edge]
  - [psibase::Connection]
- [psibase::EventQuery]

Here's a common pattern for using these functions:

```c++
std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest request)
{
   if (auto result = psibase::serveActionTemplates<ExampleService>(request))
      return result;

   if (auto result = psibase::servePackAction<ExampleService>(request))
      return result;

   if (request.method == "GET" && request.target == "/")
   {
      static const char helloWorld[] = "Hello World";
      return psibase::HttpReply{
            .contentType = "text/plain",
            .body        = {helloWorld, helloWorld + strlen(helloWorld)},
      };
   }

   return std::nullopt;
}
```

{{#cpp-doc ::psibase::serveSimpleUI}}
{{#cpp-doc ::psibase::serveActionTemplates}}
{{#cpp-doc ::psibase::servePackAction}}
{{#cpp-doc ::psibase::serveGraphQL}}
{{#cpp-doc ::psibase::makeConnection}}
{{#cpp-doc ::psibase::PageInfo}}
{{#cpp-doc ::psibase::Edge}}
{{#cpp-doc ::psibase::Connection}}
{{#cpp-doc ::psibase::EventQuery}}

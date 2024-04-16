#include <services/user/Events.hpp>

#include <services/system/HttpServer.hpp>

#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
using namespace SystemService;
using namespace UserService;
using namespace psio::schema_types;

std::vector<char> vec(std::string_view s)
{
   return std::vector(s.begin(), s.end());
}

TEST_CASE("events")
{
   DefaultTestChain chain;
   auto             events = chain.from(chain.addService<Events>("Events.wasm")).to<Events>();
   expect(chain.from(Events::service).to<HttpServer>().registerServer(Events::service).trace());

   ServiceSchema schema{
       .service = Events::service,
       .schema  = SchemaBuilder().insert<int>("i32").build(),
       .history = {{MethodNumber{"testevent"}, Object{.members = {{"i", Type{"i32"}}}}}}};
   expect(events.setSchema(schema).trace());
   expect(events.send(42).trace());
   expect(events.send(72).trace());
   expect(events.send(42).trace());
   expect(events.send(91).trace());

   auto response = chain.http({.host        = "events.psibase.io",
                               .rootHost    = "psibase.io",
                               .method      = "POST",
                               .target      = "/sql",
                               .contentType = "application/sql",
                               .body        = vec("SELECT i FROM myevents")});
   std::cout << std::string_view(response.body.data(), response.body.size()) << std::endl;
}

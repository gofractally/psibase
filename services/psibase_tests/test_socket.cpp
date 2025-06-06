#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>

using namespace psibase;

TEST_CASE("socket in auth")
{
   DefaultTestChain t;

   AccountNumber socket_auth{"s-socket-auth"};
   auto          test_service =
       t.addService(socket_auth, "SocketAuth.wasm", CodeRow::isSubjective | CodeRow::allowSocket);

   AccountNumber alice = t.addAccount("alice", socket_auth);

   Action act{
       .sender  = alice,
       .service = AccountNumber{"nop"},
       .method  = MethodNumber{"autoClose"},
       .rawData = {},
   };
   CHECK(TraceResult{t.pushTransaction(t.makeTransaction({act}))}.failed(
       "Sockets disabled during proof verification or first auth"));
}

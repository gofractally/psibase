#include <psibase/Rpc.hpp>
#include <psibase/WebSocket.hpp>

#include <catch2/catch_test_macros.hpp>

using namespace psibase;

TEST_CASE("WebSocket handshake - request")
{
   HttpRequest request{.host    = "psibase.io",
                       .method  = "GET",
                       .target  = "/",
                       .headers = {{"Upgrade", "websocket"},
                                   {"Connection", "upgrade"},
                                   {"Sec-WebSocket-Version", "13"},
                                   {"Sec-WebSocket-Key", "sQN6///XJAsC1PG65sSp6g=="}}};
   SECTION("basic")
   {
      CHECK(isWebSocketHandshake(request));
   }
   SECTION("simple extension")
   {
      request.headers.push_back({"Sec-WebSocket-Extensions", "foo"});
      CHECK(isWebSocketHandshake(request));
   }
   SECTION("comma separated extension")
   {
      request.headers.push_back({"Sec-WebSocket-Extensions", "foo, bar"});
      CHECK(isWebSocketHandshake(request));
   }
   SECTION("extension parameters")
   {
      request.headers.push_back({"Sec-WebSocket-Extensions", "foo;bar;baz=2"});
      CHECK(isWebSocketHandshake(request));
   }
   SECTION("extension parameters OWS")
   {
      request.headers.push_back({"Sec-WebSocket-Extensions", "foo ; bar ; baz = 2"});
      CHECK(isWebSocketHandshake(request));
   }
   SECTION("extension parameters quoted")
   {
      request.headers.push_back({"Sec-WebSocket-Extensions", "foo;baz=\"\\2\""});
      CHECK(isWebSocketHandshake(request));
   }
   SECTION("invalid extension")
   {
      request.headers.push_back({"Sec-WebSocket-Extensions", "/"});
      CHECK(!isWebSocketHandshake(request));
   }
   SECTION("invalid extension - multiple headers")
   {
      request.headers.push_back({"Sec-WebSocket-Extensions", "foo"});
      request.headers.push_back({"Sec-WebSocket-Extensions", "/"});
      CHECK(!isWebSocketHandshake(request));
   }
   SECTION("invalid extension quoted")
   {
      request.headers.push_back({"Sec-WebSocket-Extensions", "foo;bar=\"\\/\""});
      CHECK(!isWebSocketHandshake(request));
   }
   SECTION("invalid extension empty quoted")
   {
      request.headers.push_back({"Sec-WebSocket-Extensions", "foo;bar=\"\""});
      CHECK(!isWebSocketHandshake(request));
   }
   SECTION("invalid extension with comma")
   {
      request.headers.push_back({"Sec-WebSocket-Extensions", "foo;bar=\",\""});
      CHECK(!isWebSocketHandshake(request));
   }
   SECTION("subprotocol")
   {
      request.headers.push_back({"Sec-WebSocket-Protocol", "chat"});
      CHECK(isWebSocketHandshake(request));
   }
   SECTION("subprotocol comma separated")
   {
      request.headers.push_back({"Sec-WebSocket-Protocol", "chat, superchat"});
      CHECK(isWebSocketHandshake(request));
   }
   SECTION("subprotocol multiple")
   {
      request.headers.push_back({"Sec-WebSocket-Protocol", "chat"});
      request.headers.push_back({"Sec-WebSocket-Protocol", "superchat"});
      CHECK(isWebSocketHandshake(request));
   }
   SECTION("subprotocol invalid")
   {
      request.headers.push_back({"Sec-WebSocket-Protocol", "\"chat\""});
      CHECK(!isWebSocketHandshake(request));
   }
   SECTION("subprotocol invalid multiple")
   {
      request.headers.push_back({"Sec-WebSocket-Protocol", "chat"});
      request.headers.push_back({"Sec-WebSocket-Protocol", "\"superchat\""});
      CHECK(!isWebSocketHandshake(request));
   }
}

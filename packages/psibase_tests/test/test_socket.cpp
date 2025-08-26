#include <psibase/SocketInfo.hpp>

#include <catch2/catch_all.hpp>

using namespace psibase;

template <>
struct Catch::StringMaker<SocketEndpoint>
{
   static std::string convert(const SocketEndpoint& endpoint) { return to_string(endpoint); }
};

TEST_CASE("Test ipv4 endpoint")
{
   IPV4Endpoint localhost{{127, 0, 0, 1}, 8080};
   CHECK(to_string(localhost) == "127.0.0.1:8080");
   CHECK(isLoopback(localhost));
   CHECK(parseSocketEndpoint("127.0.0.1:8080") == SocketEndpoint{localhost});
}

TEST_CASE("Test ipv6 endpoint")
{
   IPV6Endpoint localhost{{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, 0}, 8080};
   auto         localhostStr = "[::1]:8080";
   CHECK(to_string(localhost) == localhostStr);
   CHECK(isLoopback(localhost));
   CHECK(parseSocketEndpoint(localhostStr) == SocketEndpoint{localhost});

   IPV6Endpoint unspecified{{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 0}, 8080};
   auto         unspecifiedStr = "[::]:8080";
   CHECK(to_string(unspecified) == unspecifiedStr);
   CHECK(!isLoopback(unspecified));
   CHECK(parseSocketEndpoint(unspecifiedStr) == SocketEndpoint{unspecified});

   IPV6Endpoint nozero{{{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}, 0}, 443};
   auto         nozeroStr = "[102:304:506:708:90a:b0c:d0e:f10]:443";
   CHECK(to_string(nozero) == nozeroStr);
   CHECK(!isLoopback(nozero));
   CHECK(parseSocketEndpoint(nozeroStr) == SocketEndpoint{nozero});

   IPV6Endpoint onezero{{{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 00, 00}, 0}, 443};
   auto         onezeroStr = "[102:304:506:708:90a:b0c:d0e:0]:443";
   CHECK(to_string(onezero) == onezeroStr);
   CHECK(!isLoopback(onezero));
   CHECK(parseSocketEndpoint(onezeroStr) == SocketEndpoint{onezero});

   IPV6Endpoint twozeroes{{{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 00, 00, 00, 00}, 0}, 443};
   auto         twozeroesStr = "[102:304:506:708:90a:b0c::]:443";
   CHECK(to_string(twozeroes) == twozeroesStr);
   CHECK(!isLoopback(twozeroes));
   CHECK(parseSocketEndpoint(twozeroesStr) == SocketEndpoint{twozeroes});

   IPV6Endpoint internalzeroes{{{1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 0, 0, 13, 14, 15, 16}, 0}, 443};
   auto         internalzeroesStr = "[102:304:506::d0e:f10]:443";
   CHECK(to_string(internalzeroes) == internalzeroesStr);
   CHECK(!isLoopback(internalzeroes));
   CHECK(parseSocketEndpoint(internalzeroesStr) == SocketEndpoint{internalzeroes});

   IPV6Endpoint zone{{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, 42}, 443};
   auto         zoneStr = "[::1%42]:443";
   CHECK(to_string(zone) == zoneStr);
   CHECK(isLoopback(zone));
   CHECK(parseSocketEndpoint(zoneStr) == SocketEndpoint{zone});

   IPV6Endpoint zoneUnspecified{{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 42}, 443};
   auto         zoneUnspecifiedStr = "[::%42]:443";
   CHECK(to_string(zoneUnspecified) == zoneUnspecifiedStr);
   CHECK(!isLoopback(zoneUnspecified));
   CHECK(parseSocketEndpoint(zoneUnspecifiedStr) == SocketEndpoint{zoneUnspecified});

   IPV6Endpoint mappedV4{{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 192, 168, 0, 1}, 0}, 80};
   auto         mappedV4Str = "[::ffff:192.168.0.1]:80";
   CHECK(to_string(mappedV4) == mappedV4Str);
   CHECK(!isLoopback(mappedV4));
   CHECK(parseSocketEndpoint(mappedV4Str) == SocketEndpoint{mappedV4});
}

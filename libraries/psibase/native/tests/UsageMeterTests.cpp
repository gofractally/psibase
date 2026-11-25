#include <psibase/UsageMeter.hpp>

#include <catch2/catch_test_macros.hpp>
#include <psio/key.hpp>

#include <atomic>
#include <map>
#include <thread>

#include "TempDirectory.hpp"

using namespace psibase;

namespace
{
   const psibase::storage::database_config dbConfig{1 << 27, 1 << 27, 1 << 27, 1 << 27};

   IPAddress ip(std::string_view text)
   {
      return parseIPAddress(text).value();
   }
   SocketEndpoint tcp(std::string_view address, std::uint16_t port = 4000)
   {
      auto addr = ip(address);
      if (auto v4 = std::get_if<IPV4Address>(&addr))
         return IPV4Endpoint{*v4, port};
      return IPV6Endpoint{std::get<IPV6Address>(addr), port};
   }
   UsageIdentity id(std::string_view text)
   {
      return parseUsageIdentity(text).value();
   }
   using Forwarded = std::vector<std::optional<IPAddress>>;

   // A meter with a clock the test moves.
   struct TestMeter
   {
      std::uint64_t now = 1'000'000;
      UsageMeter    meter;
      explicit TestMeter(UsageSettings settings = {}) : meter(std::move(settings))
      {
         meter.clock = [this] { return now; };
      }
   };

   // What a reader of the table sees: the rows written so far.
   struct Stored
   {
      std::map<UsageIdentity, UsageRow> rows;
      void apply(const UsageMeter::Changes& changes)
      {
         for (const auto& identity : changes.removed)
            rows.erase(identity);
         for (const auto& row : changes.rows)
            rows[row.identity()] = row;
      }
      UsageCounters total() const
      {
         UsageCounters result;
         for (const auto& [_, row] : rows)
            result += row.total;
         return result;
      }
      const UsageRow* find(std::string_view text) const
      {
         auto pos = rows.find(id(text));
         return pos == rows.end() ? nullptr : &pos->second;
      }
   };

   UsageCounters sum(const std::vector<UsageRow>& rows)
   {
      UsageCounters result;
      for (const auto& row : rows)
         result += row.total;
      return result;
   }
}  // namespace

TEST_CASE("usage identity: addresses")
{
   CHECK(to_string(UsageIdentity::address(ip("203.0.113.7"))) == "ip:203.0.113.7");
   // IPv6 is counted by /64
   CHECK(UsageIdentity::address(ip("2001:db8:1:2:3:4:5:6")) == UsageIdentity::address(ip("2001:db8:1:2::1")));
   CHECK(to_string(UsageIdentity::address(ip("2001:db8:1:2:3:4:5:6"))) == "ip:2001:db8:1:2::/64");
   CHECK(UsageIdentity::address(ip("2001:db8:1:3::1")) != UsageIdentity::address(ip("2001:db8:1:2::1")));
   // IPv4-mapped IPv6 is the IPv4 address
   CHECK(UsageIdentity::address(ip("::ffff:203.0.113.7")) == UsageIdentity::address(ip("203.0.113.7")));
   // The zone is dropped
   IPV6Address zoned = std::get<IPV6Address>(ip("fe80::1"));
   zoned.zone        = 7;
   CHECK(UsageIdentity::address(zoned) == UsageIdentity::address(ip("fe80::2")));
}

TEST_CASE("usage identity: text form is validated")
{
   for (std::string_view good :
        {"local:unix", "local:loopback", "local:node", "local:unknown", "ip:203.0.113.7",
         "ip:2001:db8:1:2::/64", "account:alice", "account:x-admin", "peer:203.0.113.9",
         "peer:loopback", "peer:unix", "overflow:ip", "expired:account"})
   {
      INFO(good);
      auto parsed = parseUsageIdentity(good);
      REQUIRE(parsed);
      CHECK(to_string(*parsed) == good);
   }
   std::string tooLong = "account:" + std::string(200, 'a');
   for (std::string_view bad :
        std::initializer_list<std::string_view>{"", "ip", "ip:", ":alice", "bogus:alice", "local:root", "ip:999.1.1.1",
         "ip:203.0.113.007", "ip:2001:db8:1:2::1", "ip:2001:db8:1:2:3::/64", "ip:2001:db8::/48",
         "ip:::ffff:1.2.3.4/64", "account:Alice", "account:alice bob", "account:", "guest:abc",
         "overflow:overflow", "overflow:nothing", "ip:203.0.113.7\n", tooLong})
   {
      INFO(bad);
      CHECK(!parseUsageIdentity(bad));
   }
   CHECK(!isValid(UsageIdentity{UsageKind::account, std::string("a\0b", 3)}));
}

TEST_CASE("usage identity: forwarding headers only from trusted proxies")
{
   std::vector<IPAddressPrefix> none;
   std::vector<IPAddressPrefix> proxies{parseIPAddressPrefix("10.0.0.0/8").value()};

   // No endpoint: nobody we can name
   CHECK(UsageIdentity::resolve(std::nullopt, {}, none) == id("local:unknown"));
   // Local transports without headers
   CHECK(UsageIdentity::resolve(LocalEndpoint{"/run/psinode.sock"}, {}, none) == id("local:unix"));
   CHECK(UsageIdentity::resolve(tcp("127.0.0.1"), {}, none) == id("local:loopback"));
   CHECK(UsageIdentity::resolve(tcp("::1"), {}, none) == id("local:loopback"));
   // A direct client
   CHECK(UsageIdentity::resolve(tcp("203.0.113.7"), {}, none) == id("ip:203.0.113.7"));

   // A direct client cannot name itself: its headers are ignored
   CHECK(UsageIdentity::resolve(tcp("203.0.113.7"), Forwarded{ip("198.51.100.1")}, none) ==
         id("ip:203.0.113.7"));
   CHECK(UsageIdentity::resolve(tcp("203.0.113.7"), Forwarded{ip("127.0.0.1")}, proxies) ==
         id("ip:203.0.113.7"));

   // Behind a local reverse proxy
   CHECK(UsageIdentity::resolve(tcp("127.0.0.1"), Forwarded{ip("198.51.100.1")}, none) ==
         id("ip:198.51.100.1"));
   CHECK(UsageIdentity::resolve(LocalEndpoint{"sock"}, Forwarded{ip("198.51.100.1")}, none) ==
         id("ip:198.51.100.1"));
   // The right-most address that is not itself a trusted proxy: what the
   // client wrote to the left of it is not believed.
   CHECK(UsageIdentity::resolve(tcp("127.0.0.1"), Forwarded{ip("1.1.1.1"), ip("198.51.100.1")}, none) ==
         id("ip:198.51.100.1"));
   CHECK(UsageIdentity::resolve(tcp("127.0.0.1"),
                        Forwarded{ip("1.1.1.1"), ip("198.51.100.1"), ip("10.1.2.3")}, proxies) ==
         id("ip:198.51.100.1"));
   // An unconfigured intermediate is the nearest party we cannot vouch for
   CHECK(UsageIdentity::resolve(tcp("127.0.0.1"),
                        Forwarded{ip("1.1.1.1"), ip("198.51.100.1"), ip("10.1.2.3")}, none) ==
         id("ip:10.1.2.3"));
   // A configured proxy that is not local
   CHECK(UsageIdentity::resolve(tcp("10.1.2.3"), Forwarded{ip("198.51.100.1")}, proxies) ==
         id("ip:198.51.100.1"));
   CHECK(UsageIdentity::resolve(tcp("10.1.2.3"), Forwarded{ip("198.51.100.1")}, none) ==
         id("ip:10.1.2.3"));
   // Every hop trusted: the transport peer
   CHECK(UsageIdentity::resolve(tcp("127.0.0.1"), Forwarded{ip("10.1.2.3"), ip("127.0.0.1")}, proxies) ==
         id("local:loopback"));
   CHECK(UsageIdentity::resolve(tcp("10.1.2.3"), Forwarded{ip("10.9.9.9")}, proxies) ==
         id("ip:10.1.2.3"));
   // An entry that is not an address ends the walk at the proxy
   CHECK(UsageIdentity::resolve(tcp("127.0.0.1"), Forwarded{ip("198.51.100.1"), std::nullopt}, none) ==
         id("local:loopback"));
   // IPv6 clients behind a proxy are counted by /64
   CHECK(UsageIdentity::resolve(tcp("127.0.0.1"), Forwarded{ip("2001:db8:1:2:3:4:5:6")}, none) ==
         id("ip:2001:db8:1:2::/64"));

   // Peer connections are named by the address of the connection
   CHECK(UsageIdentity::peer(tcp("203.0.113.9", 8080)) == id("peer:203.0.113.9"));
   CHECK(UsageIdentity::peer(tcp("127.0.0.1")) == id("peer:loopback"));
   CHECK(UsageIdentity::peer(SocketEndpoint{LocalEndpoint{"x"}}) == id("peer:unix"));
   CHECK(UsageIdentity::peer(std::nullopt) == id("peer:unknown"));
}

TEST_CASE("usage retention grows with use, between a floor and a cap")
{
   UsageRetention r;
   UsageCounters  none;
   CHECK(r.seconds(none) == r.base);
   UsageCounters one;
   one.requests  = 1;
   one.requestNs = 2'500'000;  // 2 ms
   one.bytesIn   = 300;
   CHECK(usageUnits(one) == 3);
   CHECK(r.seconds(one) == r.base + 3 * r.perUnit);
   UsageCounters heavy = one;
   heavy.bytesOut      = 65536ull * 1000;
   heavy.trxPushed     = 50;
   heavy.trialNs       = 400'000'000;
   CHECK(usageUnits(heavy) == 3 + 1000 + 50 + 400);
   CHECK(r.seconds(heavy) > r.seconds(one));
   UsageCounters huge;
   huge.requests = ~std::uint64_t{0};
   huge.bytesIn  = ~std::uint64_t{0};
   CHECK(r.seconds(huge) == r.max);
}

TEST_CASE("usage meter: attribution")
{
   TestMeter t;
   auto      alice = t.meter.find(id("account:alice"));
   auto      addr  = t.meter.find(id("ip:203.0.113.7"));
   REQUIRE(alice);
   REQUIRE(addr);
   CHECK(alice != addr);
   CHECK(t.meter.find(id("account:alice")) == alice);
   CHECK(t.meter.find(id("account:alice"), alice) == alice);
   CHECK(t.meter.find(id("ip:203.0.113.7"), alice) == addr);
   // An identity that is not valid is not used as a key
   CHECK(t.meter.find(UsageIdentity{UsageKind::account, "Not A Name"})->identity ==
         id("local:unknown"));

   alice->add(UsageField::requests, 2);
   alice->add(UsageField::bytesIn, 100);
   alice->add(UsageField::requestNs, std::chrono::nanoseconds(5000));
   alice->add(UsageField::requestNs, std::chrono::nanoseconds(-1));  // ignored
   addr->add(UsageField::requests, 1);

   Stored stored;
   stored.apply(t.meter.collect());
   auto a = stored.find("account:alice");
   REQUIRE(a);
   CHECK(a->total.requests == 2);
   CHECK(a->total.bytesIn == 100);
   CHECK(a->total.requestNs == 5000);
   CHECK(a->current == a->total);
   CHECK(a->firstSeen == t.now);
   CHECK(a->lastSeen == t.now);
   CHECK(a->keepUntil == t.now + t.meter.settings().retention.seconds(a->total));
   REQUIRE(stored.find("ip:203.0.113.7"));
   CHECK(stored.find("ip:203.0.113.7")->total.requests == 1);

   // Nothing changed: nothing is written
   auto idle = t.meter.collect();
   CHECK(idle.rows.empty());
   CHECK(idle.removed.empty());

   // Off: no handles at all
   UsageSettings off;
   off.enabled = false;
   UsageMeter disabled{off};
   CHECK(!disabled.find(id("account:alice")));
   CHECK(!disabled.node());
   CHECK(!disabled.runOrigin(1));
   CHECK(disabled.collect().rows.empty());
}

TEST_CASE("usage meter: recent windows")
{
   UsageSettings settings;
   settings.windowSeconds = 100;
   TestMeter t{settings};
   t.now      = 1000;
   auto alice = t.meter.find(id("account:alice"));
   Stored stored;

   alice->add(UsageField::requests, 3);
   stored.apply(t.meter.collect());
   CHECK(stored.find("account:alice")->window == 10);
   CHECK(stored.find("account:alice")->current.requests == 3);
   CHECK(stored.find("account:alice")->previous.requests == 0);

   t.now = 1050;
   alice->add(UsageField::requests, 2);
   stored.apply(t.meter.collect());
   CHECK(stored.find("account:alice")->current.requests == 5);

   // The next window
   t.now = 1100;
   alice->add(UsageField::requests, 7);
   stored.apply(t.meter.collect());
   CHECK(stored.find("account:alice")->window == 11);
   CHECK(stored.find("account:alice")->current.requests == 7);
   CHECK(stored.find("account:alice")->previous.requests == 5);
   CHECK(stored.find("account:alice")->total.requests == 12);

   // Two windows later the earlier use is no longer recent
   t.now = 1300;
   alice->add(UsageField::requests, 1);
   stored.apply(t.meter.collect());
   CHECK(stored.find("account:alice")->window == 13);
   CHECK(stored.find("account:alice")->current.requests == 1);
   CHECK(stored.find("account:alice")->previous.requests == 0);
   CHECK(stored.find("account:alice")->total.requests == 13);
}

TEST_CASE("usage meter: small visitors are dropped first, heavier ones kept longer")
{
   UsageSettings settings;
   settings.retention = {.base = 100, .perUnit = 10, .max = 1000};
   TestMeter t{settings};
   Stored    stored;
   auto      charge = [&](std::string_view who, std::uint64_t requests)
   { t.meter.find(id(who))->add(UsageField::requests, requests); };
   charge("ip:203.0.113.1", 1);      // kept 110 s
   charge("ip:203.0.113.2", 20);     // kept 300 s
   charge("account:alice", 5000);    // kept 1000 s (the cap)
   stored.apply(t.meter.collect());
   UsageCounters all = stored.total();
   CHECK(all.requests == 5021);
   CHECK(stored.find("ip:203.0.113.1")->keepUntil == t.now + 110);
   CHECK(stored.find("ip:203.0.113.2")->keepUntil == t.now + 300);
   CHECK(stored.find("account:alice")->keepUntil == t.now + 1000);

   t.now += 109;
   stored.apply(t.meter.collect());
   CHECK(stored.find("ip:203.0.113.1"));
   t.now += 1;
   stored.apply(t.meter.collect());
   CHECK(!stored.find("ip:203.0.113.1"));
   CHECK(stored.find("ip:203.0.113.2"));
   // Its counts are in the kind's `expired` row: the totals are unchanged
   REQUIRE(stored.find("expired:ip"));
   CHECK(stored.find("expired:ip")->total.requests == 1);
   CHECK(stored.find("expired:ip")->keepUntil == 0);
   // ... as old use, not as recent use
   CHECK(isZero(stored.find("expired:ip")->current));
   CHECK(stored.total() == all);

   // Coming back resets the wait
   t.now += 150;
   charge("ip:203.0.113.2", 1);
   stored.apply(t.meter.collect());
   t.now += 250;
   stored.apply(t.meter.collect());
   CHECK(stored.find("ip:203.0.113.2"));
   CHECK(stored.find("ip:203.0.113.2")->total.requests == 21);
   t.now += 100;
   stored.apply(t.meter.collect());
   CHECK(!stored.find("ip:203.0.113.2"));
   CHECK(stored.find("expired:ip")->total.requests == 22);
   CHECK(stored.find("account:alice"));

   t.now += 1000;
   stored.apply(t.meter.collect());
   CHECK(!stored.find("account:alice"));
   CHECK(stored.find("expired:account")->total.requests == 5000);
   CHECK(stored.total().requests == 5022);

   // A dropped visitor who returns starts a new record
   charge("ip:203.0.113.1", 4);
   stored.apply(t.meter.collect());
   CHECK(stored.find("ip:203.0.113.1")->total.requests == 4);
   CHECK(stored.find("ip:203.0.113.1")->firstSeen == t.now);
   CHECK(stored.total().requests == 5026);
}

TEST_CASE("usage meter: the table is bounded and eviction keeps totals exact")
{
   UsageSettings settings;
   settings.maxRecords = 16;
   TestMeter t{settings};
   Stored    stored;
   std::uint64_t charged = 0;
   auto          charge  = [&](const UsageIdentity& who, std::uint64_t requests)
   {
      auto handle = t.meter.find(who);
      handle->add(UsageField::requests, requests);
      charged += requests;
      return handle;
   };
   auto address = [](unsigned n)
   { return UsageIdentity::address(IPV4Address{{198, 51, static_cast<std::uint8_t>(n >> 8),
                                         static_cast<std::uint8_t>(n)}}); };

   // A heavy consumer, then a flood of one-request addresses
   auto heavy = charge(id("ip:203.0.113.7"), 100'000);
   charge(id("account:alice"), 3);
   for (unsigned n = 0; n < 15; ++n)
      charge(address(n), 1);
   // The kind is full: a newcomer is counted in the overflow record
   auto over = charge(address(1000), 1);
   CHECK(over->identity == id("overflow:ip"));
   CHECK(t.meter.totals()[1].kind == UsageKind::ip);
   CHECK(t.meter.totals()[1].records == 16);
   // Other kinds are not affected by a full one
   CHECK(t.meter.find(id("account:bob"))->identity == id("account:bob"));

   stored.apply(t.meter.collect());
   CHECK(stored.total().requests == charged);
   // The flush made room: an eighth of the kind, the soonest to expire
   CHECK(t.meter.totals()[1].records == 14);
   CHECK(stored.find("ip:203.0.113.7"));
   CHECK(stored.find("overflow:ip")->total.requests == 3);
   CHECK(heavy == t.meter.find(id("ip:203.0.113.7"), heavy));

   // The flood continues for many flushes: never more than the bound, the
   // heavy consumer stays, and every request is still in the totals.
   for (unsigned round = 0; round < 50; ++round)
   {
      t.now += 10;
      for (unsigned n = 0; n < 40; ++n)
         charge(address(2000 + round * 40 + n), 1);
      charge(id("ip:203.0.113.7"), 10);
      stored.apply(t.meter.collect());
      std::size_t ips = 0;
      for (const auto& [identity, _] : stored.rows)
         ips += identity.kind == UsageKind::ip;
      CHECK(ips <= 16);
      CHECK(stored.total().requests == charged);
   }
   REQUIRE(stored.find("ip:203.0.113.7"));
   CHECK(stored.find("ip:203.0.113.7")->total.requests == 100'500);
   CHECK(stored.find("account:alice")->total.requests == 3);
   CHECK(sum(t.meter.rows()).requests == charged);
   std::uint64_t byKind = 0;
   for (const auto& kind : t.meter.totals())
      byKind += kind.total.requests;
   CHECK(byKind == charged);
}

TEST_CASE("usage meter: counts added to an evicted record are not lost")
{
   UsageSettings settings;
   settings.maxRecords = 8;
   TestMeter t{settings};
   Stored    stored;
   // A connection keeps its handle
   auto held = t.meter.find(id("ip:198.51.100.1"));
   held->add(UsageField::bytesIn, 10);
   stored.apply(t.meter.collect());
   t.now += 5;
   for (unsigned n = 2; n < 10; ++n)
      t.meter.find(UsageIdentity::address(IPV4Address{{198, 51, 100, static_cast<std::uint8_t>(n)}}))
          ->add(UsageField::bytesIn, 1000);
   stored.apply(t.meter.collect());
   REQUIRE(held->detached());
   CHECK(!stored.find("ip:198.51.100.1"));
   CHECK(stored.total().bytesIn == 10 + 7 * 1000 + 1000);

   held->add(UsageField::bytesIn, 5);
   CHECK(sum(t.meter.rows()).bytesIn == 8015);
   stored.apply(t.meter.collect());
   CHECK(stored.total().bytesIn == 8015);
   // Whoever can look the identity up again gets a live record
   auto again = t.meter.find(id("ip:198.51.100.1"), held);
   CHECK(again != held);
   held->add(UsageField::bytesIn, 1);
   held.reset();
   stored.apply(t.meter.collect());
   stored.apply(t.meter.collect());
   CHECK(stored.total().bytesIn == 8016);
}

TEST_CASE("usage meter: run origins")
{
   TestMeter t;
   auto      alice = t.meter.find(id("account:alice"));
   t.meter.setRunOrigin(7, alice);
   CHECK(t.meter.runOrigin(7) == alice);
   CHECK(t.meter.runOrigin(7) == alice);  // a run may execute more than once
   // A run nobody remembers (posted before a restart)
   CHECK(t.meter.runOrigin(8)->identity == id("local:unknown"));
   t.meter.clearRunOrigin(7);
   CHECK(t.meter.runOrigin(7)->identity == id("local:unknown"));
   CHECK(t.meter.node()->identity == id("local:node"));
}

TEST_CASE("usage meter: concurrent charges")
{
   TestMeter                t;
   std::vector<std::thread> threads;
   std::atomic<bool>        done{false};
   for (unsigned n = 0; n < 4; ++n)
      threads.emplace_back(
          [&, n]
          {
             for (unsigned i = 0; i < 20000; ++i)
             {
                auto who = UsageIdentity::address(IPV4Address{{10, 0, 0, static_cast<std::uint8_t>(i % 8)}});
                t.meter.find(who)->add(UsageField::requests, 1);
                t.meter.find(id("account:alice"))->add(UsageField::bytesOut, n + 1);
             }
          });
   Stored      stored;
   std::thread flusher{[&]
                       {
                          while (!done)
                             stored.apply(t.meter.collect());
                       }};
   for (auto& thread : threads)
      thread.join();
   done = true;
   flusher.join();
   stored.apply(t.meter.collect());
   CHECK(stored.total().requests == 80000);
   CHECK(stored.total().bytesOut == 20000 * (1 + 2 + 3 + 4));
}

TEST_CASE("usage meter: flush, restart, reload")
{
   TempDirectory dir;
   auto          path = dir.path / "db";
   UsageSettings settings;
   settings.retention = {.base = 100, .perUnit = 10, .max = 1000};
   settings.trustedProxies.push_back(parseIPAddressPrefix("10.0.0.0/8").value());
   UsageCounters before;
   std::uint64_t now = 5000;
   {
      SharedDatabase shared(path, dbConfig, psibase::storage::open_mode::create_new);
      auto           writer = shared.createWriter();
      UsageMeter     meter{settings};
      meter.clock = [&] { return now; };
      meter.load(shared, *writer);
      meter.publishSettings(shared, *writer);
      auto config = shared.kvGetSubjective(*writer, UsageConfigRow::db,
                                           psio::to_key(usageConfigKey()));
      REQUIRE(config);
      auto configRow = psio::from_pssz<UsageConfigRow>(*config);
      CHECK(configRow.retentionBase == 100);
      CHECK(configRow.trustedProxies == std::vector<std::string>{"10.0.0.0/8"});

      meter.find(id("account:alice"))->add(UsageField::requests, 5);
      meter.find(id("account:alice"))->add(UsageField::trialNs, 123456789);
      meter.find(id("ip:203.0.113.7"))->add(UsageField::bytesIn, 77);
      meter.find(id("ip:203.0.113.8"))->add(UsageField::requests, 1);
      for (unsigned n = 0; n < 300; ++n)  // more than one write batch
         meter.find(UsageIdentity::address(IPV4Address{{10, 1, static_cast<std::uint8_t>(n >> 8),
                                                static_cast<std::uint8_t>(n)}}))
             ->add(UsageField::requests, 1);
      meter.flush(shared, *writer);
      now += 115;  // the one-request visitors expire (110 s); alice does not
      meter.find(id("account:alice"))->add(UsageField::requests, 1);
      meter.flush(shared, *writer);
      before = sum(meter.rows());
      CHECK(before.requests == 307);

      // The stored row is what a reader gets
      auto stored = shared.kvGetSubjective(*writer, UsageRow::db,
                                           psio::to_key(usageKey(id("account:alice"))));
      REQUIRE(stored);
      auto row = psio::from_pssz<UsageRow>(*stored);
      CHECK(row.identity() == id("account:alice"));
      CHECK(row.total.requests == 6);
      CHECK(row.total.trialNs == 123456789);
      CHECK(!shared.kvGetSubjective(*writer, UsageRow::db,
                                    psio::to_key(usageKey(id("ip:203.0.113.8")))));
      // Something counted and never flushed is lost with the process: at
      // most one flush interval.
      meter.find(id("account:alice"))->add(UsageField::requests, 1000);
   }
   {
      SharedDatabase shared(path, dbConfig, psibase::storage::open_mode::read_write);
      auto           writer = shared.createWriter();
      UsageMeter     meter{settings};
      meter.clock = [&] { return now; };
      meter.load(shared, *writer);
      CHECK(sum(meter.rows()) == before);
      std::map<UsageIdentity, UsageRow> rows;
      for (const auto& row : meter.rows())
         rows[row.identity()] = row;
      CHECK(rows.size() == 2);  // alice and expired:ip
      REQUIRE(rows.contains(id("account:alice")));
      CHECK(rows[id("account:alice")].total.requests == 6);
      CHECK(rows[id("account:alice")].firstSeen == 5000);
      CHECK(rows[id("account:alice")].lastSeen == 5115);
      CHECK(rows[id("expired:ip")].total.requests == 301);
      CHECK(rows[id("expired:ip")].total.bytesIn == 77);

      // Counting continues on the loaded record, and nothing is rewritten
      // until something changes.
      CHECK(meter.collect().rows.empty());
      meter.find(id("account:alice"))->add(UsageField::requests, 4);
      meter.flush(shared, *writer);
      auto stored = shared.kvGetSubjective(*writer, UsageRow::db,
                                           psio::to_key(usageKey(id("account:alice"))));
      CHECK(psio::from_pssz<UsageRow>(*stored).total.requests == 10);

      // A row that is not a valid record is removed at load, not trusted
      std::string junk = "junk";
      auto        key  = psio::to_key(usageKey(UsageIdentity{UsageKind::ip, "not-an-address"}));
      shared.kvPutSubjective(*writer, UsageRow::db, key, std::span<const char>{junk});
      UsageMeter again{settings};
      again.load(shared, *writer);
      CHECK(!shared.kvGetSubjective(*writer, UsageRow::db, key));
      CHECK(sum(again.rows()).requests == before.requests + 4);
   }
}

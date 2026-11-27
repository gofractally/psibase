// x-usage counts what each identity uses of the node, lets each read its
// own totals, and lets only an administrator read everybody's.
#include <services/local/XUsage.hpp>

#include <catch2/catch_test_macros.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/local/XAdmin.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/HttpServer.hpp>
#include <services/user/Nft.hpp>
#include "../../XSignup/test/Guest.hpp"

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

namespace
{
   struct Totals
   {
      std::string   identity;
      UsageKind     kind;
      std::uint64_t requests;
      std::uint64_t elapsed_us;
      std::uint64_t request_bytes;
      std::uint64_t response_bytes;
      std::int64_t  first_seen;
      std::int64_t  last_seen;
      PSIO_REFLECT(Totals,
                   identity,
                   kind,
                   requests,
                   elapsed_us,
                   request_bytes,
                   response_bytes,
                   first_seen,
                   last_seen)
   };
   struct AdminTotals
   {
      std::string                  identity;
      UsageKind                    kind;
      std::uint64_t                requests;
      std::uint64_t                elapsed_us;
      std::uint64_t                request_bytes;
      std::uint64_t                response_bytes;
      std::int64_t                 first_seen;
      std::int64_t                 last_seen;
      std::optional<AccountNumber> carried_to;
      PSIO_REFLECT(AdminTotals,
                   identity,
                   kind,
                   requests,
                   elapsed_us,
                   request_bytes,
                   response_bytes,
                   first_seen,
                   last_seen,
                   carried_to)
   };
   struct Page
   {
      std::vector<AdminTotals> rows;
      bool                     more;
      PSIO_REFLECT(Page, rows, more)
   };

   // A request body of a known size
   struct TextBody
   {
      std::string       text;
      std::string       contentType() const { return "application/graphql"; }
      std::vector<char> body() const { return {text.begin(), text.end()}; }
   };

   // A request to a chain service as whoever holds `token`. What it asks
   // does not matter; that it is handled by the chain's HTTP service does.
   HttpReply ask(DefaultTestChain& t, const std::string& token, const std::string& query)
   {
      return t.http(AuthSig::AuthSig::service)
          .auth_bearer(token)
          .post<HttpReply>("/graphql", TextBody{query});
   }

   Totals me(DefaultTestChain& t, const std::string& token)
   {
      return t.http(XUsage::service).auth_bearer(token).get<Totals>("/me");
   }
}  // namespace

TEST_CASE("x-usage: totals per identity, each readable only by itself")
{
   DefaultTestChain t;
   auto             anna = TestGuest::login(t);
   auto             ben  = TestGuest::login(t);
   REQUIRE(anna.id != ben.id);

   // Nothing yet. (A guest login is not counted for the guest: the request
   // carries no session.)
   auto before = me(t, anna.token);
   CHECK(before.identity == anna.id);
   CHECK(before.kind == UsageKind::guest);
   CHECK(before.requests == 0);
   CHECK(before.request_bytes == 0);
   CHECK(before.response_bytes == 0);

   const std::string shortQuery = R"(query { account(name: "nobody") { account } })";
   const std::string longQuery =
       R"(query { account(name: "somebodyelse") { account state pauseSeconds freezeSeconds } })";

   std::uint64_t annaResponse = 0;
   for (int i = 0; i < 3; ++i)
   {
      auto reply = ask(t, anna.token, shortQuery);
      REQUIRE(reply.status == HttpStatus::ok);
      annaResponse += reply.body.size();
   }
   std::uint64_t benResponse = 0;
   for (int i = 0; i < 5; ++i)
   {
      auto reply = ask(t, ben.token, longQuery);
      REQUIRE(reply.status == HttpStatus::ok);
      benResponse += reply.body.size();
   }

   auto a = me(t, anna.token);
   CHECK(a.identity == anna.id);
   CHECK(a.kind == UsageKind::guest);
   CHECK(a.requests == 3);
   CHECK(a.request_bytes == 3 * shortQuery.size());
   CHECK(a.response_bytes == annaResponse);
   CHECK(a.response_bytes > 0);
   CHECK(a.first_seen > 1'700'000'000);
   CHECK(a.last_seen >= a.first_seen);

   auto b = me(t, ben.token);
   CHECK(b.identity == ben.id);
   CHECK(b.requests == 5);
   CHECK(b.request_bytes == 5 * longQuery.size());
   CHECK(b.response_bytes == benResponse);

   // Reading one's totals is a request to the node's own service, which is
   // not counted: nothing moved.
   CHECK(me(t, anna.token).requests == 3);

   // Nobody is shown anybody else's row: there is nothing to ask with.
   // Naming another identity changes nothing,
   auto named = t.http(XUsage::service)
                    .auth_bearer(anna.token)
                    .get<Totals>("/me?identity=" + ben.id + "&after=" + ben.id);
   CHECK(named.identity == anna.id);
   CHECK(named.requests == 3);
   // and without a session there is no row to show.
   CHECK(t.http(XUsage::service).get<HttpReply>("/me").status == HttpStatus::unauthorized);
   CHECK(t.http(XUsage::service).auth_bearer("not-a-token").get<HttpReply>("/me").status ==
         HttpStatus::unauthorized);
   // The list of everybody is the administrator's. A guest's token is not
   // an administrator's, wherever the request comes from.
   {
      auto reply = t.http(XUsage::service)
                       .auth_bearer(anna.token)
                       .header("X-Forwarded-For", "203.0.113.7")
                       .get<HttpReply>("/all");
      CHECK(reply.status != HttpStatus::ok);
      auto text = std::string(reply.body.begin(), reply.body.end());
      CHECK(text.find(ben.id) == std::string::npos);
      CHECK(text.find(anna.id) == std::string::npos);
   }
   {
      auto reply =
          t.http(XUsage::service).header("X-Forwarded-For", "203.0.113.7").get<HttpReply>("/all");
      CHECK(reply.status != HttpStatus::ok);
   }

   // An administrator (a local connection, here) sees every row.
   auto all = t.http(XUsage::service).get<Page>("/all");
   CHECK(!all.more);
   auto find = [&](const std::string& identity) -> const AdminTotals*
   {
      for (auto& row : all.rows)
         if (row.identity == identity)
            return &row;
      return nullptr;
   };
   REQUIRE(find(anna.id));
   CHECK(find(anna.id)->requests == 3);
   CHECK(find(anna.id)->kind == UsageKind::guest);
   CHECK(!find(anna.id)->carried_to);
   REQUIRE(find(ben.id));
   CHECK(find(ben.id)->requests == 5);
   // The requests that carried no session (the two guest logins among them)
   REQUIRE(find(XUsage::nodeIdentity));
   CHECK(find(XUsage::nodeIdentity)->kind == UsageKind::node);
   CHECK(find(XUsage::nodeIdentity)->requests >= 2);
   CHECK(std::ranges::is_sorted(all.rows, {}, &AdminTotals::identity));

   // Paginated by identity
   std::vector<std::string> seen;
   std::string              after;
   for (int pages = 0; pages < 10; ++pages)
   {
      auto page = t.http(XUsage::service)
                      .get<Page>("/all?limit=1" + (after.empty() ? "" : "&after=" + after));
      REQUIRE(page.rows.size() == 1);
      seen.push_back(page.rows[0].identity);
      after = page.rows[0].identity;
      if (!page.more)
         break;
   }
   CHECK(seen.size() == all.rows.size());
   CHECK(std::ranges::is_sorted(seen));
   CHECK(t.http(XUsage::service).get<HttpReply>("/all?limit=0").status == HttpStatus::badRequest);
   CHECK(t.http(XUsage::service).get<Page>("/all?limit=100000").rows.size() == all.rows.size());

}

TEST_CASE("x-usage: only x-http and the chain's HTTP service feed it")
{
   DefaultTestChain t;
   auto             alice = t.addAccount("alice"_a);
   // Its actions are for the node's own services; a transaction cannot call them.
   CHECK(t.from(alice).to<XUsage>().identify(1, UsageKind::account, "victim").failed(""));
   CHECK(t.from(alice).to<XUsage>().request(1, 1'000'000, 1'000'000).failed(""));
   CHECK(t.from(alice).to<XUsage>().reply(1, 1'000'000).failed(""));
   CHECK(t.from(alice).to<XUsage>().carryOver("guest", alice).failed(""));
}

#include "XPortalTest.hpp"

#include <tuple>

namespace
{
   TransactionTrace signCreator(DefaultTestChain& t)
   {
      auto sys = t.to<Tokens>().getSysToken().returnVal();
      REQUIRE(sys.has_value());
      transactor<Tokens> tokens{XPortal::creatorAccount, Tokens::service};
      std::vector<Action> actions{
          tokens.credit(sys->id, AccountNumber{"alice"},
                        Quantity{static_cast<Quantity::Quantity_t>(1)}, "")};
      return runAs(t, XPortal::service, XKeys::service, "signTx", std::tuple{std::move(actions)});
   }

   bool holdsKey(const SubjectPublicKeyInfo& pub)
   {
      auto id  = sha256(pub.data.data(), pub.data.size());
      auto row = XKeys{}.open<KeyTable>().get({XPortal::service, id});
      return row.has_value();
   }
}  // namespace

TEST_CASE("rotating the creator key keeps signing on the chain key")
{
   DefaultTestChain t{portalPackages};
   installPortal(t);
   auto alice = AccountNumber{"alice"};
   XAdmin{}.open<AdminAccountTable>().put(AdminAccountRow{alice});
   auto token = t.login(alice, XPortal::service);

   CHECK(t.http(forwarded("GET", "/admin/agents", token)).status == HttpStatus::notFound);

   auto first = t.http<AgentKey>(keygenRequest(token));
   createCreator(t, alice, first.pubkey);
   CHECK(!signCreator(t).error.has_value());

   auto agents = t.http<AgentView>(forwarded("GET", "/admin/agents", token));
   CHECK(agents.account == XPortal::creatorAccount);
   CHECK(agents.pubkey_pem == ::SystemService::AuthSig::to_string(first.pubkey));
   CHECK(agents.psi_balance.value == 0);
   CHECK(agents.resource_balance.value == 0);
   CHECK(agents.std_buffer_cost.value > 0);

   CHECK(t.http(forwarded("POST", "/admin/agents/creator/activate", token)).status ==
         HttpStatus::conflict);

   auto pending = t.http<AgentKey>(keygenRequest(token));
   REQUIRE(pending.pending_pubkey.has_value());
   CHECK(pending.pubkey == first.pubkey);
   CHECK(t.http<AgentKey>(keygenRequest(token)).pending_pubkey == pending.pending_pubkey);
   CHECK(!signCreator(t).error.has_value());

   REQUIRE(t.from(alice)
               .to<AuthScope>()
               .setKey(XPortal::creatorAccount, *pending.pending_pubkey)
               .succeeded());
   CHECK(!signCreator(t).error.has_value());

   auto activated = t.http<AgentKey>(forwarded("POST", "/admin/agents/creator/activate", token));
   CHECK(activated.pubkey == *pending.pending_pubkey);
   CHECK(!activated.pending_pubkey.has_value());
   CHECK(!holdsKey(first.pubkey));
   CHECK(holdsKey(activated.pubkey));
   CHECK(!signCreator(t).error.has_value());
   CHECK(t.http<AgentView>(forwarded("GET", "/admin/agents", token)).pubkey_pem ==
         ::SystemService::AuthSig::to_string(activated.pubkey));
}


// Owner and active keys, pending changes, pause, freeze and the recovery
// partner (gofractally/psibase #2275, sections 4.1 and 5). Each case fails
// without the rule it names.
#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/verifier.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>
#include <services/system/StagedTx.hpp>
#include <services/system/Transact.hpp>
#include <services/user/Nft.hpp>

#include <set>

using namespace SystemService;
using namespace psibase;
using AuthSig::AccountState;
using AuthSig::AuthKey;
using AuthSig::AuthRecord;
using AuthSig::ChangeKind;
using AuthSig::KeySpec;
using AuthSig::PrivateKeyInfo;
using AuthSig::RecoveryRequest;
using AuthSig::SubjectPublicKeyInfo;
using AuthService = AuthSig::AuthSig;

namespace
{
   constexpr std::int64_t hour = 60 * 60;
   constexpr std::int64_t day  = 24 * hour;

   const char* const denied       = "Authorization for";
   const char* const needsOwner   = "this action requires the owner key";
   const char* const notPartner   = "sender is not the recovery partner of this account";
   const char* const tooManyOwner = "too many owner key changes within the freeze window";

   Action runAs(transactor<Transact>& transact, Action action, std::vector<ServiceMethod> allowed)
   {
      return transact.runAs(std::move(action), std::move(allowed));
   }

   struct Key
   {
      PrivateKeyInfo       priv = PrivateKeyInfo::create();
      SubjectPublicKeyInfo pub  = getSubjectPublicKeyInfo(priv);
      KeySpec              spec(std::uint64_t seq = 0) const { return KeySpec{pub, seq, {}}; }
      KeyPair              pair() const { return {pub, priv}; }
   };

   // What the query service reports for an account
   struct Status
   {
      AccountNumber                             account;
      AuthKey                                   owner;
      AuthKey                                   active;
      std::optional<AccountNumber>              partner;
      std::uint32_t                             pauseSeconds;
      std::uint32_t                             freezeSeconds;
      AccountState                              state;
      std::optional<TimePointSec>               stateSince;
      std::optional<TimePointSec>               stateUntil;
      std::optional<AuthSig::PendingChange>     pending;
      std::vector<AuthSig::PriorOwnerKey>       priorOwners;
      std::vector<RecoveryRequest>              recoveryRequests;
      PSIO_REFLECT(Status,
                   account,
                   owner,
                   active,
                   partner,
                   pauseSeconds,
                   freezeSeconds,
                   state,
                   stateSince,
                   stateUntil,
                   pending,
                   priorOwners,
                   recoveryRequests)
   };
   const char* const statusFields =
       "account owner { verifier key seq } active { verifier key seq } partner pauseSeconds "
       "freezeSeconds state stateSince stateUntil "
       "pending { kind owner { verifier key seq } active { verifier key seq } partner "
       "pauseSeconds freezeSeconds requested } "
       "priorOwners { verifier key seq expires paused } "
       "recoveryRequests { account id owner { verifier key seq } active { verifier key seq } "
       "signedBy { verifier key seq } time }";

   struct AccountData
   {
      std::optional<Status> account;
      PSIO_REFLECT(AccountData, account)
   };
   struct AccountReply
   {
      AccountData data;
      PSIO_REFLECT(AccountReply, data)
   };

   struct PageInfo
   {
      bool                       hasNextPage;
      std::optional<std::string> endCursor;
      PSIO_REFLECT(PageInfo, hasNextPage, endCursor)
   };
   struct Edge
   {
      Status node;
      PSIO_REFLECT(Edge, node)
   };
   struct Connection
   {
      std::vector<Edge> edges;
      PageInfo          pageInfo;
      PSIO_REFLECT(Connection, edges, pageInfo)
   };
   struct ByPartnerData
   {
      Connection accountsByPartner;
      PSIO_REFLECT(ByPartnerData, accountsByPartner)
   };
   struct ByPartnerReply
   {
      ByPartnerData data;
      PSIO_REFLECT(ByPartnerReply, data)
   };
   struct WaitingData
   {
      Connection requestsForPartner;
      PSIO_REFLECT(WaitingData, requestsForPartner)
   };
   struct WaitingReply
   {
      WaitingData data;
      PSIO_REFLECT(WaitingReply, data)
   };

   struct Fixture
   {
      DefaultTestChain t;
      // The account that creates the others and so is their recovery partner.
      // It needs no signature.
      AccountNumber partner = t.addAccount(AccountNumber{"partner"});
      AccountNumber other   = t.addAccount(AccountNumber{"somebody"});

      Key           owner, active;
      AccountNumber alice = AccountNumber{"alicealice"};

      transactor<AuthService> as{alice, AuthService::service};
      transactor<AuthService> byPartner{partner, AuthService::service};

      Fixture() { create(alice, owner, active); }

      void create(AccountNumber name, const Key& o, const Key& a)
      {
         REQUIRE(t.from(partner).to<AuthService>().newAccount(name, o.spec(1), a.spec(2)).succeeded());
      }

      // A transaction of these actions signed with these keys. A new block
      // each time: the same action is pushed more than once.
      TraceResult push(std::vector<Action> actions, std::vector<const Key*> keys)
      {
         t.startBlock();
         KeyList list;
         for (auto key : keys)
            list.push_back(key->pair());
         return TraceResult(t.pushTransaction(t.makeTransaction(std::move(actions)), list));
      }
      TraceResult push(Action action, const Key& key) { return push({std::move(action)}, {&key}); }
      TraceResult unsignedPush(Action action) { return push({std::move(action)}, {}); }

      Action nop(AccountNumber sender) { return Action{.sender = sender, .service = AccountNumber{"nop"}}; }
      Action nop() { return nop(alice); }

      // Whether `key` authorizes an ordinary action of alice's now
      bool works(const Key& key) { return push(nop(), key).succeeded(); }

      void advance(std::int64_t seconds) { t.startBlock(seconds * 1000); }

      TimePointSec now()
      {
         // The block that transactions and queries now run in
         return std::chrono::time_point_cast<Seconds>(
             t.kvGet<StatusRow>(StatusRow::db, statusKey()).value().current.time);
      }

      std::string graphql(std::string query)
      {
         auto res  = t.post(AuthService::service, "/graphql", GraphQLBody{query});
         auto body = std::string(res.body.begin(), res.body.end());
         UNSCOPED_INFO(body);
         return body;
      }

      Status status(AccountNumber account)
      {
         auto body = graphql(std::format(R"(query {{ account(name: "{}") {{ {} }} }})",
                                         account.str(), statusFields));
         return psio::from_ijson<AccountReply>(body).data.account.value();
      }
      Status status() { return status(alice); }

      // Requests an owner-key change and lets its pause run out.
      void changeOwner(const Key& from, const Key& toOwner, const Key& toActive)
      {
         REQUIRE(push(as.requestOwnerChange(toOwner.spec(), toActive.spec()), from).succeeded());
         advance(day + 60);
         REQUIRE(status().state == AccountState::normal);
         REQUIRE(status().owner.key == toOwner.pub);
      }
   };
}  // namespace

TEST_CASE("auth-sig: a new account has both keys and its creator as recovery partner")
{
   Fixture f;
   auto    s = f.status();
   CHECK(s.account == f.alice);
   CHECK(s.owner.key == f.owner.pub);
   CHECK(s.owner.seq == 1);
   CHECK(s.owner.verifier == *verifierFor(f.owner.pub.data));
   CHECK(s.active.key == f.active.pub);
   CHECK(s.active.seq == 2);
   CHECK(s.partner == f.partner);
   CHECK(s.pauseSeconds == day);
   CHECK(s.freezeSeconds == 7 * day);
   CHECK(s.state == AccountState::normal);
   CHECK(!s.stateUntil);
   CHECK(!s.pending);
   CHECK(s.priorOwners.empty());
   CHECK(s.recoveryRequests.empty());

   // Both keys sign ordinary actions; no other key does, and no signature does not.
   CHECK(f.works(f.active));
   CHECK(f.works(f.owner));
   Key stranger;
   CHECK(f.push(f.nop(), stranger).failed(denied));
   CHECK(f.unsignedPush(f.nop()).failed(denied));

   // The name cannot be taken again, and its keys cannot be overwritten.
   Key thief;
   CHECK(f.t.from(f.other)
             .to<AuthService>()
             .newAccount(f.alice, thief.spec(), thief.spec())
             .failed("account already exists"));
   CHECK(f.push(f.as.setKeys(thief.spec(), thief.spec()), f.owner)
             .failed("account already uses auth-sig"));
   CHECK(f.status().owner.key == f.owner.pub);

   // An account that does not use auth-sig stores its keys with setKeys. It
   // has no recovery partner.
   Key one;
   REQUIRE(f.t.from(f.other).to<AuthService>().setKeys(one.spec(), one.spec()).succeeded());
   REQUIRE(f.t.from(f.other).to<Accounts>().setAuthServ(AuthService::service).succeeded());
   auto o = f.status(f.other);
   CHECK(!o.partner);
   CHECK(o.owner.key == one.pub);
   CHECK(o.active.key == one.pub);
   CHECK(f.push(f.nop(f.other), one).succeeded());
   CHECK(f.unsignedPush(f.nop(f.other)).failed(denied));
}

TEST_CASE("auth-sig: the active key cannot perform a control action")
{
   Fixture f;
   Key     k1, k2;
   transactor<Accounts> accounts{f.alice, Accounts::service};
   transactor<Transact> transact{f.alice, Transact::service};

   std::vector<std::pair<const char*, Action>> control;
   control.emplace_back("setActive", f.as.setActive(k1.spec()));
   control.emplace_back("requestOwnerChange", f.as.requestOwnerChange(k1.spec(), k2.spec()));
   control.emplace_back("requestPartnerChange", f.as.requestPartnerChange(f.other));
   control.emplace_back("requestPartnerChange to none", f.as.requestPartnerChange(std::nullopt));
   control.emplace_back("requestDelays", f.as.requestDelays(2 * day, 14 * day));
   control.emplace_back("pause", f.as.pause());
   control.emplace_back("freeze", f.as.freeze());
   control.emplace_back("proposeRecovery", f.as.proposeRecovery(k1.spec(), k2.spec()));
   control.emplace_back("setKeys", f.as.setKeys(k1.spec(), k2.spec()));
   control.emplace_back("accounts::setAuthServ", accounts.setAuthServ(AuthAny::service));
   control.emplace_back("transact::runAs", runAs(transact, f.as.setActive(k1.spec()), {}));

   auto before = psio::to_ijson(f.status());
   for (auto& [name, action] : control)
   {
      INFO(name);
      CHECK(f.push(action, f.active).failed(denied));
      // Nor with a key that is not the account's, nor unsigned
      CHECK(f.push(action, k1).failed(denied));
      CHECK(f.unsignedPush(action).failed(denied));
   }
   CHECK(psio::to_ijson(f.status()) == before);
   CHECK(f.t.from(f.other).to<Accounts>().getAuthOf(f.alice).returnVal() == AuthService::service);

   // The owner key may do each of them (those that apply in this state).
   CHECK(f.push(f.as.setActive(k1.spec(9)), f.owner).succeeded());
   CHECK(f.status().active.key == k1.pub);
   CHECK(f.status().active.seq == 9);
   // The replaced active key is of no use at once; the new one is.
   CHECK(!f.works(f.active));
   CHECK(f.works(k1));
   CHECK(f.push(accounts.setAuthServ(AuthAny::service), f.owner).succeeded());
   CHECK(f.t.from(f.other).to<Accounts>().getAuthOf(f.alice).returnVal() == AuthAny::service);
}

TEST_CASE("auth-sig: an owner key change pauses the account and takes effect after the pause")
{
   Fixture f;
   Key     newOwner, newActive;
   REQUIRE(f.push(f.as.requestOwnerChange(newOwner.spec(3), newActive.spec(4)), f.owner).succeeded());
   auto requested = f.now();

   auto s = f.status();
   CHECK(s.state == AccountState::paused);
   REQUIRE(s.stateUntil);
   CHECK(*s.stateUntil == requested + Seconds{day});
   REQUIRE(s.pending);
   CHECK(s.pending->kind == ChangeKind::ownerKeys);
   CHECK(s.pending->owner->key == newOwner.pub);
   CHECK(s.pending->active->key == newActive.pub);
   CHECK(s.pending->requested == requested);
   // Not yet in effect
   CHECK(s.owner.key == f.owner.pub);
   CHECK(s.active.key == f.active.pub);

   // Nothing is authorized while it is pending, with any of the four keys.
   for (const Key* key : {&f.owner, &f.active, &newOwner, &newActive})
      CHECK(!f.works(*key));
   // In particular, no key of the account ends the pause or the change.
   CHECK(f.push(f.as.endPause(f.alice), f.owner).failed(denied));
   CHECK(f.push(f.as.reject(f.alice), f.owner).failed(denied));
   CHECK(f.push(f.as.confirm(f.alice), newOwner).failed(denied));
   CHECK(f.push(f.as.requestOwnerChange(f.owner.spec(), f.active.spec()), f.owner).failed(denied));
   CHECK(f.push(f.as.setActive(f.active.spec()), f.owner).failed(denied));

   // Just before the end: still paused
   f.advance(day - 600);
   CHECK(f.status().state == AccountState::paused);
   CHECK(!f.works(newOwner));

   // After it: the change is in effect, though nothing has written the record.
   f.advance(1200);
   s = f.status();
   CHECK(s.state == AccountState::normal);
   CHECK(!s.pending);
   CHECK(!s.stateUntil);
   CHECK(s.owner.key == newOwner.pub);
   CHECK(s.owner.seq == 3);
   CHECK(s.active.key == newActive.pub);
   CHECK(s.active.seq == 4);
   // The replaced owner key keeps a freeze window, from when the change took effect.
   REQUIRE(s.priorOwners.size() == 1);
   CHECK(s.priorOwners[0].key == f.owner.pub);
   CHECK(s.priorOwners[0].expires == requested + Seconds{day} + Seconds{7 * day});
   CHECK(!s.priorOwners[0].paused);

   CHECK(f.works(newActive));
   CHECK(f.works(newOwner));
   // The old keys sign nothing ordinary any more.
   CHECK(!f.works(f.active));
   CHECK(!f.works(f.owner));
   // The old owner key cannot change the account either.
   Key k;
   CHECK(f.push(f.as.setActive(k.spec()), f.owner).failed(denied));
   CHECK(f.push(f.as.requestOwnerChange(k.spec(), k.spec()), f.owner).failed(denied));
}

TEST_CASE("auth-sig: the recovery partner makes an owner key change immediate")
{
   Fixture f;
   Key     newOwner, newActive;
   REQUIRE(f.push(f.as.requestOwnerChange(newOwner.spec(), newActive.spec()), f.owner).succeeded());

   // Only the partner
   CHECK(f.t.from(f.other).to<AuthService>().confirm(f.alice).failed(notPartner));
   CHECK(f.status().state == AccountState::paused);

   REQUIRE(f.t.from(f.partner).to<AuthService>().confirm(f.alice).succeeded());
   auto s = f.status();
   CHECK(s.state == AccountState::normal);
   CHECK(!s.pending);
   CHECK(s.owner.key == newOwner.pub);
   CHECK(s.active.key == newActive.pub);
   // A confirmed change leaves the replaced owner key no freeze window.
   CHECK(s.priorOwners.empty());
   CHECK(f.works(newActive));
   CHECK(f.push(f.as.freeze(), f.owner).failed(denied));
   CHECK(f.push(f.as.pause(), f.owner).failed(denied));
   CHECK(f.status().state == AccountState::normal);

   // There is nothing left to confirm.
   CHECK(f.t.from(f.partner).to<AuthService>().confirm(f.alice).failed("no pending change"));
}

TEST_CASE("auth-sig: a replaced owner key can freeze within its window and not after it")
{
   Fixture f;
   Key     newOwner, newActive;
   f.changeOwner(f.owner, newOwner, newActive);

   SECTION("within the window")
   {
      f.advance(6 * day);
      REQUIRE(f.status().priorOwners.size() == 1);
      // It freezes, and does nothing else.
      CHECK(f.push(f.nop(), f.owner).failed(denied));
      CHECK(f.push(f.as.setActive(f.active.spec()), f.owner).failed(denied));
      REQUIRE(f.push(f.as.freeze(), f.owner).succeeded());
      CHECK(f.status().state == AccountState::frozen);
      CHECK(!f.works(newOwner));
      CHECK(!f.works(newActive));
   }
   SECTION("after the window")
   {
      f.advance(7 * day + 60);
      CHECK(f.status().priorOwners.empty());
      CHECK(f.push(f.as.freeze(), f.owner).failed(denied));
      CHECK(f.push(f.as.pause(), f.owner).failed(denied));
      CHECK(f.status().state == AccountState::normal);
      CHECK(f.works(newOwner));
   }
}

TEST_CASE("auth-sig: a fourth owner key change within the freeze window is refused")
{
   Fixture f;
   Key     o1, a1, o2, a2, o3, a3, o4, a4;
   f.changeOwner(f.owner, o1, a1);
   f.changeOwner(o1, o2, a2);
   f.changeOwner(o2, o3, a3);
   CHECK(f.status().priorOwners.size() == 3);

   CHECK(f.push(f.as.requestOwnerChange(o4.spec(), a4.spec()), o3).failed(tooManyOwner));
   CHECK(f.status().state == AccountState::normal);
   CHECK(!f.status().pending);

   // A change the partner confirms leaves no replaced key, but while three are
   // in their windows a request is refused all the same: it could not know.
   // Once the windows have ended there is room again. (Each later change
   // paused the account for a day, and the earlier keys' windows did not
   // run meanwhile, so the three windows end at about the same time, seven
   // days after the third change took effect.)
   f.advance(5 * day);
   CHECK(f.status().priorOwners.size() == 3);
   CHECK(f.push(f.as.requestOwnerChange(o4.spec(), a4.spec()), o3).failed(tooManyOwner));
   f.advance(2 * day + hour);
   CHECK(f.status().priorOwners.empty());
   REQUIRE(f.push(f.as.requestOwnerChange(o4.spec(), a4.spec()), o3).succeeded());
   CHECK(f.status().state == AccountState::paused);
}

TEST_CASE("auth-sig: pause and freeze")
{
   Fixture f;

   SECTION("the owner key pauses; the pause ends by itself")
   {
      REQUIRE(f.push(f.as.pause(), f.owner).succeeded());
      auto pausedAt = f.now();
      auto s        = f.status();
      CHECK(s.state == AccountState::paused);
      CHECK(!s.pending);
      CHECK(*s.stateUntil == pausedAt + Seconds{day});
      CHECK(!f.works(f.owner));
      CHECK(!f.works(f.active));
      // Not again while paused, and nothing else
      CHECK(f.push(f.as.pause(), f.owner).failed(denied));
      Key k;
      CHECK(f.push(f.as.setActive(k.spec()), f.owner).failed(denied));
      CHECK(f.push(f.as.requestOwnerChange(k.spec(), k.spec()), f.owner).failed(denied));
      CHECK(f.push(f.as.proposeRecovery(k.spec(), k.spec()), f.owner).failed(denied));

      f.advance(day - 600);
      CHECK(f.status().state == AccountState::paused);
      CHECK(!f.works(f.active));
      f.advance(1200);
      CHECK(f.status().state == AccountState::normal);
      CHECK(f.works(f.active));
      CHECK(f.works(f.owner));
   }
   SECTION("a pause is upgraded to a freeze by the owner key")
   {
      REQUIRE(f.push(f.as.pause(), f.owner).succeeded());
      // The active key cannot
      CHECK(f.push(f.as.freeze(), f.active).failed(denied));
      REQUIRE(f.push(f.as.freeze(), f.owner).succeeded());
      auto s = f.status();
      CHECK(s.state == AccountState::frozen);
      CHECK(!s.stateUntil);
      // A freeze does not end by itself.
      f.advance(400 * day);
      CHECK(f.status().state == AccountState::frozen);
      CHECK(!f.works(f.owner));
      CHECK(!f.works(f.active));
      CHECK(f.push(f.as.freeze(), f.owner).failed(denied));
      CHECK(f.push(f.as.pause(), f.owner).failed(denied));
   }
   SECTION("the owner key freezes directly")
   {
      REQUIRE(f.push(f.as.freeze(), f.owner).succeeded());
      CHECK(f.status().state == AccountState::frozen);
      CHECK(!f.works(f.owner));
   }
   SECTION("a replaced owner key pauses once, and may freeze")
   {
      Key newOwner, newActive;
      f.changeOwner(f.owner, newOwner, newActive);

      REQUIRE(f.push(f.as.pause(), f.owner).succeeded());
      CHECK(f.status().state == AccountState::paused);
      REQUIRE(f.status().priorOwners.size() == 1);
      CHECK(f.status().priorOwners[0].paused);
      f.advance(day + 60);
      CHECK(f.status().state == AccountState::normal);
      CHECK(f.works(newActive));

      // Not a second time
      CHECK(f.push(f.as.pause(), f.owner).failed(denied));
      CHECK(f.status().state == AccountState::normal);
      // The current owner key still may.
      REQUIRE(f.push(f.as.pause(), newOwner).succeeded());
      // And the replaced key upgrades that pause to a freeze.
      REQUIRE(f.push(f.as.freeze(), f.owner).succeeded());
      CHECK(f.status().state == AccountState::frozen);
   }
   SECTION("a freeze drops the change that was pending")
   {
      // The owner's answer to a change somebody else got through
      Key thiefOwner, thiefActive;
      REQUIRE(f.push(f.as.requestOwnerChange(thiefOwner.spec(), thiefActive.spec()), f.owner)
                  .succeeded());
      REQUIRE(f.push(f.as.freeze(), f.owner).succeeded());
      auto s = f.status();
      CHECK(s.state == AccountState::frozen);
      CHECK(!s.pending);
      f.advance(2 * day);
      s = f.status();
      CHECK(s.state == AccountState::frozen);
      CHECK(s.owner.key == f.owner.pub);
      CHECK(!f.works(thiefOwner));
      CHECK(!f.works(thiefActive));
   }
}

TEST_CASE("auth-sig: the recovery partner ends a pause")
{
   Fixture f;
   REQUIRE(f.push(f.as.pause(), f.owner).succeeded());

   CHECK(f.t.from(f.other).to<AuthService>().endPause(f.alice).failed(notPartner));
   // The account is not its own partner, whatever it signs with.
   CHECK(f.push(f.as.endPause(f.alice), f.owner).failed(denied));
   CHECK(f.status().state == AccountState::paused);

   REQUIRE(f.t.from(f.partner).to<AuthService>().endPause(f.alice).succeeded());
   CHECK(f.status().state == AccountState::normal);
   CHECK(f.works(f.active));
   CHECK(f.t.from(f.partner).to<AuthService>().endPause(f.alice).failed("account is not paused"));

   // A pause with a change pending is ended by deciding the change.
   Key k;
   REQUIRE(f.push(f.as.requestOwnerChange(k.spec(), k.spec()), f.owner).succeeded());
   CHECK(f.t.from(f.partner).to<AuthService>().endPause(f.alice).failed("has a pending change"));
   CHECK(f.status().state == AccountState::paused);
}

TEST_CASE("auth-sig: a recovery partner change is pending like an owner key change")
{
   Fixture f;
   auto    newPartner = f.other;

   CHECK(f.push(f.as.requestPartnerChange(AccountNumber{"nobodyhere"}), f.owner)
             .failed("recovery partner does not exist"));
   CHECK(f.push(f.as.requestPartnerChange(f.alice), f.owner)
             .failed("cannot be its own recovery partner"));

   REQUIRE(f.push(f.as.requestPartnerChange(newPartner), f.owner).succeeded());
   auto s = f.status();
   CHECK(s.state == AccountState::paused);
   REQUIRE(s.pending);
   CHECK(s.pending->kind == ChangeKind::partner);
   CHECK(s.pending->partner == newPartner);
   CHECK(s.partner == f.partner);
   CHECK(!f.works(f.owner));
   // The partner to be has no say yet.
   CHECK(f.t.from(newPartner).to<AuthService>().confirm(f.alice).failed(notPartner));

   SECTION("after the pause")
   {
      f.advance(day + 60);
      s = f.status();
      CHECK(s.state == AccountState::normal);
      CHECK(s.partner == newPartner);
      CHECK(!s.pending);
      // The old partner has no say any more.
      REQUIRE(f.push(f.as.pause(), f.owner).succeeded());
      CHECK(f.t.from(f.partner).to<AuthService>().endPause(f.alice).failed(notPartner));
      CHECK(f.t.from(newPartner).to<AuthService>().endPause(f.alice).succeeded());
   }
   SECTION("confirmed by the current partner")
   {
      REQUIRE(f.t.from(f.partner).to<AuthService>().confirm(f.alice).succeeded());
      s = f.status();
      CHECK(s.state == AccountState::normal);
      CHECK(s.partner == newPartner);
      CHECK(f.works(f.active));
   }
   SECTION("rejected by the current partner")
   {
      CHECK(f.t.from(f.other).to<AuthService>().reject(f.alice).failed(notPartner));
      REQUIRE(f.t.from(f.partner).to<AuthService>().reject(f.alice).succeeded());
      s = f.status();
      CHECK(s.state == AccountState::normal);
      CHECK(s.partner == f.partner);
      CHECK(!s.pending);
      CHECK(f.works(f.active));
      // Nor does it take effect later.
      f.advance(2 * day);
      CHECK(f.status().partner == f.partner);
   }
   SECTION("to no partner at all")
   {
      REQUIRE(f.t.from(f.partner).to<AuthService>().reject(f.alice).succeeded());
      REQUIRE(f.push(f.as.requestPartnerChange(std::nullopt), f.owner).succeeded());
      CHECK(f.status().pending->kind == ChangeKind::partner);
      CHECK(!f.status().pending->partner);
      f.advance(day + 60);
      CHECK(!f.status().partner);
   }
}

TEST_CASE("auth-sig: a rejected owner key change does not happen")
{
   Fixture f;
   Key     newOwner, newActive;
   REQUIRE(f.push(f.as.requestOwnerChange(newOwner.spec(), newActive.spec()), f.owner).succeeded());
   REQUIRE(f.t.from(f.partner).to<AuthService>().reject(f.alice).succeeded());
   auto s = f.status();
   CHECK(s.state == AccountState::normal);
   CHECK(!s.pending);
   CHECK(s.owner.key == f.owner.pub);
   CHECK(s.priorOwners.empty());
   f.advance(2 * day);
   CHECK(f.status().owner.key == f.owner.pub);
   CHECK(f.works(f.active));
   CHECK(!f.works(newOwner));
}

TEST_CASE("auth-sig: a change of the delays is itself delayed")
{
   Fixture f;

   CHECK(f.push(f.as.requestDelays(60, 7 * day), f.owner).failed("pause length out of range"));
   CHECK(f.push(f.as.requestDelays(day, 60), f.owner).failed("freeze window out of range"));
   CHECK(f.push(f.as.requestDelays(day, 4000 * day), f.owner).failed("freeze window out of range"));

   // Shortening both as far as allowed
   REQUIRE(f.push(f.as.requestDelays(hour, day), f.owner).succeeded());
   auto s = f.status();
   CHECK(s.state == AccountState::paused);
   REQUIRE(s.pending);
   CHECK(s.pending->kind == ChangeKind::delays);
   CHECK(s.pending->pauseSeconds == hour);
   CHECK(s.pending->freezeSeconds == day);
   // The old values still hold: this very pause lasts the old length.
   CHECK(s.pauseSeconds == day);
   CHECK(s.freezeSeconds == 7 * day);
   f.advance(2 * hour);
   CHECK(f.status().state == AccountState::paused);

   f.advance(day);
   s = f.status();
   CHECK(s.state == AccountState::normal);
   CHECK(s.pauseSeconds == hour);
   CHECK(s.freezeSeconds == day);

   // And they govern what comes next.
   Key newOwner, newActive;
   REQUIRE(f.push(f.as.requestOwnerChange(newOwner.spec(), newActive.spec()), f.owner).succeeded());
   auto until = f.now() + Seconds{hour};
   CHECK(*f.status().stateUntil == until);
   f.advance(hour + 60);
   s = f.status();
   CHECK(s.owner.key == newOwner.pub);
   REQUIRE(s.priorOwners.size() == 1);
   CHECK(s.priorOwners[0].expires == until + Seconds{day});
}

TEST_CASE("auth-sig: a frozen account is released only by its recovery partner")
{
   Fixture f;
   Key     newOwner, newActive, k;

   // Not while it is not frozen
   CHECK(f.push(f.as.proposeRecovery(newOwner.spec(), newActive.spec()), f.owner)
             .failed("account is not frozen"));
   CHECK(f.t.from(f.partner)
             .to<AuthService>()
             .unfreezeWith(f.alice, newOwner.spec(), newActive.spec())
             .failed("account is not frozen"));

   REQUIRE(f.push(f.as.freeze(), f.owner).succeeded());

   // Only proposeRecovery is authorized, and only with an owner key.
   CHECK(!f.works(f.owner));
   CHECK(f.push(f.as.setActive(k.spec()), f.owner).failed(denied));
   CHECK(f.push(f.as.requestOwnerChange(k.spec(), k.spec()), f.owner).failed(denied));
   CHECK(f.push(f.as.proposeRecovery(k.spec(), k.spec()), f.active).failed(denied));
   CHECK(f.push(f.as.proposeRecovery(k.spec(), k.spec()), k).failed(denied));

   auto proposed = f.push(f.as.proposeRecovery(newOwner.spec(5), newActive.spec(6)), f.owner);
   REQUIRE(proposed.succeeded());
   auto s = f.status();
   CHECK(s.state == AccountState::frozen);
   REQUIRE(s.recoveryRequests.size() == 1);
   auto request = s.recoveryRequests[0];
   CHECK(request.account == f.alice);
   CHECK(request.owner.key == newOwner.pub);
   CHECK(request.owner.seq == 5);
   CHECK(request.active.key == newActive.pub);
   CHECK(request.signedBy.key == f.owner.pub);
   // Still frozen: a proposal installs nothing.
   CHECK(!f.works(newOwner));

   SECTION("unfreeze installs the proposed keys")
   {
      CHECK(f.t.from(f.other).to<AuthService>().unfreeze(f.alice, request.id).failed(notPartner));
      CHECK(f.t.from(f.partner)
                .to<AuthService>()
                .unfreeze(f.alice, request.id + 1)
                .failed("recovery request not found"));
      REQUIRE(f.t.from(f.partner).to<AuthService>().unfreeze(f.alice, request.id).succeeded());
      s = f.status();
      CHECK(s.state == AccountState::normal);
      CHECK(s.owner.key == newOwner.pub);
      CHECK(s.owner.seq == 5);
      CHECK(s.active.key == newActive.pub);
      CHECK(s.active.seq == 6);
      CHECK(s.priorOwners.empty());
      CHECK(s.recoveryRequests.empty());
      CHECK(f.works(newActive));
      CHECK(f.works(newOwner));
      // The keys from before the freeze are gone, with no window.
      CHECK(!f.works(f.owner));
      CHECK(!f.works(f.active));
      CHECK(f.push(f.as.freeze(), f.owner).failed(denied));
   }
   SECTION("a request can be dropped, and keys installed without one")
   {
      CHECK(f.t.from(f.other).to<AuthService>().rejectRecovery(f.alice, request.id).failed(notPartner));
      REQUIRE(f.t.from(f.partner).to<AuthService>().rejectRecovery(f.alice, request.id).succeeded());
      CHECK(f.status().recoveryRequests.empty());
      CHECK(f.status().state == AccountState::frozen);
      CHECK(f.t.from(f.partner)
                .to<AuthService>()
                .unfreeze(f.alice, request.id)
                .failed("recovery request not found"));

      Key o, a;
      CHECK(f.t.from(f.other)
                .to<AuthService>()
                .unfreezeWith(f.alice, o.spec(), a.spec())
                .failed(notPartner));
      REQUIRE(
          f.t.from(f.partner).to<AuthService>().unfreezeWith(f.alice, o.spec(), a.spec()).succeeded());
      s = f.status();
      CHECK(s.state == AccountState::normal);
      CHECK(s.owner.key == o.pub);
      CHECK(s.active.key == a.pub);
      CHECK(f.works(a));
      CHECK(!f.works(f.owner));
   }
   SECTION("the requests of an account are bounded")
   {
      std::uint32_t last = request.id;
      for (int i = 0; i < 10; ++i)
      {
         Key o, a;
         auto r = f.push(f.as.proposeRecovery(o.spec(), a.spec()), f.owner);
         REQUIRE(r.succeeded());
      }
      s = f.status();
      CHECK(s.recoveryRequests.size() == AuthService::maxRecoveryRequests);
      // The oldest gave way.
      for (auto& r : s.recoveryRequests)
      {
         CHECK(r.id > last);
         last = std::max(last, r.id);
      }
   }
}

TEST_CASE("auth-sig: replaced owner keys clear at an unfreeze and may propose recovery")
{
   Fixture f;
   Key     newOwner, newActive;
   f.changeOwner(f.owner, newOwner, newActive);
   // The real owner, who has the old key, answers the change with a freeze
   REQUIRE(f.push(f.as.freeze(), f.owner).succeeded());
   // long before going to the partner: no window runs out while frozen.
   f.advance(30 * day);
   REQUIRE(f.status().priorOwners.size() == 1);

   Key o, a;
   REQUIRE(f.push(f.as.proposeRecovery(o.spec(), a.spec()), f.owner).succeeded());
   auto s = f.status();
   REQUIRE(s.recoveryRequests.size() == 1);
   // The partner sees which key asked.
   CHECK(s.recoveryRequests[0].signedBy.key == f.owner.pub);
   // The holder of the current owner key may ask too.
   Key o2, a2;
   REQUIRE(f.push(f.as.proposeRecovery(o2.spec(), a2.spec()), newOwner).succeeded());
   s = f.status();
   REQUIRE(s.recoveryRequests.size() == 2);
   CHECK(s.recoveryRequests[1].signedBy.key == newOwner.pub);

   REQUIRE(f.t.from(f.partner).to<AuthService>().unfreeze(f.alice, s.recoveryRequests[0].id).succeeded());
   s = f.status();
   CHECK(s.state == AccountState::normal);
   CHECK(s.owner.key == o.pub);
   CHECK(s.priorOwners.empty());
   CHECK(s.recoveryRequests.empty());
   CHECK(f.works(a));
   for (const Key* old : {&f.owner, &newOwner})
   {
      CHECK(f.push(f.as.freeze(), *old).failed(denied));
      CHECK(f.push(f.as.pause(), *old).failed(denied));
   }
   CHECK(!f.works(newActive));
}

TEST_CASE("auth-sig: an account with no recovery partner stays frozen")
{
   Fixture f;
   Key     one;
   REQUIRE(f.t.from(f.other).to<AuthService>().setKeys(one.spec(), one.spec()).succeeded());
   REQUIRE(f.t.from(f.other).to<Accounts>().setAuthServ(AuthService::service).succeeded());
   transactor<AuthService> as{f.other, AuthService::service};

   // A pause still ends by itself.
   REQUIRE(f.push(as.pause(), one).succeeded());
   CHECK(f.t.from(f.partner).to<AuthService>().endPause(f.other).failed(notPartner));
   f.advance(day + 60);
   CHECK(f.status(f.other).state == AccountState::normal);

   REQUIRE(f.push(as.freeze(), one).succeeded());
   Key o, a;
   REQUIRE(f.push(as.proposeRecovery(o.spec(), a.spec()), one).succeeded());
   auto id = f.status(f.other).recoveryRequests.at(0).id;
   for (auto who : {f.partner, f.alice, f.other})
   {
      INFO(who.str());
      // alice and the account itself need signatures they cannot give here;
      // whoever asks, nobody is the partner.
      if (who == f.partner)
      {
         CHECK(f.t.from(who).to<AuthService>().unfreeze(f.other, id).failed(notPartner));
         CHECK(f.t.from(who)
                   .to<AuthService>()
                   .unfreezeWith(f.other, o.spec(), a.spec())
                   .failed(notPartner));
      }
   }
   transactor<AuthService> asAlice{f.alice, AuthService::service};
   CHECK(f.push(asAlice.unfreeze(f.other, id), f.owner).failed(notPartner));
   CHECK(f.push(as.unfreeze(f.other, id), one).failed(denied));
   f.advance(1000 * day);
   CHECK(f.status(f.other).state == AccountState::frozen);
   CHECK(f.push(f.nop(f.other), one).failed(denied));
}

TEST_CASE("auth-sig: clocks do not run while the account is paused")
{
   Fixture f;
   Key     newOwner, newActive;
   f.changeOwner(f.owner, newOwner, newActive);
   auto expires = f.status().priorOwners.at(0).expires;

   // Less than a day of the old key's window is left when the account is paused.
   f.advance(6 * day + 3600);
   REQUIRE(f.status().priorOwners.size() == 1);
   REQUIRE(f.push(f.as.pause(), newOwner).succeeded());
   auto pausedAt = f.now();
   // The window is extended by the pause.
   CHECK(f.status().priorOwners.at(0).expires == expires + Seconds{day});

   SECTION("a pause that runs its length")
   {
      f.advance(day + 60);
      CHECK(f.status().state == AccountState::normal);
      // Without the rule the window would have ended during the pause. It
      // has as much left as when the pause began.
      REQUIRE(f.status().priorOwners.size() == 1);
      CHECK(f.status().priorOwners[0].expires == expires + Seconds{day});
      CHECK(f.now() > expires);
      REQUIRE(f.push(f.as.freeze(), f.owner).succeeded());
      CHECK(f.status().state == AccountState::frozen);
   }
   SECTION("a pause the partner ends early costs the window only its length")
   {
      f.advance(hour);
      REQUIRE(f.t.from(f.partner).to<AuthService>().endPause(f.alice).succeeded());
      auto ended = f.now();
      REQUIRE(f.status().priorOwners.size() == 1);
      CHECK(f.status().priorOwners[0].expires == expires + (ended - pausedAt));
      // and then it does run out.
      f.advance(2 * day);
      CHECK(f.status().priorOwners.empty());
      CHECK(f.push(f.as.freeze(), f.owner).failed(denied));
   }
   SECTION("a pending change waits for its own pause, not for an earlier clock")
   {
      // The pause above is standalone. Once it is over, a change requested
      // then takes a whole pause from its request.
      f.advance(day + 60);
      Key o, a;
      REQUIRE(f.push(f.as.requestOwnerChange(o.spec(), a.spec()), newOwner).succeeded());
      auto requested = f.now();
      CHECK(*f.status().stateUntil == requested + Seconds{day});
      f.advance(day - 600);
      CHECK(f.status().owner.key == newOwner.pub);
      f.advance(1200);
      CHECK(f.status().owner.key == o.pub);
   }
}

TEST_CASE("auth-sig: transitions that are due are applied when the record is next changed")
{
   Fixture f;
   Key     newOwner, newActive, next;
   REQUIRE(f.push(f.as.requestOwnerChange(newOwner.spec(), newActive.spec()), f.owner).succeeded());
   f.advance(day + 60);
   // Nothing has written the record since the request. The new owner key acts
   // on the record as it is now.
   REQUIRE(f.push(f.as.setActive(next.spec()), newOwner).succeeded());
   auto s = f.status();
   CHECK(s.state == AccountState::normal);
   CHECK(s.owner.key == newOwner.pub);
   CHECK(s.active.key == next.pub);
   CHECK(s.priorOwners.size() == 1);
   CHECK(f.works(next));

   // refresh writes the record as it is; anyone may call it and nothing that
   // the queries report changes.
   REQUIRE(f.push(f.as.pause(), newOwner).succeeded());
   f.advance(day + 60);
   auto before = psio::to_ijson(f.status());
   REQUIRE(f.t.from(f.other).to<AuthService>().refresh(f.alice).succeeded());
   CHECK(psio::to_ijson(f.status()) == before);
   CHECK(f.status().state == AccountState::normal);
}

TEST_CASE("auth-sig: accounts by recovery partner, paginated")
{
   Fixture f;
   // A few hundred accounts with one partner, and some with another
   const int     count = 230;
   Key           key;
   std::set<AccountNumber> expected{f.alice};
   transactor<AuthService> create{f.partner, AuthService::service};
   for (int i = 0; i < count;)
   {
      std::vector<Action> actions;
      for (int j = 0; j < 23 && i < count; ++j, ++i)
      {
         auto name = AccountNumber{"acct" + std::to_string(1000 + i)};
         expected.insert(name);
         actions.push_back(create.newAccount(name, key.spec(), key.spec()));
      }
      REQUIRE(f.push(std::move(actions), {}).succeeded());
   }
   transactor<AuthService> createOther{f.other, AuthService::service};
   REQUIRE(f.push({createOther.newAccount(AccountNumber{"elsewhere1"}, key.spec(), key.spec()),
                   createOther.newAccount(AccountNumber{"elsewhere2"}, key.spec(), key.spec())},
                  {})
               .succeeded());

   auto page = [&](std::string_view queryName, AccountNumber partner, int first,
                   const std::optional<std::string>& after)
   {
      auto afterArg = after ? std::format(R"(, after: "{}")", *after) : std::string{};
      return f.graphql(std::format(
          R"(query {{ {}(partner: "{}", first: {}{}) {{ edges {{ node {{ {} }} }} pageInfo {{ hasNextPage endCursor }} }} }})",
          queryName, partner.str(), first, afterArg, statusFields));
   };

   const int               pageSize = 40;
   std::set<AccountNumber> seen;
   std::optional<std::string> cursor;
   int                     pages = 0;
   while (true)
   {
      auto reply = psio::from_ijson<ByPartnerReply>(
          page("accountsByPartner", f.partner, pageSize, cursor));
      auto& connection = reply.data.accountsByPartner;
      ++pages;
      CHECK(connection.edges.size() <= pageSize);
      for (auto& edge : connection.edges)
      {
         CHECK(edge.node.partner == f.partner);
         // No account twice
         CHECK(seen.insert(edge.node.account).second);
      }
      if (!connection.pageInfo.hasNextPage)
         break;
      CHECK(connection.edges.size() == pageSize);
      cursor = connection.pageInfo.endCursor;
      REQUIRE(cursor.has_value());
      REQUIRE(pages < 100);
   }
   CHECK(seen == expected);
   CHECK(pages == (count + 1 + pageSize - 1) / pageSize);

   // The other partner's accounts are its own.
   auto others = psio::from_ijson<ByPartnerReply>(page("accountsByPartner", f.other, 10, {}))
                     .data.accountsByPartner;
   REQUIRE(others.edges.size() == 2);
   CHECK(others.edges[0].node.account == AccountNumber{"elsewhere1"});
   CHECK(!others.pageInfo.hasNextPage);

   // What is waiting for the partner: nothing, until some of them need it.
   auto waiting = [&](AccountNumber partner)
   {
      return psio::from_ijson<WaitingReply>(page("requestsForPartner", partner, 50, {}))
          .data.requestsForPartner.edges;
   };
   CHECK(waiting(f.partner).empty());

   auto paused  = AccountNumber{"acct1007"};
   auto pending = AccountNumber{"acct1100"};
   auto frozen  = AccountNumber{"acct1222"};
   Key  o, a;
   REQUIRE(f.push(transactor<AuthService>{paused, AuthService::service}.pause(), key).succeeded());
   REQUIRE(f.push(transactor<AuthService>{pending, AuthService::service}.requestOwnerChange(
                      o.spec(), a.spec()),
                  key)
               .succeeded());
   REQUIRE(f.push(transactor<AuthService>{frozen, AuthService::service}.freeze(), key).succeeded());
   REQUIRE(f.push(transactor<AuthService>{frozen, AuthService::service}.proposeRecovery(
                      o.spec(), a.spec()),
                  key)
               .succeeded());
   // One of the other partner's accounts too
   REQUIRE(f.push(transactor<AuthService>{AccountNumber{"elsewhere2"}, AuthService::service}.pause(),
                  key)
               .succeeded());

   auto list = waiting(f.partner);
   REQUIRE(list.size() == 3);
   CHECK(list[0].node.account == paused);
   CHECK(list[0].node.state == AccountState::paused);
   CHECK(!list[0].node.pending);
   CHECK(list[1].node.account == pending);
   CHECK(list[1].node.state == AccountState::paused);
   REQUIRE(list[1].node.pending);
   CHECK(list[1].node.pending->kind == ChangeKind::ownerKeys);
   // When it takes effect by itself
   CHECK(*list[1].node.stateUntil == list[1].node.pending->requested + Seconds{day});
   CHECK(list[2].node.account == frozen);
   CHECK(list[2].node.state == AccountState::frozen);
   REQUIRE(list[2].node.recoveryRequests.size() == 1);
   CHECK(list[2].node.recoveryRequests[0].owner.key == o.pub);

   auto otherList = waiting(f.other);
   REQUIRE(otherList.size() == 1);
   CHECK(otherList[0].node.account == AccountNumber{"elsewhere2"});

   // The partner deals with them and the list empties.
   REQUIRE(f.t.from(f.partner).to<AuthService>().endPause(paused).succeeded());
   REQUIRE(f.t.from(f.partner).to<AuthService>().confirm(pending).succeeded());
   REQUIRE(f.t.from(f.partner)
               .to<AuthService>()
               .unfreeze(frozen, list[2].node.recoveryRequests[0].id)
               .succeeded());
   CHECK(waiting(f.partner).empty());
}

TEST_CASE("auth-sig: the active key cannot reach a control action through another route")
{
   Fixture f;
   Key     k;
   transactor<Accounts>       accounts{f.alice, Accounts::service};
   transactor<Transact>       transact{f.alice, Transact::service};
   transactor<StagedTxService> staged{f.alice, StagedTxService::service};

   auto unchanged = [&]
   {
      auto s = f.status();
      return s.active.key == f.active.pub && s.owner.key == f.owner.pub &&
             s.state == AccountState::normal && !s.pending &&
             f.t.from(f.other).to<Accounts>().getAuthOf(f.alice).returnVal() ==
                 AuthService::service;
   };

   SECTION("transact::runAs as oneself")
   {
      // transact asks nobody when an account runs an action as itself.
      for (auto action :
           {f.as.setActive(k.spec()), f.as.requestOwnerChange(k.spec(), k.spec()), f.as.freeze(),
            accounts.setAuthServ(AuthAny::service)})
      {
         CHECK(f.push(runAs(transact, action, {}), f.active).failed(denied));
         CHECK(unchanged());
      }
      // The owner key may, since it may send the action itself.
      CHECK(f.push(runAs(transact, f.as.setActive(k.spec()), {}), f.owner).succeeded());
      CHECK(f.status().active.key == k.pub);
   }
   SECTION("a staged transaction")
   {
      // An ordinary action staged and accepted with the active key runs.
      Action mint{.sender  = f.alice,
                  .service = UserService::Nft::service,
                  .method  = MethodNumber{"mint"},
                  .rawData = psio::to_pssz(std::tuple())};
      REQUIRE(f.push(staged.propose(std::vector<Action>{mint}, true), f.active).succeeded());

      // A control action does not, whichever key staged it: the approval of
      // a staged transaction does not say which key gave it.
      for (auto action :
           {f.as.setActive(k.spec()), f.as.requestOwnerChange(k.spec(), k.spec()), f.as.pause(),
            f.as.freeze(), f.as.requestPartnerChange(f.other),
            accounts.setAuthServ(AuthAny::service), runAs(transact, f.as.setActive(k.spec()), {})})
      {
         for (const Key* key : {&f.active, &f.owner})
         {
            f.t.startBlock();
            auto proposed = f.t.from(f.alice)
                                .with({key->pair()})
                                .to<StagedTxService>()
                                .propose(std::vector<Action>{action}, true);
            // Staged, perhaps, but never executed
            CHECK(unchanged());
            if (proposed.succeeded())
            {
               // Accepting it again and asking for it to run change nothing.
               auto id   = proposed.returnVal();
               auto txid = f.t.from(f.other)
                               .to<StagedTxService>()
                               .get_staged_tx(id)
                               .returnVal()
                               .txid;
               CHECK(f.push(staged.execute(id, txid), *key).failed(""));
               CHECK(unchanged());
            }
         }
      }
      // Another account's acceptance is no better.
      transactor<StagedTxService> byOther{f.other, StagedTxService::service};
      f.t.startBlock();
      auto proposed = f.t.from(f.other).to<StagedTxService>().propose(
          std::vector<Action>{f.as.setActive(k.spec())}, true);
      REQUIRE(proposed.succeeded());
      CHECK(unchanged());
      // Alice accepting it with her active key does not run it either.
      auto id   = proposed.returnVal();
      auto txid = f.t.from(f.other).to<StagedTxService>().get_staged_tx(id).returnVal().txid;
      (void)f.push(staged.accept(id, txid), f.active);
      CHECK(unchanged());
      (void)f.push(staged.accept(id, txid), f.owner);
      CHECK(unchanged());
   }
   SECTION("a staged transaction does not run for a paused account")
   {
      Action mint{.sender  = f.alice,
                  .service = UserService::Nft::service,
                  .method  = MethodNumber{"mint"},
                  .rawData = psio::to_pssz(std::tuple())};
      transactor<StagedTxService> byOther{f.other, StagedTxService::service};
      // Staged by somebody else while alice is normal, so that it waits for her
      f.t.startBlock();
      auto proposed =
          f.t.from(f.other).to<StagedTxService>().propose(std::vector<Action>{mint}, false);
      REQUIRE(proposed.succeeded());
      auto id   = proposed.returnVal();
      auto txid = f.t.from(f.other).to<StagedTxService>().get_staged_tx(id).returnVal().txid;
      REQUIRE(f.push(staged.accept(id, txid), f.active).succeeded());
      REQUIRE(f.push(f.as.pause(), f.owner).succeeded());
      CHECK(f.push({byOther.execute(id, txid)}, {}).failed(""));
   }
}

// The sign-in page builds owner-key transactions itself: it has the query
// service pack an action's arguments from JSON. This is the JSON it writes.
TEST_CASE("auth-sig: packing the control actions from JSON")
{
   Fixture f;
   Key     a, b;
   struct RawJson
   {
      std::string       text;
      std::string       contentType() const { return "application/json"; }
      std::vector<char> body() const { return {text.begin(), text.end()}; }
   };
   auto pack = [&](const std::string& method, const std::string& json)
   {
      INFO(method << " " << json);
      auto reply = f.t.http(AuthService::service)
                       .header("Origin", "https://supervisor.psibase.io")
                       .post<HttpReply>("/pack_action/" + method, RawJson{json});
      REQUIRE(reply.status == HttpStatus::ok);
      CHECK(reply.contentType == "application/octet-stream");
      // The supervisor's page may read it.
      bool allowed = false;
      for (auto& h : reply.headers)
         if (h.matches("access-control-allow-origin"))
            allowed = h.value == "*" || h.value == "https://supervisor.psibase.io";
      CHECK(allowed);
      return reply.body;
   };
   // A key is its PEM text, as everywhere in JSON; a JSON string holds it
   // with its line feeds escaped.
   auto pem = [](const Key& key)
   {
      std::string text = AuthSig::SubjectPublicKeyInfoText::text(key.pub);
      std::string out  = "\"";
      for (char c : text)
         out += c == '\n' ? std::string{"\\n"} : std::string{c};
      return out + "\"";
   };
   auto verifier = verifierFor(a.pub.data)->str();

   // A KeySpec is {"key": PEM, "seq": number or decimal string, "verifier": name or null,
   // or left out}.
   // The packed values hold freshly generated keys. The comparisons are wrapped in
   // parentheses so a result is reported as true or false: writing out the two byte
   // vectors has thrown std::length_error for some key bytes (#2299).
   auto expected = psio::to_pssz(std::tuple{KeySpec{a.pub, 9, {}}});
   CHECK((pack("setActive", "{\"active\":{\"key\":" + pem(a) + ",\"seq\":9}}") == expected));
   CHECK((pack("setActive", "{\"active\":{\"key\":" + pem(a) + ",\"seq\":\"9\"}}") == expected));
   CHECK((pack("setActive",
              "{\"active\":{\"key\":" + pem(a) + ",\"seq\":9,\"verifier\":null}}") == expected));
   CHECK((pack("setActive", "{\"active\":{\"key\":" + pem(a) +
                               ",\"seq\":\"18446744073709551615\",\"verifier\":\"" + verifier +
                               "\"}}") ==
         psio::to_pssz(std::tuple{KeySpec{a.pub, 18446744073709551615ull, AccountNumber{verifier}}})));

   auto both = "{\"owner\":{\"key\":" + pem(a) + ",\"seq\":1},\"active\":{\"key\":" + pem(b) +
               ",\"seq\":2}}";
   auto bothPacked = psio::to_pssz(std::tuple{KeySpec{a.pub, 1, {}}, KeySpec{b.pub, 2, {}}});
   CHECK((pack("requestOwnerChange", both) == bothPacked));
   CHECK((pack("proposeRecovery", both) == bothPacked));

   CHECK(pack("requestPartnerChange", "{\"partner\":\"somebody\"}") ==
         psio::to_pssz(std::tuple{std::optional{AccountNumber{"somebody"}}}));
   CHECK(pack("requestPartnerChange", "{\"partner\":null}") ==
         psio::to_pssz(std::tuple{std::optional<AccountNumber>{}}));
   CHECK(pack("requestPartnerChange", "{}") ==
         psio::to_pssz(std::tuple{std::optional<AccountNumber>{}}));

   CHECK(pack("requestDelays", "{\"pauseSeconds\":172800,\"freezeSeconds\":1209600}") ==
         psio::to_pssz(std::tuple{std::uint32_t{172800}, std::uint32_t{1209600}}));

   CHECK(pack("pause", "{}") == psio::to_pssz(std::tuple{}));
   CHECK(pack("freeze", "{}") == psio::to_pssz(std::tuple{}));

   // What is packed is what the action takes: a transaction built from it works.
   Action act{.sender  = f.alice,
              .service = AuthService::service,
              .method  = MethodNumber{"setActive"},
              .rawData = pack("setActive", "{\"active\":{\"key\":" + pem(a) + ",\"seq\":9}}")};
   REQUIRE(f.push(act, f.owner).succeeded());
   CHECK(f.status().active.key == a.pub);
   CHECK(f.status().active.seq == 9);
}

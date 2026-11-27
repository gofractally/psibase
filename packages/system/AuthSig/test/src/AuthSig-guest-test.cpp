// The `guest` account (gofractally/psibase #2307): an ordinary auth-sig
// account whose key nobody holds and which has no recovery partner, created
// when the chain boots. Nothing treats the name specially, so these cases
// are about what the ordinary rules give for such an account.
#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/crypto.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/verifier.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/GuestAccount.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>
#include <services/system/Transact.hpp>
#include <services/user/Nft.hpp>
#include <services/user/Tokens.hpp>
#include <services/user/tokenTypes.hpp>

#include <algorithm>
#include <cstring>

using namespace SystemService;
using namespace psibase;
using AuthSig::AccountState;
using AuthSig::AuthKey;
using AuthSig::KeySpec;
using AuthSig::PrivateKeyInfo;
using AuthSig::SubjectPublicKeyInfo;
using AuthService = AuthSig::AuthSig;
using UserService::Nft;
using UserService::Precision;
using UserService::Quantity;
using UserService::Tokens;

namespace
{
   constexpr std::int64_t day = 24 * 60 * 60;

   const char* const denied     = "Authorization for";
   const char* const notPartner = "sender is not the recovery partner of this account";

   constexpr auto guest = AuthSig::guest::account;

   SubjectPublicKeyInfo guestKey()
   {
      return SubjectPublicKeyInfo{
          {std::begin(AuthSig::guest::keySpki), std::end(AuthSig::guest::keySpki)}};
   }

   struct Key
   {
      PrivateKeyInfo       priv = PrivateKeyInfo::create();
      SubjectPublicKeyInfo pub  = getSubjectPublicKeyInfo(priv);
      KeySpec              spec() const { return KeySpec{pub, 0, {}}; }
      KeyPair              pair() const { return {pub, priv}; }
   };

   // What the query service reports for an account
   struct RequestId
   {
      std::uint32_t id;
      PSIO_REFLECT(RequestId, id)
   };
   struct Expiry
   {
      TimePointSec expires;
      PSIO_REFLECT(Expiry, expires)
   };
   struct Kind
   {
      AuthSig::ChangeKind kind;
      PSIO_REFLECT(Kind, kind)
   };
   struct Status
   {
      AccountNumber                account;
      AuthKey                      owner;
      AuthKey                      active;
      std::optional<AccountNumber> partner;
      std::uint32_t                pauseSeconds;
      std::uint32_t                freezeSeconds;
      AccountState                 state;
      std::optional<Kind>          pending;
      std::vector<Expiry>          priorOwners;
      std::vector<RequestId>       recoveryRequests;
      PSIO_REFLECT(Status,
                   account,
                   owner,
                   active,
                   partner,
                   pauseSeconds,
                   freezeSeconds,
                   state,
                   pending,
                   priorOwners,
                   recoveryRequests)
   };
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

   struct Fixture
   {
      DefaultTestChain t;
      // Accounts that need no signature
      AccountNumber alice = t.addAccount(AccountNumber{"alicealice"});
      AccountNumber root{"root"};

      transactor<AuthService> as{guest, AuthService::service};

      TraceResult push(std::vector<Action> actions, std::vector<const Key*> keys = {})
      {
         t.startBlock();
         KeyList list;
         for (auto key : keys)
            list.push_back(key->pair());
         return TraceResult(t.pushTransaction(t.makeTransaction(std::move(actions)), list));
      }
      TraceResult push(Action action, std::vector<const Key*> keys = {})
      {
         return push(std::vector<Action>{std::move(action)}, std::move(keys));
      }

      Action nop(AccountNumber sender = guest)
      {
         return Action{.sender = sender, .service = AccountNumber{"nop"}};
      }

      std::optional<Status> find(AccountNumber account)
      {
         auto query = std::format(
             R"(query {{ account(name: "{}") {{ account owner {{ verifier key seq }} active {{ verifier key seq }} partner pauseSeconds freezeSeconds state pending {{ kind }} priorOwners {{ expires }} recoveryRequests {{ id }} }} }})",
             account.str());
         auto res  = t.post(AuthService::service, "/graphql", GraphQLBody{query});
         auto body = std::string(res.body.begin(), res.body.end());
         UNSCOPED_INFO(body);
         return psio::from_ijson<AccountReply>(body).data.account;
      }
      Status status(AccountNumber account = guest) { return find(account).value(); }

      // The account is as boot left it.
      bool unchanged()
      {
         auto s = status();
         return s.owner.key == guestKey() && s.active.key == guestKey() &&
                s.owner.verifier == verifier::k1 && s.active.verifier == verifier::k1 &&
                !s.partner && s.state == AccountState::normal && !s.pending &&
                s.priorOwners.empty() && s.recoveryRequests.empty() &&
                t.from(alice).to<Accounts>().getAuthOf(guest).returnVal() == AuthService::service;
      }
   };
}  // namespace

TEST_CASE("guest: its key is what the published derivation gives")
{
   // x = SHA-256(seed || counter, 4 bytes little-endian). That x is on the
   // curve, and that no earlier counter is, is checked by guest-key.py
   // --check with integer arithmetic, and by verify-k1 accepting the key as
   // a key below.
   std::vector<unsigned char> input{std::begin(AuthSig::guest::keySeed),
                                    std::end(AuthSig::guest::keySeed) - 1};
   for (int i = 0; i < 4; ++i)
      input.push_back(static_cast<unsigned char>(AuthSig::guest::keyCounter >> (8 * i)));
   auto x = sha256(input.data(), input.size());

   auto key   = guestKey();
   auto point = verifier::ecPoint(key.data, KeyType::secp256k1);
   REQUIRE(point.size() == 33);
   // Compressed, with the even y
   CHECK(point[0] == 0x02);
   CHECK(std::equal(x.begin(), x.end(), point.begin() + 1));

   CHECK(keyType(key.data) == KeyType::secp256k1);
   CHECK(verifierFor(key.data) == verifier::k1);

   // Not the generator, the one point whose private key (1) everybody knows
   static constexpr unsigned char generatorX[32] = {
       0x79, 0xbe, 0x66, 0x7e, 0xf9, 0xdc, 0xbb, 0xac, 0x55, 0xa0, 0x62,
       0x95, 0xce, 0x87, 0x0b, 0x07, 0x02, 0x9b, 0xfc, 0xdb, 0x2d, 0xce,
       0x28, 0xd9, 0x59, 0xf2, 0x81, 0x5b, 0x16, 0xf8, 0x17, 0x98};
   CHECK(!std::equal(x.begin(), x.end(), generatorX));
}

TEST_CASE("guest: it exists after boot with the published key and no recovery partner")
{
   Fixture f;
   auto    account = f.t.from(f.alice).to<Accounts>().getAccount(guest).returnVal();
   REQUIRE(account.has_value());
   CHECK(account->authService == AuthService::service);

   auto s = f.status();
   CHECK(s.account == guest);
   CHECK(s.owner.key == guestKey());
   CHECK(s.owner.verifier == verifier::k1);
   CHECK(s.owner.seq == 0);
   CHECK(s.active == s.owner);
   CHECK(!s.partner);
   CHECK(s.pauseSeconds == day);
   CHECK(s.freezeSeconds == 7 * day);
   CHECK(s.state == AccountState::normal);
   CHECK(!s.pending);
   CHECK(s.priorOwners.empty());
   CHECK(s.recoveryRequests.empty());

   // Services see the same record.
   auto record = f.t.from(f.alice).to<AuthService>().getRecord(guest).returnVal();
   REQUIRE(record.has_value());
   CHECK(record->owner.key == guestKey());
   CHECK(record->active.key == guestKey());
   CHECK(!record->partner);

   // The boot actions may be repeated (a package's postinstall runs again
   // when the package is upgraded): they find the account as they left it.
   REQUIRE(f.t.from(Accounts::service)
               .to<Accounts>()
               .newAccount(guest, AuthService::service, NewAccountMode::matchExisting)
               .succeeded());
   REQUIRE(f.t.from(AuthService::service)
               .to<AuthService>()
               .initKeys(guest, KeySpec::of(guestKey()), KeySpec::of(guestKey()))
               .succeeded());
   CHECK(f.unchanged());
}

TEST_CASE("guest: nothing authorizes a transaction from it")
{
   Fixture f;
   // No signature, and a good signature of some other key
   CHECK(f.push(f.nop()).failed(denied));
   Key stranger;
   CHECK(f.push(f.nop(), {&stranger}).failed(denied));

   // A claim of the account's key needs a signature that verifies with it.
   // verify-k1 takes the key for what it is, an ordinary key, and refuses
   // the signature: the failure is not that the key is malformed.
   auto forged = [&](std::vector<char> proof)
   {
      f.t.startBlock();
      auto trx = f.t.makeTransaction({f.nop()});
      auto key = guestKey();
      trx.claims.push_back({.service = verifier::k1, .rawData = {key.data.begin(), key.data.end()}});
      return TraceResult(f.t.pushTransaction(SignedTransaction{
          .transaction = psio::shared_pssz<Transaction>{trx}, .proofs = {std::move(proof)}}));
   };
   // r and s in range, s low
   CHECK(forged(std::vector<char>(64, 1)).failed("signature invalid"));
   {
      // A signature that is valid, for another key
      f.t.startBlock();
      auto trx = f.t.makeTransaction({f.nop()});
      auto key = guestKey();
      trx.claims.push_back({.service = verifier::k1, .rawData = {key.data.begin(), key.data.end()}});
      auto packed = psio::to_pssz(trx);
      auto proof  = AuthSig::sign(stranger.priv, sha256(packed.data(), packed.size()));
      CHECK(TraceResult(f.t.pushTransaction(SignedTransaction{
                            .transaction = psio::shared_pssz<Transaction>{trx},
                            .proofs      = {{proof.begin(), proof.end()}}}))
                .failed("signature invalid"));
   }
   CHECK(forged(std::vector<char>(64, 0)).failed("signature invalid"));
   CHECK(forged({}).failed("signature invalid"));

   // The same transaction from an account that needs no signature runs.
   CHECK(f.push(f.nop(f.alice)).succeeded());
   CHECK(f.unchanged());
}

TEST_CASE("guest: its keys, partner and auth service cannot be changed")
{
   Fixture f;
   Key     k;
   transactor<Accounts> accounts{guest, Accounts::service};
   transactor<Transact> transact{guest, Transact::service};

   // By the account: every action needs a key of the account.
   std::vector<Action> own{
       f.as.setKeys(k.spec(), k.spec()),
       f.as.setActive(k.spec()),
       f.as.requestOwnerChange(k.spec(), k.spec()),
       f.as.requestPartnerChange(f.alice),
       f.as.requestPartnerChange(std::nullopt),
       f.as.requestDelays(2 * day, 2 * day),
       f.as.pause(),
       f.as.freeze(),
       f.as.proposeRecovery(k.spec(), k.spec()),
       accounts.setAuthServ(AuthAny::service),
       transact.runAs(f.as.setActive(k.spec()), std::vector<ServiceMethod>{}),
   };
   for (auto& action : own)
   {
      INFO(action.method.str());
      CHECK(f.push(action).failed(denied));
      CHECK(f.push(action, {&k}).failed(denied));
      CHECK(f.unchanged());
   }

   // By others: the recovery partner's actions need the recovery partner,
   // and there is none. The service accounts are asked too: who creates an
   // account at boot is not its partner either.
   for (auto who : {f.alice, f.root, Accounts::service, AuthService::service})
   {
      INFO(who.str());
      auto by = f.t.from(who).to<AuthService>();
      CHECK(by.confirm(guest).failed(notPartner));
      CHECK(by.reject(guest).failed(notPartner));
      CHECK(by.endPause(guest).failed(notPartner));
      CHECK(by.unfreeze(guest, 1).failed(notPartner));
      CHECK(by.rejectRecovery(guest, 1).failed(notPartner));
      CHECK(by.unfreezeWith(guest, k.spec(), k.spec()).failed(notPartner));
      CHECK(f.unchanged());

      // Nobody's approval stands in for the account's.
      CHECK(by.isAuthSys(guest, std::vector{who}, std::nullopt).returnVal() == false);
      if (who != AuthService::service)
      {
         // (transact lets an auth service act for its accounts; see the
         // documentation of the guest account for what that means.)
         CHECK(f.t.from(who).to<Transact>().runAs(f.nop(), std::vector<ServiceMethod>{}).failed("not authorized"));
         CHECK(f.t.from(who)
                   .to<Transact>()
                   .runAs(accounts.setAuthServ(AuthAny::service), std::vector<ServiceMethod>{})
                   .failed("not authorized"));
      }
   }

   // Giving an account keys never replaces keys.
   CHECK(f.t.from(AuthService::service)
             .to<AuthService>()
             .initKeys(guest, k.spec(), k.spec())
             .failed("account already has keys"));
   CHECK(f.t.from(AuthService::service)
             .to<AuthService>()
             .initKeys(guest, KeySpec::of(guestKey()), k.spec())
             .failed("account already has keys"));
   CHECK(f.t.from(f.alice)
             .to<AuthService>()
             .initKeys(guest, k.spec(), k.spec())
             .failed("only auth-sig itself"));

   // Refreshing the record, which anyone may do, changes nothing, and
   // nothing becomes due with time.
   REQUIRE(f.t.from(f.alice).to<AuthService>().refresh(guest).succeeded());
   f.t.startBlock(1000 * day * 1000);
   CHECK(f.unchanged());
   CHECK(f.push(f.nop()).failed(denied));
}

TEST_CASE("guest: initKeys stays a no-op whatever others send")
{
   // A package's postinstall sends initKeys again at every upgrade, so it
   // must keep finding the record as it left it. Parts of a record are
   // advanced by actions (nextRequestId by proposeRecovery, the state by
   // pause and freeze), but none of those is open to anyone for this
   // account: they need an owner key, and the actions on recovery requests
   // need the recovery partner. The one action anyone may send is refresh,
   // which rewrites the record as it is. So: the refusals, then refresh,
   // then initKeys again.
   Fixture f;
   Key     k;
   auto    bySelf = f.t.from(AuthService::service).to<AuthService>();
   auto    again  = [&]
   { return bySelf.initKeys(guest, KeySpec::of(guestKey()), KeySpec::of(guestKey())); };

   for (auto who : {f.alice, f.root, Accounts::service, AuthService::service})
   {
      INFO(who.str());
      auto by = f.t.from(who).to<AuthService>();
      CHECK(by.rejectRecovery(guest, 1).failed(notPartner));
      CHECK(by.unfreeze(guest, 1).failed(notPartner));
      CHECK(by.unfreezeWith(guest, k.spec(), k.spec()).failed(notPartner));
      CHECK(by.confirm(guest).failed(notPartner));
      CHECK(by.reject(guest).failed(notPartner));
      CHECK(by.endPause(guest).failed(notPartner));
      REQUIRE(by.refresh(guest).succeeded());
   }
   for (auto action : {f.as.proposeRecovery(k.spec(), k.spec()), f.as.requestPartnerChange(f.alice),
                       f.as.pause(), f.as.freeze()})
   {
      CHECK(f.push(action).failed(denied));
      CHECK(f.push(action, {&k}).failed(denied));
   }

   auto record = f.t.from(f.alice).to<AuthService>().getRecord(guest).returnVal().value();
   CHECK(record.nextRequestId == 1);
   CHECK(!record.partner);

   REQUIRE(again().succeeded());
   f.t.startBlock(400 * day * 1000);
   REQUIRE(f.t.from(f.alice).to<AuthService>().refresh(guest).succeeded());
   REQUIRE(again().succeeded());
   CHECK(f.unchanged());
   CHECK(!f.t.from(f.alice).to<AuthService>().getRecord(guest).returnVal().value().partner);
}

TEST_CASE("guest: the name cannot be created again")
{
   Fixture f;
   Key     k;
   // The ordinary way, by an ordinary account: the name is too short for
   // it, before it is found to be taken.
   CHECK(f.t.from(f.alice)
             .to<AuthService>()
             .newAccount(guest, k.spec(), k.spec())
             .failed("account name must be at least"));
   CHECK(f.t.from(f.alice)
             .to<Accounts>()
             .newAccount(guest, AuthAny::service, NewAccountMode::requireNew)
             .failed("account name must be at least"));
   // And by the one account that may create short names
   for (auto mode : {NewAccountMode::requireNew, NewAccountMode::matchExisting})
      CHECK(f.t.from(Accounts::service)
                .to<Accounts>()
                .newAccount(guest, AuthAny::service, mode)
                .failed("account already exists"));
   // Nor with the length rule waived for it
   CHECK(f.push({transactor<Accounts>{Accounts::service, Accounts::service}.preapproveAcc(guest),
                 transactor<AuthService>{f.alice, AuthService::service}.newAccount(
                     guest, k.spec(), k.spec())})
             .failed("account already exists"));
   CHECK(f.unchanged());
}

TEST_CASE("guest: it is credited tokens like any account, and cannot spend them")
{
   Fixture f;
   auto    alice = f.t.from(f.alice);
   auto    a     = alice.to<Tokens>();
   auto    token = a.create(Precision{4}, 1'000'000e4).returnVal();
   REQUIRE(alice.to<Nft>().debit(a.getToken(token).returnVal().nft_id, "").succeeded());
   REQUIRE(a.mint(token, 1'000e4, "").succeeded());

   // An account that has not asked for credits to be taken at once holds
   // them as a pending balance until it debits them. That is every new
   // account, and this one can never ask or debit.
   REQUIRE(a.credit(token, guest, 100e4, "").succeeded());
   CHECK(a.getSharedBal(token, f.alice, guest).returnVal().value == 100e4);
   CHECK(a.getBalance(token, guest).returnVal().value == 0);
   CHECK(a.getBalance(token, f.alice).returnVal().value == 900e4);

   transactor<Tokens> g{guest, Tokens::service};
   Key                k;
   for (auto action : {g.debit(token, f.alice, 100e4, ""), g.credit(token, f.alice, 1e4, ""),
                       g.setUserConf(Tokens::autoDebit, true)})
   {
      CHECK(f.push(action).failed(denied));
      CHECK(f.push(action, {&k}).failed(denied));
   }
   CHECK(a.getSharedBal(token, f.alice, guest).returnVal().value == 100e4);
}

TEST_CASE("auth-sig: initKeys gives keys to an account that uses the service and has none")
{
   Fixture f;
   Key     owner, active, other;
   auto    name     = AccountNumber{"keylessone"};
   auto    bySelf   = f.t.from(AuthService::service).to<AuthService>();
   auto    accounts = f.t.from(Accounts::service).to<Accounts>();

   CHECK(bySelf.initKeys(name, owner.spec(), active.spec()).failed("does not exist"));
   // An account of another auth service is not touched.
   CHECK(bySelf.initKeys(f.alice, owner.spec(), active.spec())
             .failed("account does not use auth-sig"));

   REQUIRE(accounts.newAccount(name, AuthService::service, NewAccountMode::requireNew).succeeded());
   CHECK(!f.find(name));
   CHECK(f.push(f.nop(name), {&owner}).failed("sender does not have a public key"));

   // Only the service's own account
   for (auto who : {f.alice, f.root, Accounts::service, name})
      CHECK(f.push(transactor<AuthService>{who, AuthService::service}.initKeys(
                       name, owner.spec(), active.spec()))
                .failed(who == name ? "sender does not have a public key"
                                    : "only auth-sig itself"));
   // A key that no verifier accepts is refused as everywhere else.
   {
      auto bad = owner.spec();
      bad.key.data.push_back(0);
      CHECK(bySelf.initKeys(name, bad, active.spec()).failed("unsupported public key"));
   }

   REQUIRE(bySelf.initKeys(name, owner.spec(), active.spec()).succeeded());
   auto s = f.status(name);
   CHECK(s.owner.key == owner.pub);
   CHECK(s.active.key == active.pub);
   CHECK(!s.partner);
   CHECK(s.state == AccountState::normal);
   CHECK(f.push(f.nop(name), {&active}).succeeded());
   CHECK(f.push(f.nop(name), {&other}).failed(denied));

   // Once: the record is the account's from then on.
   REQUIRE(bySelf.initKeys(name, owner.spec(), active.spec()).succeeded());
   CHECK(bySelf.initKeys(name, other.spec(), other.spec()).failed("account already has keys"));
   CHECK(f.status(name).owner.key == owner.pub);

   // An account that has a recovery partner is not one this action made.
   auto partnered = AccountNumber{"partnered1"};
   REQUIRE(f.t.from(f.alice)
               .to<AuthService>()
               .newAccount(partnered, owner.spec(), active.spec())
               .succeeded());
   CHECK(bySelf.initKeys(partnered, owner.spec(), active.spec())
             .failed("account already has keys"));
   CHECK(f.status(partnered).partner == f.alice);
}

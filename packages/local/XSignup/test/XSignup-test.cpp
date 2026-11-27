// x-signup: accounts created with an owner and an active key, the encrypted
// account lists, and the node's sponsor acting as recovery partner.
#include <services/local/XSignup.hpp>

#include <catch2/catch_test_macros.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/nativeTables.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XUsage.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>
#include "Guest.hpp"

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using AuthSig::AccountState;
using AuthSig::KeySpec;
using AuthSig::PrivateKeyInfo;
using AuthSig::SubjectPublicKeyInfo;
using TestGuest::Guest;

namespace
{
   const auto sponsor = AccountNumber{"sponsor1"};

   struct Key
   {
      PrivateKeyInfo       priv = PrivateKeyInfo::create();
      SubjectPublicKeyInfo pub  = getSubjectPublicKeyInfo(priv);
      KeyPair              pair() const { return {pub, priv}; }
      std::vector<char>    bytes() const { return {pub.data.begin(), pub.data.end()}; }
   };

   // Request and reply shapes, as a browser writes and reads them
   struct KeyInput
   {
      std::vector<char> key;
      std::uint64_t     seq;
      PSIO_REFLECT(KeyInput, key, seq)
   };
   struct CreateRequest
   {
      std::string name;
      KeyInput    owner;
      KeyInput    active;
      PSIO_REFLECT(CreateRequest, name, owner, active)
   };
   struct IssuedTransaction
   {
      std::vector<char> transaction;
      std::uint32_t     valid_seconds;
      PSIO_REFLECT(IssuedTransaction, transaction, valid_seconds)
   };
   struct StartRequest
   {
      std::string                  provider;
      std::string                  browser;
      std::string                  resume;
      std::optional<std::string>   purpose;
      std::optional<AccountNumber> account;
      PSIO_REFLECT(StartRequest, provider, browser, resume, purpose, account)
   };
   struct LinkInfo
   {
      std::string                  provider;
      std::string                  handle;
      std::optional<AccountNumber> account;
      std::optional<AccountNumber> pending;
      PSIO_REFLECT(LinkInfo, provider, handle, account, pending)
   };
   struct RecoveryInfo
   {
      AccountNumber account;
      std::uint32_t valid_seconds;
      PSIO_REFLECT(RecoveryInfo, account, valid_seconds)
   };
   struct StartReply
   {
      std::string                 url;
      std::optional<LinkInfo>     link;
      std::optional<RecoveryInfo> recovery;
      PSIO_REFLECT(StartReply, url, link, recovery)
   };
   struct ProviderInfo
   {
      std::string name;
      std::string label;
      PSIO_REFLECT(ProviderInfo, name, label)
   };
   struct Status
   {
      bool                        open;
      std::vector<ProviderInfo>   providers;
      std::string                 guest;
      std::optional<LinkInfo>     link;
      std::vector<AccountNumber>  accounts;
      std::optional<RecoveryInfo> recovery;
      PSIO_REFLECT(Status, open, providers, guest, link, accounts, recovery)
   };
   struct SponsorInfo
   {
      AccountNumber account;
      std::string   key;
      bool          ready;
      PSIO_REFLECT(SponsorInfo, account, key, ready)
   };
   struct ListReply
   {
      std::vector<char> blob;
      std::uint64_t     version;
      PSIO_REFLECT(ListReply, blob, version)
   };
   struct ListWrite
   {
      std::vector<char> blob;
      std::vector<char> key;
      std::uint64_t     version;
      std::vector<char> sig;
      PSIO_REFLECT(ListWrite, blob, key, version, sig)
   };
   struct PartnerRequest
   {
      AccountNumber           account;
      std::optional<KeyInput> owner;
      std::optional<KeyInput> active;
      PSIO_REFLECT(PartnerRequest, account, owner, active)
   };
   struct ErrorBody
   {
      std::string error;
      PSIO_REFLECT(ErrorBody, error)
   };
   struct UsageLine
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
      PSIO_REFLECT(UsageLine,
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
   struct UsagePage
   {
      std::vector<UsageLine> rows;
      bool                  more;
      PSIO_REFLECT(UsagePage, rows, more)
   };

   // A body that is already JSON text
   struct RawJson
   {
      std::string       text;
      std::string       contentType() const { return "application/json"; }
      std::vector<char> body() const { return {text.begin(), text.end()}; }
   };

   std::string hex(std::span<const char> bytes)
   {
      std::string result;
      for (unsigned char b : bytes)
      {
         result += "0123456789abcdef"[b >> 4];
         result += "0123456789abcdef"[b & 15];
      }
      return result;
   }

   std::string errorOf(const HttpReply& reply)
   {
      if (reply.contentType != "application/json" || reply.status == HttpStatus::ok)
         return std::string(reply.body.begin(), reply.body.end());
      return psio::from_ijson<ErrorBody>(std::string(reply.body.begin(), reply.body.end())).error;
   }

   // What these tests read of an account
   struct PriorExpiry
   {
      TimePointSec expires;
      PSIO_REFLECT(PriorExpiry, expires)
   };
   struct AccountView
   {
      AuthSig::AuthKey             owner;
      AuthSig::AuthKey             active;
      std::optional<AccountNumber> partner;
      AccountState                 state;
      std::vector<PriorExpiry>     priorOwners;
      PSIO_REFLECT(AccountView, owner, active, partner, state, priorOwners)
   };
   struct AccountData
   {
      std::optional<AccountView> account;
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
      int              sent = 0;

      Fixture()
      {
         // The service signs with the wall clock; the chain follows it.
         syncTime();
         // A node that creates accounts, with the development provider
         REQUIRE(t.http(XSignup::service)
                     .put<HttpReply>("/config",
                                     RawJson{R"({"open":true,"sponsor":"sponsor1",)"
                                             R"("dev_provider":true,"providers":[]})"})
                     .status == HttpStatus::ok);
         auto info = t.http(XSignup::service).get<SponsorInfo>("/sponsor");
         REQUIRE(info.account == sponsor);
         REQUIRE(!info.ready);
         SubjectPublicKeyInfo key{AuthSig::parseSubjectPublicKeyInfo(info.key)};
         REQUIRE(t.to<AuthSig::AuthSig>()
                     .newAccount(sponsor, KeySpec::of(key), KeySpec::of(key))
                     .succeeded());
         REQUIRE(t.http(XSignup::service).get<SponsorInfo>("/sponsor").ready);
      }

      // Starts a block at the time of the wall clock, or a second after the
      // last block if that is later (blocks are at least a second apart).
      // The service dates the transactions it issues by the wall clock and
      // they are valid for well under a minute, so the chain must not run
      // far ahead of it: a block is started only for a transaction.
      void syncTime()
      {
         auto wall =
             std::chrono::time_point_cast<BlockTime::duration>(std::chrono::system_clock::now());
         auto status = t.kvGet<StatusRow>(StatusRow::db, statusKey()).value();
         auto least  = status.current.time + std::chrono::seconds(1);
         if (status.head)
            least = std::max(least, status.head->header.time + std::chrono::seconds(1));
         t.startBlock(std::max(wall, least));
      }

      auto as(const Guest& guest) { return t.http(XSignup::service).auth_bearer(guest.token); }

      Status status(const Guest& guest) { return as(guest).get<Status>("/status"); }

      // Links the guest through the development provider
      void link(const Guest& guest)
      {
         auto reply = as(guest).post<StartReply>("/oauth/start", StartRequest{.provider = "dev"});
         REQUIRE(reply.link.has_value());
         REQUIRE(reply.url.empty());
      }

      void push(const IssuedTransaction& issued)
      {
         syncTime();
         auto trace = t.pushTransaction(psio::from_pssz<SignedTransaction>(issued.transaction));
         INFO(trace.error.value_or(""));
         REQUIRE(!trace.error);
      }

      // A guest becomes the account `name` with these keys
      void create(const Guest& guest, const std::string& name, const Key& owner, const Key& active)
      {
         link(guest);
         auto issued = as(guest).post<IssuedTransaction>(
             "/create", CreateRequest{name, {owner.bytes(), 11}, {active.bytes(), 12}});
         CHECK(issued.valid_seconds > 0);
         push(issued);
      }

      // The account as auth-sig's query service reports it
      AccountView record(AccountNumber account)
      {
         auto query = std::format(
             R"(query {{ account(name: "{}") {{ owner {{ verifier key seq }} active {{ verifier key seq }} partner state priorOwners {{ expires }} }} }})",
             account.str());
         auto res  = t.post(AuthSig::AuthSig::service, "/graphql", GraphQLBody{query});
         auto body = std::string(res.body.begin(), res.body.end());
         UNSCOPED_INFO(body);
         return psio::from_ijson<AccountReply>(body).data.account.value();
      }

      // An action of `account`, signed with `key`
      void act(Action action, const Key& key)
      {
         syncTime();
         // The same action is sent more than once in a second: the
         // expiration tells the transactions apart.
         auto trace = t.pushTransaction(t.makeTransaction({std::move(action)}, 5 + sent++ % 30),
                                        {key.pair()});
         INFO(trace.error.value_or(""));
         REQUIRE(!trace.error);
      }

      // A recovery grant for `guest` on `account`, through the development provider
      HttpReply recover(const Guest& guest, AccountNumber account)
      {
         return as(guest).post<HttpReply>(
             "/oauth/start",
             StartRequest{.provider = "dev", .purpose = "recover", .account = account});
      }
   };
}  // namespace

TEST_CASE("x-signup: an account is created with an owner key and an active key")
{
   Fixture f;
   auto    guest = TestGuest::login(f.t);
   Key     owner, active;
   auto    name = AccountNumber{"newcomer1"};

   // Not before a provider sign-in
   {
      auto reply = f.as(guest).post<HttpReply>(
          "/create", CreateRequest{"newcomer1", {owner.bytes(), 1}, {active.bytes(), 2}});
      CHECK(reply.status == HttpStatus::forbidden);
   }
   f.link(guest);
   CHECK(f.status(guest).accounts.empty());

   // The guest uses the node a little before becoming an account.
   for (int i = 0; i < 2; ++i)
      REQUIRE(f.t.http(AuthSig::AuthSig::service)
                  .auth_bearer(guest.token)
                  .post<HttpReply>("/graphql",
                                   GraphQLBody{R"(query { account(name: "nobody") { account } })"})
                  .status == HttpStatus::ok);

   // A key no verifier accepts is refused before anything is signed.
   {
      auto bad = owner.bytes();
      bad.push_back(0);
      auto reply = f.as(guest).post<HttpReply>(
          "/create", CreateRequest{"newcomer1", {bad, 1}, {active.bytes(), 2}});
      CHECK(reply.status == HttpStatus::badRequest);
      reply = f.as(guest).post<HttpReply>(
          "/create", CreateRequest{"newcomer1", {owner.bytes(), 1}, {{}, 2}});
      CHECK(reply.status == HttpStatus::badRequest);
   }

   // The sequence values may be written as numbers or as decimal strings.
   auto body = std::format(
       R"({{"name":"newcomer1","owner":{{"key":"{}","seq":"18446744073709551615"}},"active":{{"key":"{}","seq":7}}}})",
       hex(owner.bytes()), hex(active.bytes()));
   auto issued = f.as(guest).post<IssuedTransaction>("/create", RawJson{body});
   // Held for this guest until it lands
   CHECK(f.status(guest).link->pending == name);
   f.push(issued);

   auto record = f.record(name);
   CHECK(record.owner.key == owner.pub);
   CHECK(record.owner.seq == 18446744073709551615ull);
   CHECK(record.active.key == active.pub);
   CHECK(record.active.seq == 7);
   // The sponsor created it, and so is its recovery partner.
   CHECK(record.partner == sponsor);
   // Neither key is the guest's.
   CHECK(record.owner.key != guest.pub);
   CHECK(record.active.key != guest.pub);

   auto status = f.status(guest);
   REQUIRE(status.link);
   CHECK(status.link->account == name);
   CHECK(!status.link->pending);
   CHECK(status.accounts == std::vector{name});
   CHECK(!status.recovery);

   // One account per provider identity
   {
      Key  o, a;
      auto reply = f.as(guest).post<HttpReply>(
          "/create", CreateRequest{"another01", {o.bytes(), 1}, {a.bytes(), 2}});
      CHECK(reply.status == HttpStatus::conflict);
   }

   // The account is still this guest's while it is paused or frozen.
   transactor<AuthSig::AuthSig> as{name, AuthSig::AuthSig::service};
   f.act(as.pause(), owner);
   CHECK(f.record(name).state == AccountState::paused);
   CHECK(f.status(guest).accounts == std::vector{name});
   f.act(as.freeze(), owner);
   CHECK(f.status(guest).accounts == std::vector{name});

   // What the guest used of the node became the account's, once.
   auto usage = f.t.http(XUsage::service).get<UsagePage>("/all");
   const UsageLine* guestRow   = nullptr;
   const UsageLine* accountRow = nullptr;
   for (auto& row : usage.rows)
   {
      if (row.identity == guest.id && row.kind == UsageKind::guest)
         guestRow = &row;
      if (row.identity == name.str() && row.kind == UsageKind::account)
         accountRow = &row;
   }
   REQUIRE(guestRow);
   CHECK(guestRow->requests == 2);
   CHECK(guestRow->carried_to == name);
   REQUIRE(accountRow);
   CHECK(accountRow->requests == 2);
   CHECK(accountRow->request_bytes == guestRow->request_bytes);
   CHECK(accountRow->response_bytes == guestRow->response_bytes);
   CHECK(accountRow->first_seen == guestRow->first_seen);
}

TEST_CASE("x-signup: a creation that is taken by another owner key is not this guest's")
{
   Fixture f;
   auto    guest = TestGuest::login(f.t);
   Key     owner, active, thief;
   auto    name = AccountNumber{"contested1"};
   f.link(guest);
   auto issued = f.as(guest).post<IssuedTransaction>(
       "/create", CreateRequest{"contested1", {owner.bytes(), 1}, {active.bytes(), 2}});
   // Somebody else creates the name first, with another owner key.
   REQUIRE(f.t.to<AuthSig::AuthSig>()
               .newAccount(name, KeySpec::of(thief.pub), KeySpec::of(thief.pub))
               .succeeded());
   auto status = f.status(guest);
   CHECK(status.accounts.empty());
   CHECK(!status.link->account);
   CHECK(!status.link->pending);
}

TEST_CASE("x-signup: encrypted account lists")
{
   Fixture     f;
   auto        guest   = TestGuest::login(f.t);
   auto        other   = TestGuest::login(f.t);
   std::string locator = std::string(62, 'a') + "07";
   auto        path    = "/list/" + locator;
   auto        client  = [&] { return f.t.http(XSignup::service); };

   auto blobOf = [](char fill) { return std::vector<char>(4096, fill); };
   auto message = [&](std::string_view loc, std::uint64_t version, const std::vector<char>& blob)
   {
      auto hash = sha256(blob.data(), blob.size());
      return std::format("psibase account list\n{}\n{}\n{}", loc, version,
                         hex({reinterpret_cast<const char*>(hash.data()), hash.size()}));
   };
   auto write = [&](const Guest& signer, std::uint64_t version, const std::vector<char>& blob,
                    const Guest* claimed = nullptr)
   {
      return client().put<HttpReply>(
          path, ListWrite{blob, (claimed ? *claimed : signer).keyBytes(), version,
                          signer.sign(message(locator, version, blob))});
   };

   // Nothing there yet. Reading needs no session.
   CHECK(client().get<HttpReply>(path).status == HttpStatus::notFound);
   CHECK(client().get<HttpReply>("/list/xyz").status == HttpStatus::badRequest);
   CHECK(client().get<HttpReply>("/list/" + std::string(64, 'A')).status ==
         HttpStatus::badRequest);

   // The size is fixed.
   CHECK(write(guest, 1, std::vector<char>(4095, 'x')).status == HttpStatus::badRequest);
   CHECK(write(guest, 1, std::vector<char>(4097, 'x')).status == HttpStatus::badRequest);
   CHECK(write(guest, 1, {}).status == HttpStatus::badRequest);
   CHECK(client().get<HttpReply>(path).status == HttpStatus::notFound);

   // The signature must be the named key's, over this locator, version and blob.
   CHECK(write(other, 1, blobOf('x'), &guest).status != HttpStatus::ok);
   {
      // signed for another version
      auto reply = client().put<HttpReply>(
          path, ListWrite{blobOf('x'), guest.keyBytes(), 2,
                          guest.sign(message(locator, 1, blobOf('x')))});
      CHECK(reply.status != HttpStatus::ok);
      // for another blob
      reply = client().put<HttpReply>(
          path, ListWrite{blobOf('x'), guest.keyBytes(), 1,
                          guest.sign(message(locator, 1, blobOf('y')))});
      CHECK(reply.status != HttpStatus::ok);
      // for another locator
      reply = client().put<HttpReply>(
          path, ListWrite{blobOf('x'), guest.keyBytes(), 1,
                          guest.sign(message(std::string(64, 'b'), 1, blobOf('x')))});
      CHECK(reply.status != HttpStatus::ok);
      // a signature of the wrong length
      reply = client().put<HttpReply>(
          path, ListWrite{blobOf('x'), guest.keyBytes(), 1, std::vector<char>(63, 1)});
      CHECK(reply.status == HttpStatus::badRequest);
   }
   CHECK(client().get<HttpReply>(path).status == HttpStatus::notFound);

   // The first write binds the locator to its key.
   REQUIRE(write(guest, 1, blobOf('x')).status == HttpStatus::ok);
   auto stored = client().get<ListReply>(path);
   CHECK(stored.version == 1);
   CHECK(stored.blob == blobOf('x'));

   // Another key cannot replace it, whatever the version.
   CHECK(write(other, 2, blobOf('z')).status == HttpStatus::forbidden);
   // The same key must raise the version.
   CHECK(write(guest, 1, blobOf('y')).status == HttpStatus::conflict);
   CHECK(write(guest, 0, blobOf('y')).status == HttpStatus::conflict);
   CHECK(client().get<ListReply>(path).blob == blobOf('x'));
   REQUIRE(write(guest, 5, blobOf('y')).status == HttpStatus::ok);
   stored = client().get<ListReply>(path);
   CHECK(stored.version == 5);
   CHECK(stored.blob == blobOf('y'));
   // Not back down
   CHECK(write(guest, 4, blobOf('x')).status == HttpStatus::conflict);

   // Another locator is another list, and may be anybody's.
   locator = std::string(64, 'c');
   path    = "/list/" + locator;
   REQUIRE(write(other, 1, blobOf('o')).status == HttpStatus::ok);
   CHECK(client().get<ListReply>(path).blob == blobOf('o'));
   CHECK(client().get<ListReply>("/list/" + std::string(62, 'a') + "07").blob == blobOf('y'));

   // Only the supervisor's pages may read the replies.
   auto reply = f.t.http(XSignup::service)
                    .header("Origin", "https://supervisor.psibase.io")
                    .get<HttpReply>(path);
   auto allowed = [](const HttpReply& r) -> std::string
   {
      for (auto& h : r.headers)
         if (h.matches("access-control-allow-origin"))
            return h.value;
      return {};
   };
   CHECK(allowed(reply) == "https://supervisor.psibase.io");
   reply = f.t.http(XSignup::service)
               .header("Origin", "https://evil.psibase.io")
               .get<HttpReply>(path);
   CHECK(allowed(reply).empty());
}

TEST_CASE("x-signup: the sponsor acts as recovery partner for a user who signs in again")
{
   Fixture f;
   auto    guest = TestGuest::login(f.t);
   Key     owner, active;
   auto    name = AccountNumber{"recoverme"};
   f.create(guest, "recoverme", owner, active);
   transactor<AuthSig::AuthSig> as{name, AuthSig::AuthSig::service};

   // The user comes back with another passkey: another guest.
   auto again = TestGuest::login(f.t);
   REQUIRE(again.id != guest.id);

   auto partner = [&](const Guest& g, const std::string& what, PartnerRequest request)
   { return f.as(g).post<HttpReply>("/partner/" + what, request); };

   f.act(as.pause(), owner);
   REQUIRE(f.record(name).state == AccountState::paused);

   // Nothing without a grant
   CHECK(partner(again, "end-pause", {name}).status == HttpStatus::forbidden);
   CHECK(partner(guest, "end-pause", {name}).status == HttpStatus::forbidden);
   // nor without a session
   CHECK(f.t.http(XSignup::service)
             .post<HttpReply>("/partner/end-pause", PartnerRequest{name})
             .status == HttpStatus::unauthorized);
   CHECK(!f.status(again).recovery);

   // A sign-in for an account that was not created with it earns nothing.
   Key stranger;
   auto notOurs = AccountNumber{"notsignup"};
   REQUIRE(f.t.to<AuthSig::AuthSig>()
               .newAccount(notOurs, KeySpec::of(stranger.pub), KeySpec::of(stranger.pub))
               .succeeded());
   CHECK(f.recover(again, notOurs).status == HttpStatus::forbidden);
   CHECK(f.recover(again, AccountNumber{"nosuchacct"}).status == HttpStatus::forbidden);
   CHECK(!f.status(again).recovery);
   // A recovery needs to say for which account.
   CHECK(f.as(again)
             .post<HttpReply>("/oauth/start",
                              StartRequest{.provider = "dev", .purpose = "recover"})
             .status == HttpStatus::badRequest);

   // Signing in again with the identity the account was created with does.
   {
      auto reply = f.recover(again, name);
      REQUIRE(reply.status == HttpStatus::ok);
      auto granted = psio::from_ijson<StartReply>(std::string(reply.body.begin(), reply.body.end()));
      REQUIRE(granted.recovery);
      CHECK(granted.recovery->account == name);
      CHECK(granted.recovery->valid_seconds > 500);
      CHECK(granted.recovery->valid_seconds <= 600);
   }
   auto held = f.status(again).recovery;
   REQUIRE(held);
   CHECK(held->account == name);
   // The grant is the guest's who earned it, and for that account only.
   CHECK(!f.status(guest).recovery);
   CHECK(partner(guest, "end-pause", {name}).status == HttpStatus::forbidden);
   CHECK(partner(again, "end-pause", {notOurs}).status == HttpStatus::forbidden);

   // What the account is not waiting for is refused, and costs nothing.
   CHECK(partner(again, "confirm", {name}).status == HttpStatus::conflict);
   CHECK(partner(again, "reject", {name}).status == HttpStatus::conflict);
   CHECK(partner(again, "unfreeze", {name, KeyInput{owner.bytes(), 1}, KeyInput{active.bytes(), 1}})
             .status == HttpStatus::conflict);
   REQUIRE(f.status(again).recovery);

   // The sponsor ends the pause.
   {
      auto reply = partner(again, "end-pause", {name});
      REQUIRE(reply.status == HttpStatus::ok);
      f.push(psio::from_ijson<IssuedTransaction>(std::string(reply.body.begin(), reply.body.end())));
   }
   CHECK(f.record(name).state == AccountState::normal);
   // One transaction per grant
   CHECK(!f.status(again).recovery);
   f.act(as.pause(), owner);
   CHECK(partner(again, "end-pause", {name}).status == HttpStatus::forbidden);
   REQUIRE(f.recover(again, name).status == HttpStatus::ok);
   {
      auto reply = partner(again, "end-pause", {name});
      REQUIRE(reply.status == HttpStatus::ok);
      f.push(psio::from_ijson<IssuedTransaction>(std::string(reply.body.begin(), reply.body.end())));
   }

   auto issue = [&](const std::string& what, PartnerRequest request)
   {
      REQUIRE(f.recover(again, name).status == HttpStatus::ok);
      auto reply = partner(again, what, std::move(request));
      INFO(errorOf(reply));
      REQUIRE(reply.status == HttpStatus::ok);
      f.push(psio::from_ijson<IssuedTransaction>(std::string(reply.body.begin(), reply.body.end())));
   };

   // A pending owner change: rejected, then confirmed.
   Key owner2, active2;
   f.act(as.requestOwnerChange(KeySpec{owner2.pub, 3, {}}, KeySpec{active2.pub, 4, {}}), owner);
   // A pause with a change pending is not ended; the change is decided.
   REQUIRE(f.recover(again, name).status == HttpStatus::ok);
   CHECK(partner(again, "end-pause", {name}).status == HttpStatus::conflict);
   issue("reject", {name});
   CHECK(f.record(name).state == AccountState::normal);
   CHECK(f.record(name).owner.key == owner.pub);

   f.act(as.requestOwnerChange(KeySpec{owner2.pub, 3, {}}, KeySpec{active2.pub, 4, {}}), owner);
   issue("confirm", {name});
   auto record = f.record(name);
   CHECK(record.state == AccountState::normal);
   CHECK(record.owner.key == owner2.pub);
   CHECK(record.active.key == active2.pub);
   // Confirmed by the partner: the old owner key has no window.
   CHECK(record.priorOwners.empty());
   // The account is still this identity's, with its new owner key.
   CHECK(f.status(guest).accounts == std::vector{name});

   // A freeze, released with new keys.
   transactor<AuthSig::AuthSig> as2{name, AuthSig::AuthSig::service};
   f.act(as2.freeze(), owner2);
   REQUIRE(f.record(name).state == AccountState::frozen);
   Key owner3, active3;
   // Both keys are needed, and must be keys.
   REQUIRE(f.recover(again, name).status == HttpStatus::ok);
   CHECK(partner(again, "unfreeze", {name}).status == HttpStatus::badRequest);
   CHECK(partner(again, "unfreeze", {name, KeyInput{owner3.bytes(), 1}}).status ==
         HttpStatus::badRequest);
   issue("unfreeze", {name, KeyInput{owner3.bytes(), 21}, KeyInput{active3.bytes(), 22}});
   record = f.record(name);
   CHECK(record.state == AccountState::normal);
   CHECK(record.owner.key == owner3.pub);
   CHECK(record.owner.seq == 21);
   CHECK(record.active.key == active3.pub);
   CHECK(record.active.seq == 22);

   // Once the sponsor is no longer the account's partner, it does nothing for it.
   transactor<AuthSig::AuthSig> as3{name, AuthSig::AuthSig::service};
   f.act(as3.requestPartnerChange(std::nullopt), owner3);
   issue("confirm", {name});
   CHECK(!f.record(name).partner);
   f.act(as3.pause(), owner3);
   REQUIRE(f.recover(again, name).status == HttpStatus::ok);
   {
      auto reply = partner(again, "end-pause", {name});
      CHECK(reply.status == HttpStatus::forbidden);
      CHECK(errorOf(reply).find("not that account's recovery partner") != std::string::npos);
   }
   CHECK(f.record(name).state == AccountState::paused);
}

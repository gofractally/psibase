#include <services/system/AuthSig.hpp>

#include <algorithm>
#include <concepts>
#include <psibase/dispatch.hpp>
#include <psibase/verifier.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/Spki.hpp>
#include <services/system/StagedTx.hpp>
#include <services/system/Transact.hpp>

using namespace psibase;

// How authorization is decided
// ----------------------------
// Two places decide, and both must agree for a control action to happen.
//
// 1. checkAuthSys, which transact calls before each action of a transaction
//    with the transaction's claims. It decides from the strongest key the
//    claims count for, the state of the account, and the action.
//
// 2. The control actions themselves. Each looks at the claims of the
//    transaction it is running in and requires the key it needs (authority,
//    below). checkAuthSys is not the only way an action of this service can
//    come to run with an account as its sender: transact::runAs, a staged
//    transaction, or a privileged service can call it without checkAuthSys
//    having seen that action. Whatever the route, the control action runs
//    only if the transaction around it was signed with the owner key (or, for
//    pause, freeze and proposeRecovery, a replaced owner key).
//
// Indirect routes that were traced, and how each is closed:
// - transact::runAs sent by the account itself needs no further
//   authorization in transact, and could name any action. checkAuthSys
//   therefore counts transact::runAs as a control action: the active key
//   cannot send it. A service other than the account cannot runAs an
//   auth-sig account at all unless such an outer runAs allowed it, because
//   isAuthSys is false for a service that is not the account.
// - staged-tx executes an accepted transaction's actions as their senders
//   when isAuthSys says the accepters suffice. isAuthSys is false for every
//   control action (and for transact::runAs and accounts::setAuthServ), so a
//   transaction staged and accepted with the active key cannot perform one.
// - accounts::setAuthServ is not an action of this service, so rule 2 cannot
//   apply to it; rule 1 and isAuthSys cover the three routes above.
//
// Open
// ----
// - accounts::setAuthServ needs the owner key but is immediate: one
//   owner-level action can move the account to another auth service and so
//   out of reach of pause and freeze. Making it a pending change means
//   accounts asking the current auth service before it changes; that is a
//   change to accounts and is not made here.
// - An account created by a service (invite) has that service as its
//   recovery partner, and the service does not act as one.

namespace SystemService
{
   namespace AuthSig
   {
      namespace
      {
         TimePointSec currentTime()
         {
            return std::chrono::time_point_cast<Seconds>(getStatus().current.time);
         }

         // A key is stored only with a verifier that accepts it; otherwise
         // nothing could ever authorize with it.
         AuthKey resolve(KeySpec spec)
         {
            auto defaultVerifier = verifierFor(spec.key.data);
            check(defaultVerifier.has_value(), "unsupported public key");
            auto verifier = spec.verifier.value_or(*defaultVerifier);
            check(isAllowedVerifier(verifier, spec.key.data),
                  "verifier is not allowed for this type of key");
            return AuthKey{.verifier = verifier, .key = std::move(spec.key), .seq = spec.seq};
         }

         constexpr MethodNumber setActiveMethod{"setActive"};
         constexpr MethodNumber requestOwnerChangeMethod{"requestOwnerChange"};
         constexpr MethodNumber requestPartnerChangeMethod{"requestPartnerChange"};
         constexpr MethodNumber requestDelaysMethod{"requestDelays"};
         constexpr MethodNumber setKeysMethod{"setKeys"};
         constexpr MethodNumber pauseMethod{"pause"};
         constexpr MethodNumber freezeMethod{"freeze"};
         constexpr MethodNumber proposeRecoveryMethod{"proposeRecovery"};

         // The actions that change who controls the account, or could be used
         // to reach one that does. Only the owner key authorizes them (pause,
         // freeze and proposeRecovery also accept a replaced owner key).
         bool isControlAction(const ServiceMethod& action)
         {
            if (action.service == AuthSig::service)
               return action.method == setActiveMethod ||
                      action.method == requestOwnerChangeMethod ||
                      action.method == requestPartnerChangeMethod ||
                      action.method == requestDelaysMethod || action.method == setKeysMethod ||
                      action.method == pauseMethod || action.method == freezeMethod ||
                      action.method == proposeRecoveryMethod;
            if (action.service == Accounts::service)
               return action.method == MethodNumber{"setAuthServ"};
            if (action.service == Transact::service)
               return action.method == MethodNumber{"runAs"};
            return false;
         }

         bool isMethod(const ServiceMethod& action, MethodNumber method)
         {
            return action.service == AuthSig::service && action.method == method;
         }

         enum class Role
         {
            none,
            active,
            // A replaced owner key still in the record
            prior,
            owner,
         };
         struct Authority
         {
            Role        role  = Role::none;
            std::size_t prior = 0;  // index in priorOwners, if role == prior
         };

         template <typename Key, typename Claims>
         bool claimed(const Key& key, const Claims& claims)
         {
            for (const auto& claim : claims)
            {
               AccountNumber service = claim.service;
               if (service != key.verifier)
                  continue;
               const auto& raw = claim.rawData;
               if (raw.size() == key.key.data.size() &&
                   std::memcmp(raw.data(), key.key.data.data(), raw.size()) == 0)
                  return true;
            }
            return false;
         }

         // The strongest key of the account that the claims count for. A
         // claim counts for a key only if it carries exactly that key and
         // names the verifier stored with it.
         template <typename Claims>
         Authority authority(const AuthRecord& r, const Claims& claims)
         {
            if (claimed(r.owner, claims))
               return {Role::owner, 0};
            for (std::size_t i = 0; i < r.priorOwners.size(); ++i)
               if (claimed(r.priorOwners[i], claims))
                  return {Role::prior, i};
            if (claimed(r.active, claims))
               return {Role::active, 0};
            return {};
         }

         // The claims of the transaction that the current action is part of.
         // An action that needs a particular key has none outside a transaction.
         std::vector<Claim> transactionClaims()
         {
            Actor<Transact> transact{AuthSig::service, Transact::service};
            check(transact.isTransaction(), "this action must be part of a signed transaction");
            return transact.getTransaction().claims;
         }

         struct Loaded
         {
            AuthSig::AuthTable table;
            AuthRecord         record;  // as of now
            TimePointSec       now;
         };

         Loaded load(AccountNumber account, const char* missing = "account has no keys")
         {
            auto table = AuthSig{}.open<AuthSig::AuthTable>(KvMode::readWrite);
            auto row   = table.getIndex<0>().get(account);
            check(row.has_value(), missing);
            auto now = currentTime();
            return Loaded{std::move(table), effective(std::move(*row), now), now};
         }

         // The sender's record and the key the transaction was signed with
         struct Own : Loaded
         {
            Authority authority;
         };
         Own loadOwn()
         {
            Own result{load(getSender())};
            result.authority = authority(result.record, transactionClaims());
            return result;
         }

         void requireOwner(const Own& own)
         {
            check(own.authority.role == Role::owner, "this action requires the owner key");
         }
         void requireNormal(const AuthRecord& r)
         {
            check(r.state != AccountState::paused, "account is paused");
            check(r.state != AccountState::frozen, "account is frozen");
         }
         void requirePartner(const AuthRecord& r)
         {
            check(r.partner.has_value() && *r.partner == getSender(),
                  "sender is not the recovery partner of this account");
         }

         void eraseRecoveryRequests(AccountNumber account)
         {
            auto table = AuthSig{}.open<AuthSig::RecoveryTable>(KvMode::readWrite);
            std::vector<RecoveryRequest> rows;
            for (auto row : table.getIndex<0>().subindex(account))
               rows.push_back(std::move(row));
            for (auto& row : rows)
               table.remove(row);
         }

         // A pending change pauses the account.
         void request(Own& own, PendingChange change)
         {
            requireOwner(own);
            requireNormal(own.record);
            change.requested   = own.now;
            own.record.pending = std::move(change);
            beginPause(own.record, own.now);
            own.table.put(own.record);
         }

         void install(Loaded& account, AuthKey owner, AuthKey active)
         {
            auto& r  = account.record;
            r.owner  = std::move(owner);
            r.active = std::move(active);
            r.priorOwners.clear();
            r.pending.reset();
            r.state = AccountState::normal;
            r.stateSince.reset();
            r.stateUntil.reset();
            account.table.put(r);
            eraseRecoveryRequests(r.account);
         }
      }  // namespace

      bool AuthSig::checkAuthSys(uint32_t                    flags,
                                 psibase::AccountNumber      sender,
                                 ServiceMethod               action,
                                 std::vector<psibase::Claim> claims)
      {
         auto row = open<AuthTable>(KvMode::read).getIndex<0>().get(sender);
         check(row.has_value(), "sender does not have a public key");

         auto r   = effective(std::move(*row), currentTime());
         auto key = authority(r, claims);
         // An owner key, current or replaced
         bool anyOwner = key.role == Role::owner || key.role == Role::prior;

         switch (r.state)
         {
            case AccountState::normal:
               switch (key.role)
               {
                  case Role::owner:
                     return true;
                  case Role::active:
                     return !isControlAction(action);
                  case Role::prior:
                     return isMethod(action, freezeMethod) ||
                            (isMethod(action, pauseMethod) && !r.priorOwners[key.prior].paused);
                  case Role::none:
                     return false;
               }
               return false;
            case AccountState::paused:
               return anyOwner && isMethod(action, freezeMethod);
            case AccountState::frozen:
               return anyOwner && isMethod(action, proposeRecoveryMethod);
         }
         return false;
      }

      void AuthSig::canAuthUserSys(psibase::AccountNumber user)
      {
         // Anyone with keys in the AuthTable may use AuthSig
         auto row = open<AuthTable>(KvMode::read).getIndex<0>().get(user);
         check(row.has_value(), "sender does not have a public key");
      }

      void AuthSig::newAccount(psibase::AccountNumber name, KeySpec owner, KeySpec active)
      {
         auto authTable = open<AuthTable>(KvMode::readWrite);
         authTable.put(AuthRecord{
             .account = name,
             .owner   = resolve(std::move(owner)),
             .active  = resolve(std::move(active)),
             .partner = getSender(),
         });
         // Aborts, and with it the record above, if the account exists.
         to<Accounts>().newAccount(name, AuthSig::service, NewAccountMode::requireNew);
         eraseRecoveryRequests(name);
      }

      void AuthSig::setKeys(KeySpec owner, KeySpec active)
      {
         auto sender = getSender();
         // An account that uses this service changes its keys through the
         // owner key and the pending path, never by overwriting the record.
         check(to<Accounts>().getAuthOf(sender) != AuthSig::service,
               "account already uses auth-sig: use setActive or requestOwnerChange");
         auto authTable = open<AuthTable>(KvMode::readWrite);
         authTable.put(AuthRecord{
             .account = sender,
             .owner   = resolve(std::move(owner)),
             .active  = resolve(std::move(active)),
         });
         eraseRecoveryRequests(sender);
      }

      void AuthSig::initKeys(psibase::AccountNumber account, KeySpec owner, KeySpec active)
      {
         check(getSender() == getReceiver(), "only auth-sig itself may give an account keys");
         check(to<Accounts>().getAuthOf(account) == AuthSig::service,
               "account does not use auth-sig");
         auto ownerKey  = resolve(std::move(owner));
         auto activeKey = resolve(std::move(active));
         auto authTable = open<AuthTable>(KvMode::readWrite);
         if (auto existing = authTable.getIndex<0>().get(account))
         {
            // Never a way to change a record: only to find it as it would
            // have been written. The comparison is of the keys and the
            // partner and must stay that: the rest of a record moves by
            // other actions (nextRequestId with each recovery request, the
            // state and its times), and a package's postinstall sends this
            // action again at every upgrade. Comparing the whole record
            // would make an upgrade fail for an account that is still
            // exactly whose it was.
            check(existing->owner == ownerKey && existing->active == activeKey &&
                      !existing->partner.has_value(),
                  "account already has keys");
            return;
         }
         authTable.put(AuthRecord{
             .account = account,
             .owner   = std::move(ownerKey),
             .active  = std::move(activeKey),
         });
         eraseRecoveryRequests(account);
      }

      void AuthSig::setActive(KeySpec active)
      {
         auto own = loadOwn();
         requireOwner(own);
         requireNormal(own.record);
         own.record.active = resolve(std::move(active));
         own.table.put(own.record);
      }

      void AuthSig::requestOwnerChange(KeySpec owner, KeySpec active)
      {
         auto own = loadOwn();
         requireOwner(own);
         requireNormal(own.record);
         // Each change that takes effect unconfirmed leaves a replaced key
         // with a freeze window; see PROVISIONAL DEFAULTS in the header.
         check(own.record.priorOwners.size() < AuthRecord::maxPriorOwners,
               "too many owner key changes within the freeze window");
         request(own, PendingChange{
                          .kind   = ChangeKind::ownerKeys,
                          .owner  = resolve(std::move(owner)),
                          .active = resolve(std::move(active)),
                      });
      }

      void AuthSig::requestPartnerChange(std::optional<psibase::AccountNumber> partner)
      {
         auto own = loadOwn();
         if (partner)
         {
            check(*partner != own.record.account, "an account cannot be its own recovery partner");
            check(to<Accounts>().exists(*partner), "recovery partner does not exist");
         }
         request(own, PendingChange{.kind = ChangeKind::partner, .partner = partner});
      }

      void AuthSig::requestDelays(std::uint32_t pauseSeconds, std::uint32_t freezeSeconds)
      {
         auto own = loadOwn();
         check(pauseSeconds >= AuthRecord::minPauseSeconds &&
                   pauseSeconds <= AuthRecord::maxDelaySeconds,
               "pause length out of range");
         check(freezeSeconds >= AuthRecord::minFreezeSeconds &&
                   freezeSeconds <= AuthRecord::maxDelaySeconds,
               "freeze window out of range");
         request(own, PendingChange{.kind          = ChangeKind::delays,
                                    .pauseSeconds  = pauseSeconds,
                                    .freezeSeconds = freezeSeconds});
      }

      void AuthSig::pause()
      {
         auto own = loadOwn();
         requireNormal(own.record);
         if (own.authority.role == Role::prior)
         {
            auto& prior = own.record.priorOwners[own.authority.prior];
            check(!prior.paused, "a replaced owner key may pause only once");
            prior.paused = true;
         }
         else
            requireOwner(own);
         beginPause(own.record, own.now);
         own.table.put(own.record);
      }

      void AuthSig::freeze()
      {
         auto own = loadOwn();
         check(own.authority.role == Role::owner || own.authority.role == Role::prior,
               "this action requires an owner key");
         auto& r = own.record;
         check(r.state != AccountState::frozen, "account is frozen");
         // Whatever was pending must not take effect: the freeze may be the
         // owner's answer to exactly that request.
         r.pending.reset();
         r.state      = AccountState::frozen;
         r.stateSince = own.now;
         r.stateUntil.reset();
         own.table.put(r);
      }

      std::uint32_t AuthSig::proposeRecovery(KeySpec owner, KeySpec active)
      {
         auto own = loadOwn();
         check(own.authority.role == Role::owner || own.authority.role == Role::prior,
               "this action requires an owner key");
         auto& r = own.record;
         check(r.state == AccountState::frozen, "account is not frozen");

         AuthKey signedBy = r.owner;
         if (own.authority.role == Role::prior)
         {
            auto& prior = r.priorOwners[own.authority.prior];
            signedBy    = AuthKey{prior.verifier, prior.key, prior.seq};
         }

         auto requests = open<RecoveryTable>(KvMode::readWrite);
         // Bounded: the oldest give way.
         std::vector<RecoveryRequest> existing;
         for (auto row : requests.getIndex<0>().subindex(r.account))
            existing.push_back(std::move(row));
         for (std::size_t i = 0; i + maxRecoveryRequests <= existing.size(); ++i)
            requests.remove(existing[i]);

         auto id = r.nextRequestId++;
         requests.put(RecoveryRequest{
             .account  = r.account,
             .id       = id,
             .owner    = resolve(std::move(owner)),
             .active   = resolve(std::move(active)),
             .signedBy = std::move(signedBy),
             .time     = own.now,
         });
         own.table.put(r);
         return id;
      }

      void AuthSig::confirm(psibase::AccountNumber account)
      {
         auto a = load(account);
         requirePartner(a.record);
         check(a.record.state == AccountState::paused && a.record.pending.has_value(),
               "account has no pending change");
         applyPending(a.record, a.now, true);
         endPauseAt(a.record, a.now);
         a.table.put(a.record);
      }

      void AuthSig::reject(psibase::AccountNumber account)
      {
         auto a = load(account);
         requirePartner(a.record);
         check(a.record.state == AccountState::paused && a.record.pending.has_value(),
               "account has no pending change");
         a.record.pending.reset();
         endPauseAt(a.record, a.now);
         a.table.put(a.record);
      }

      void AuthSig::endPause(psibase::AccountNumber account)
      {
         auto a = load(account);
         requirePartner(a.record);
         check(a.record.state == AccountState::paused, "account is not paused");
         check(!a.record.pending.has_value(),
               "account has a pending change: confirm or reject it");
         endPauseAt(a.record, a.now);
         a.table.put(a.record);
      }

      void AuthSig::unfreeze(psibase::AccountNumber account, std::uint32_t requestId)
      {
         auto a = load(account);
         requirePartner(a.record);
         check(a.record.state == AccountState::frozen, "account is not frozen");
         auto request =
             open<RecoveryTable>(KvMode::read).getIndex<0>().get(std::tuple(account, requestId));
         check(request.has_value(), "recovery request not found");
         install(a, std::move(request->owner), std::move(request->active));
      }

      void AuthSig::rejectRecovery(psibase::AccountNumber account, std::uint32_t requestId)
      {
         auto a = load(account);
         requirePartner(a.record);
         auto requests = open<RecoveryTable>(KvMode::readWrite);
         auto request  = requests.getIndex<0>().get(std::tuple(account, requestId));
         check(request.has_value(), "recovery request not found");
         requests.remove(*request);
      }

      void AuthSig::unfreezeWith(psibase::AccountNumber account, KeySpec owner, KeySpec active)
      {
         auto a = load(account);
         requirePartner(a.record);
         check(a.record.state == AccountState::frozen, "account is not frozen");
         install(a, resolve(std::move(owner)), resolve(std::move(active)));
      }

      void AuthSig::refresh(psibase::AccountNumber account)
      {
         auto a = load(account);
         a.table.put(a.record);
      }

      std::optional<AuthRecord> AuthSig::getRecord(psibase::AccountNumber account)
      {
         auto row = open<AuthTable>(KvMode::read).getIndex<0>().get(account);
         if (!row)
            return std::nullopt;
         return effective(std::move(*row), currentTime());
      }

      std::vector<psibase::AccountNumber> AuthSig::getDlgsSys(psibase::AccountNumber       sender,
                                                              std::optional<ServiceMethod> method)
      {
         return {};
      }

      bool AuthSig::isAuthSys(psibase::AccountNumber              sender,
                              std::vector<psibase::AccountNumber> authorizers,
                              std::optional<ServiceMethod>        method)
      {
         if (!std::ranges::contains(authorizers, sender))
            return false;
         // The sender approved, but through a route that does not say with
         // which key. That is enough for what the active key may do, and for
         // nothing else.
         if (method && isControlAction(*method))
            return false;
         auto row = open<AuthTable>(KvMode::read).getIndex<0>().get(sender);
         if (!row)
            return false;
         return effective(std::move(*row), currentTime()).state == AccountState::normal;
      }

      bool AuthSig::isRejectSys(psibase::AccountNumber              sender,
                                std::vector<psibase::AccountNumber> rejecters,
                                std::optional<ServiceMethod>        method)
      {
         return std::ranges::contains(rejecters, sender);
      }
   }  // namespace AuthSig
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthSig::AuthSig)

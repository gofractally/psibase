#pragma once

#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/time.hpp>
#include <services/system/Transact.hpp>
#include <optional>
#include <string>
#include <string_view>
#include <tuple>
#include <vector>

#include "Spki.hpp"

// The auth service for accounts controlled by keys (gofractally/psibase #2275,
// sections 4.1 and 5).
//
// An account has two keys. The ACTIVE key authorizes ordinary actions. The
// OWNER key authorizes everything and is the only key that may change who
// controls the account. A change of the owner key is never immediate on its
// own: requesting it pauses the account, and it takes effect when the pause
// runs out or when the account's recovery partner confirms it. The replaced
// owner key can still freeze the account for a while afterwards, unless the
// partner confirmed the change. A frozen account is released only by its
// recovery partner, who installs new keys.
//
// PROVISIONAL DEFAULTS. The specification lists these as open; they are
// implemented as follows until the project owner confirms them:
// - At most three owner-key changes that leave the replaced key with a freeze
//   window may be in their windows at once: a request that would make a
//   fourth is refused. A change the recovery partner confirmed leaves no
//   such key and is not counted.
// - Clocks do not run while an account is paused or frozen: the freeze
//   windows of replaced owner keys are extended by the time spent paused.
// - Changes of the pause length and of the freeze window are pending
//   changes like the others, with the same delay.
// - Changing the account's auth service (accounts::setAuthServ) needs the
//   owner key but is immediate. See "Open" in AuthSig.cpp.

namespace SystemService
{
   namespace AuthSig
   {
      /// A key as a caller supplies it
      struct KeySpec
      {
         /// The public key
         SubjectPublicKeyInfo key;
         /// The sequence value the key was derived with. Opaque to the chain:
         /// it is stored so that a device can derive the key again.
         std::uint64_t seq = 0;
         /// The service that verifies signatures made with the key: one of the
         /// verifiers allowed for the key's type (psibase/verifier.hpp). The
         /// default for the type if absent.
         std::optional<psibase::AccountNumber> verifier;

         /// For a caller that has one key and no sequence values: used as both
         /// the owner and the active key, it gives an account that the one key
         /// controls completely.
         static KeySpec of(SubjectPublicKeyInfo key) { return KeySpec{std::move(key), 0, {}}; }
      };
      PSIO_REFLECT(KeySpec, key, seq, verifier)

      /// A key of an account
      struct AuthKey
      {
         /// The service that verifies signatures made with the key. A claim
         /// counts for this key only if it names this service.
         psibase::AccountNumber verifier;
         SubjectPublicKeyInfo   key;
         /// See KeySpec::seq
         std::uint64_t seq = 0;

         friend bool operator==(const AuthKey&, const AuthKey&) = default;
      };
      PSIO_REFLECT(AuthKey, verifier, key, seq)

      /// An owner key that was replaced without the recovery partner's
      /// confirmation. Until `expires` it may pause the account once and may
      /// freeze it.
      struct PriorOwnerKey
      {
         psibase::AccountNumber verifier;
         SubjectPublicKeyInfo   key;
         std::uint64_t          seq = 0;
         /// The end of the key's freeze window. While the account is paused
         /// this already includes the whole of the pause; while it is frozen
         /// the window does not run out.
         psibase::TimePointSec expires;
         /// Whether the key has used its one pause
         bool paused = false;
      };
      PSIO_REFLECT(PriorOwnerKey, verifier, key, seq, expires, paused)

      enum class AccountState : std::uint8_t
      {
         /// Active authorizes ordinary actions, owner everything
         normal,
         /// Nothing is authorized, except that an owner key may freeze
         paused,
         /// Nothing is authorized; only the recovery partner releases it
         frozen,
      };
      PSIO_REFLECT_ENUM(AccountState, normal, paused, frozen)

      enum class ChangeKind : std::uint8_t
      {
         ownerKeys,
         partner,
         delays,
      };
      PSIO_REFLECT_ENUM(ChangeKind, ownerKeys, partner, delays)

      /// An `AccountState` or a `ChangeKind` is one of its enumerators: any
      /// other value is refused wherever one is read or written.
      inline psio::codec_status accountStateInRange(const AccountState& state) noexcept
      {
         if (static_cast<std::uint8_t>(state) <= static_cast<std::uint8_t>(AccountState::frozen))
            return psio::codec_ok();
         return psio::codec_fail("state out of range", 0, "AccountState");
      }
      inline psio::codec_status changeKindInRange(const ChangeKind& kind) noexcept
      {
         if (static_cast<std::uint8_t>(kind) <= static_cast<std::uint8_t>(ChangeKind::delays))
            return psio::codec_ok();
         return psio::codec_fail("kind out of range", 0, "ChangeKind");
      }
   }  // namespace AuthSig
}  // namespace SystemService

PSIO_INVARIANT(SystemService::AuthSig::AccountState, SystemService::AuthSig::accountStateInRange)
PSIO_INVARIANT(SystemService::AuthSig::ChangeKind, SystemService::AuthSig::changeKindInRange)

namespace SystemService
{
   namespace AuthSig
   {

      /// A change that was requested and has not taken effect. The account is
      /// paused while it is pending. It takes effect when the pause runs out
      /// (`AuthRecord::stateUntil`) or when the recovery partner confirms it.
      struct PendingChange
      {
         ChangeKind kind = ChangeKind::ownerKeys;
         /// ownerKeys: the new keys
         std::optional<AuthKey> owner;
         std::optional<AuthKey> active;
         /// partner: the new recovery partner, or nothing for none
         std::optional<psibase::AccountNumber> partner;
         /// delays: the new pause length and freeze window, in seconds
         std::optional<std::uint32_t> pauseSeconds;
         std::optional<std::uint32_t> freezeSeconds;
         /// When it was requested
         psibase::TimePointSec requested;
      };
      PSIO_REFLECT(PendingChange,
                   kind,
                   owner,
                   active,
                   partner,
                   pauseSeconds,
                   freezeSeconds,
                   requested)

      /// The record of an account.
      ///
      /// There are no timers. What is stored is the record as it was last
      /// written; a pause that has since run out, the pending change that
      /// took effect with it, and replaced owner keys whose windows have
      /// ended are applied whenever the record is next used. `effective`
      /// (AuthSig.cpp) does this, and everything that decides or reports
      /// goes through it: the queries report the record as of the current
      /// block, not as stored.
      struct AuthRecord
      {
         psibase::AccountNumber account;

         /// Authorizes everything, and is the only key accepted for the
         /// actions that change who controls the account
         AuthKey owner;
         /// Authorizes ordinary actions
         AuthKey active;

         /// The account that may confirm or reject a pending change, end a
         /// pause, and release a freeze. By default the account that created
         /// this one.
         std::optional<psibase::AccountNumber> partner;
         /// How long a pause lasts, in seconds
         std::uint32_t pauseSeconds = defaultPauseSeconds;
         /// For how long a replaced owner key may still freeze the account,
         /// in seconds
         std::uint32_t freezeSeconds = defaultFreezeSeconds;

         AccountState state = AccountState::normal;
         /// When the pause or freeze began
         std::optional<psibase::TimePointSec> stateSince;
         /// When the pause ends by itself. A freeze has no end.
         std::optional<psibase::TimePointSec> stateUntil;

         /// At most one
         std::optional<PendingChange> pending;

         /// Replaced owner keys still in their freeze windows
         std::vector<PriorOwnerKey> priorOwners;

         /// The id the next recovery request of this account gets
         std::uint32_t nextRequestId = 1;

         static constexpr std::uint32_t defaultPauseSeconds  = 24 * 60 * 60;
         static constexpr std::uint32_t defaultFreezeSeconds = 7 * 24 * 60 * 60;
         /// Bounds on what an account may configure. A pause has to be long
         /// enough to notice, and neither delay may be made endless.
         static constexpr std::uint32_t minPauseSeconds  = 60 * 60;
         static constexpr std::uint32_t minFreezeSeconds = 24 * 60 * 60;
         static constexpr std::uint32_t maxDelaySeconds  = 365 * 24 * 60 * 60;
         /// See PROVISIONAL DEFAULTS
         static constexpr std::size_t maxPriorOwners = 3;

         psibase::Checksum256 activeFingerprint() const { return active.key.fingerprint(); }
         psibase::Checksum256 ownerFingerprint() const { return owner.key.fingerprint(); }
         /// The partner, or the null account
         psibase::AccountNumber partnerOrNone() const
         {
            return partner.value_or(psibase::AccountNumber{});
         }
         /// The partner if, as stored, the account is paused or frozen: what
         /// a partner looks through to find the accounts waiting for it. The
         /// null account otherwise.
         psibase::AccountNumber waitingPartner() const
         {
            return state == AccountState::normal ? psibase::AccountNumber{} : partnerOrNone();
         }

         using ByActiveKey = psibase::CompositeKey<&AuthRecord::activeFingerprint, &AuthRecord::account>;
         using ByOwnerKey  = psibase::CompositeKey<&AuthRecord::ownerFingerprint, &AuthRecord::account>;
         using ByPartner   = psibase::CompositeKey<&AuthRecord::partnerOrNone, &AuthRecord::account>;
         using ByWaitingPartner =
             psibase::CompositeKey<&AuthRecord::waitingPartner, &AuthRecord::account>;
      };
      PSIO_REFLECT(AuthRecord,
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
                   nextRequestId)

      /// Keys proposed for a frozen account by a holder of one of its owner
      /// keys. The recovery partner installs them with `unfreeze`.
      struct RecoveryRequest
      {
         psibase::AccountNumber account;
         std::uint32_t          id = 0;
         AuthKey                owner;
         AuthKey                active;
         /// The owner key, current or replaced, that signed the proposal
         AuthKey               signedBy;
         psibase::TimePointSec time;

         using Key = psibase::CompositeKey<&RecoveryRequest::account, &RecoveryRequest::id>;
      };
      PSIO_REFLECT(RecoveryRequest, account, id, owner, active, signedBy, time)

      /// The `auth-sig` service authenticates the actions of accounts that are
      /// controlled by keys. See the top of this file.
      ///
      /// This service supports K1 or R1 keys (Secp256K1 or Secp256R1) keys.
      class AuthSig : public psibase::Service
      {
        public:
         static constexpr auto service = psibase::AccountNumber("auth-sig");
         using AuthTable = psibase::Table<AuthRecord,
                                          &AuthRecord::account,
                                          AuthRecord::ByActiveKey{},
                                          AuthRecord::ByOwnerKey{},
                                          AuthRecord::ByPartner{},
                                          AuthRecord::ByWaitingPartner{}>;
         using RecoveryTable = psibase::Table<RecoveryRequest, RecoveryRequest::Key{}>;
         using Tables        = psibase::ServiceTables<AuthTable, RecoveryTable>;

         /// The most recovery requests kept for one account. A further one
         /// replaces the oldest.
         static constexpr std::size_t maxRecoveryRequests = 8;

         /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
         ///
         /// This action is automatically called by `transact` when an account using this auth service submits a
         /// transaction.
         ///
         /// A claim counts for a key of the account if it carries exactly that key and names
         /// the verifier stored with it. What is authorized depends on the strongest key the
         /// claims count for, the state of the account, and the action:
         ///
         /// - normal: the owner key authorizes everything. The active key authorizes every
         ///   action that is not a control action. A replaced owner key still in its freeze
         ///   window authorizes `pause` (once) and `freeze`.
         /// - paused: the owner key and replaced owner keys in their windows authorize `freeze`.
         ///   Nothing else is authorized.
         /// - frozen: the owner key and replaced owner keys authorize `proposeRecovery`.
         ///   Nothing else is authorized.
         ///
         /// The control actions are those of this service that change who controls the
         /// account (`setActive`, `requestOwnerChange`, `requestPartnerChange`,
         /// `requestDelays`, `setKeys`, `pause`, `freeze`, `proposeRecovery`), and
         /// `accounts::setAuthServ` and `transact::runAs`.
         bool checkAuthSys(uint32_t                    flags,
                           psibase::AccountNumber      sender,
                           ServiceMethod               action,
                           std::vector<psibase::Claim> claims);

         /// This is an implementation of the standard auth service interface defined in [SystemService::AuthInterface]
         ///
         /// This action is automatically called by `accounts` when an account is configured to use this auth service.
         ///
         /// This action allows any user who has keys in this service.
         void canAuthUserSys(psibase::AccountNumber user);

         /// Create a new account using this auth service, with the specified keys.
         ///
         /// The sender becomes the account's recovery partner. A caller that has a single
         /// key passes it as both (`KeySpec::of`).
         void newAccount(psibase::AccountNumber name, KeySpec owner, KeySpec active);

         /// Store the sender's keys, for an account that does not use this auth service.
         ///
         /// This is how an existing account comes to use this service: `setKeys`, then
         /// `accounts::setAuthServ`. The account gets no recovery partner. An account that
         /// already uses this service changes its keys with `setActive` and
         /// `requestOwnerChange`.
         void setKeys(KeySpec owner, KeySpec active);

         /// By this service's own account: give keys to `account`, which uses this auth
         /// service and has no keys here. The account gets no recovery partner.
         ///
         /// This is general: it applies to any account that points at this service and has
         /// no record yet, whatever its name. Such an account exists only when
         /// `accounts::newAccount` was called directly with this service as the auth service
         /// (`accounts::setAuthServ` refuses an account that has no keys here); until it has
         /// keys nothing can authorize it. Whoever controls this service's account could
         /// do as much without this action, by replacing the service's code.
         ///
         /// It is how an account is created whose keys nobody holds and whose creator is
         /// not its recovery partner: `newAccount` would make the sender the partner, and
         /// `setKeys` has to be sent by the account. A record that exists is never changed:
         /// if `account` already has exactly these keys and no recovery partner, nothing
         /// happens, so the action may be repeated; with other keys or a partner it fails.
         void initKeys(psibase::AccountNumber account, KeySpec owner, KeySpec active);

         /// Replace the sender's active key. Owner key only. Immediate.
         void setActive(KeySpec active);

         /// Request new owner and active keys for the sender. Owner key only.
         ///
         /// The account is paused and the change is pending. It takes effect when the pause
         /// runs out, after which the replaced owner key may still freeze the account for the
         /// freeze window, or at once when the recovery partner confirms it, after which the
         /// replaced owner key has no power.
         void requestOwnerChange(KeySpec owner, KeySpec active);

         /// Request a new recovery partner for the sender, or none. Owner key only.
         /// Pending in the same way as an owner-key change.
         void requestPartnerChange(std::optional<psibase::AccountNumber> partner);

         /// Request a new pause length and freeze window for the sender, in seconds.
         /// Owner key only. Pending in the same way as an owner-key change.
         void requestDelays(std::uint32_t pauseSeconds, std::uint32_t freezeSeconds);

         /// Pause the sender: nothing is authorized until the pause length has passed.
         ///
         /// With the owner key, or with a replaced owner key still in its freeze window,
         /// which may do this once. No key of the account ends a pause early.
         void pause();

         /// Freeze the sender: nothing is authorized until the recovery partner installs
         /// new keys. An account with no recovery partner stays frozen.
         ///
         /// With the owner key or a replaced owner key still in its freeze window, while the
         /// account is normal or paused. A pending change is dropped.
         void freeze();

         /// Propose new keys for the sender, which must be frozen. With the owner key or a
         /// replaced owner key. Returns the id of the recovery request, which the recovery
         /// partner passes to `unfreeze`.
         std::uint32_t proposeRecovery(KeySpec owner, KeySpec active);

         /// By the recovery partner of `account`: the pending change takes effect now and
         /// the pause ends. After an owner-key change confirmed in this way the replaced
         /// owner key has no freeze window.
         void confirm(psibase::AccountNumber account);

         /// By the recovery partner of `account`: the pending change is dropped and the
         /// pause ends.
         void reject(psibase::AccountNumber account);

         /// By the recovery partner of `account`: end a pause that has no pending change.
         void endPause(psibase::AccountNumber account);

         /// By the recovery partner of `account`, which must be frozen: install the keys
         /// of a recovery request. Replaced owner keys, the other requests and any pending
         /// change are cleared and the account is normal again.
         void unfreeze(psibase::AccountNumber account, std::uint32_t requestId);

         /// By the recovery partner of `account`: drop a recovery request.
         void rejectRecovery(psibase::AccountNumber account, std::uint32_t requestId);

         /// By the recovery partner of `account`, which must be frozen: install these
         /// keys, as `unfreeze` does. For a partner that knows the user by other means than
         /// a recovery request.
         void unfreezeWith(psibase::AccountNumber account, KeySpec owner, KeySpec active);

         /// Write `account`'s record as it is now: transitions that are due (a pause that
         /// has run out, the change that took effect with it, expired replaced keys) are
         /// stored. Changes nothing that the queries report. Anyone may call it.
         void refresh(psibase::AccountNumber account);

         /// The record of `account` as of the current block (every transition that is due
         /// applied), or nothing if it has no keys here. For services, which cannot read
         /// this service's tables: who an account's keys and recovery partner are does not
         /// depend on whether it is paused or frozen.
         std::optional<AuthRecord> getRecord(psibase::AccountNumber account);

         /// Get the accounts this auth service delegates authority to for a sender: none.
         std::vector<psibase::AccountNumber> getDlgsSys(psibase::AccountNumber       sender,
                                                        std::optional<ServiceMethod> method);

         /// Check whether a specified set of authorizer accounts are sufficient to authorize sending a
         /// transaction from a specified sender.
         ///
         /// * `sender`: The sender account for the transaction potentially being authorized.
         /// * `authorizers`: The set of accounts that have already authorized the execution of the transaction.
         /// * `method`: The service and method being authorized.
         ///
         /// Returns `true` only if the sender is among the authorizers, the account is in
         /// its normal state, and `method` is not a control action. An approval given this
         /// way (a staged transaction) says nothing about which key gave it, so it never
         /// stands in for the owner key.
         bool isAuthSys(psibase::AccountNumber              sender,
                        std::vector<psibase::AccountNumber> authorizers,
                        std::optional<ServiceMethod>        method);

         /// Check whether a specified set of rejecter accounts are sufficient to reject (cancel) a
         /// transaction from a specified sender.
         ///
         /// Returns `true` if the sender is among the rejecters.
         bool isRejectSys(psibase::AccountNumber              sender,
                          std::vector<psibase::AccountNumber> rejecters,
                          std::optional<ServiceMethod>        method);
      };
      PSIO_REFLECT(AuthSig,  //
                   method(checkAuthSys, flags, sender, action, claims),
                   method(canAuthUserSys, user),
                   method(newAccount, name, owner, active),
                   method(setKeys, owner, active),
                   method(initKeys, account, owner, active),
                   method(setActive, active),
                   method(requestOwnerChange, owner, active),
                   method(requestPartnerChange, partner),
                   method(requestDelays, pauseSeconds, freezeSeconds),
                   method(pause),
                   method(freeze),
                   method(proposeRecovery, owner, active),
                   method(confirm, account),
                   method(reject, account),
                   method(endPause, account),
                   method(unfreeze, account, requestId),
                   method(rejectRecovery, account, requestId),
                   method(unfreezeWith, account, owner, active),
                   method(refresh, account),
                   method(getRecord, account),
                   method(getDlgsSys, sender, method),
                   method(isAuthSys, sender, authorizers, method),
                   method(isRejectSys, sender, rejecters, method)
                   //
      )
      PSIBASE_REFLECT_TABLES(AuthSig, AuthSig::Tables)
      PSIO_REFLECT_TYPENAME(AuthSig::AuthTable)
      PSIO_REFLECT_TYPENAME(AuthSig::RecoveryTable)

      // The state machine of a record. These functions are the only code
      // that moves a record from one state to another; the service and the
      // query service both use them.

      /// Begins a pause at `now`. The freeze windows of replaced owner keys
      /// do not run during a pause, so they are extended by its length here
      /// and shortened again if the pause is ended early.
      inline void beginPause(AuthRecord& r, psibase::TimePointSec now)
      {
         r.state      = AccountState::paused;
         r.stateSince = now;
         r.stateUntil = now + psibase::Seconds{r.pauseSeconds};
         for (auto& prior : r.priorOwners)
            prior.expires += psibase::Seconds{r.pauseSeconds};
      }

      /// Ends a pause at `now`, at or before the time it would end by itself.
      inline void endPauseAt(AuthRecord& r, psibase::TimePointSec now)
      {
         if (r.stateUntil && now < *r.stateUntil)
            for (auto& prior : r.priorOwners)
               prior.expires -= *r.stateUntil - now;
         r.state = AccountState::normal;
         r.stateSince.reset();
         r.stateUntil.reset();
      }

      /// Makes the pending change take effect at `when`. `confirmed` is
      /// whether the recovery partner confirmed it: the owner key replaced by
      /// a confirmed change gets no freeze window.
      inline void applyPending(AuthRecord& r, psibase::TimePointSec when, bool confirmed)
      {
         if (!r.pending)
            return;
         auto& change = *r.pending;
         switch (change.kind)
         {
            case ChangeKind::ownerKeys:
               if (!confirmed)
                  r.priorOwners.push_back(PriorOwnerKey{
                      .verifier = r.owner.verifier,
                      .key      = r.owner.key,
                      .seq      = r.owner.seq,
                      .expires  = when + psibase::Seconds{r.freezeSeconds},
                      .paused   = false,
                  });
               r.owner  = *change.owner;
               r.active = *change.active;
               break;
            case ChangeKind::partner:
               r.partner = change.partner;
               break;
            case ChangeKind::delays:
               r.pauseSeconds  = *change.pauseSeconds;
               r.freezeSeconds = *change.freezeSeconds;
               break;
         }
         r.pending.reset();
      }

      /// The record of an account as of `now`: `stored` with every transition
      /// that is due applied.
      ///
      /// - A pause whose time has passed has ended, at the time it was set to
      ///   end, and the change that was pending took effect at that moment.
      /// - Replaced owner keys whose freeze windows have ended are gone. While
      ///   the account is frozen no window ends.
      inline AuthRecord effective(AuthRecord r, psibase::TimePointSec now)
      {
         if (r.state == AccountState::paused && r.stateUntil && now >= *r.stateUntil)
         {
            auto ended = *r.stateUntil;
            endPauseAt(r, ended);
            applyPending(r, ended, false);
         }
         if (r.state != AccountState::frozen)
            std::erase_if(r.priorOwners, [&](const auto& prior) { return prior.expires <= now; });
         return r;
      }
   }  // namespace AuthSig
}  // namespace SystemService

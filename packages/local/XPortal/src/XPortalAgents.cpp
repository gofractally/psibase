#include <services/local/XPortal.hpp>

#include "XPortalDetail.hpp"

#include <algorithm>
#include <functional>
#include <psibase/dispatch.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XKeys.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthScope.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/VirtualServer.hpp>
#include <services/user/Invite.hpp>
#include <services/user/Tokens.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using namespace UserService;
using UserService::InviteNs::Invite;

namespace xportal
{
   SignupView signupView(const Signup& stored)
   {
      SignupView view{.state = stored.state};
      if (stored.state == stateInvited)
         view.token = stored.token;
      return view;
   }

   // Records the chain account for every invited signup that has one.
   // An invite that is gone, or that this agent did not create, stays invited.
   void reconcileInvitedSignups()
   {
      std::vector<Signup> invited;
      PSIBASE_SUBJECTIVE_TX
      {
         invited.clear();
         for (auto row : XPortal{}.open<SignupTable>().getIndex<0>())
            if (row.state == stateInvited)
               invited.push_back(row);
      }
      for (const auto& row : invited)
      {
         auto invite = to<Invite>().getInvite(row.invite_id);
         if (!invite || invite->inviter != XPortal::creatorAccount)
            continue;
         auto accounts =
             psibase::from(XPortal::creatorAccount).to<Invite>().getNewAccts(row.invite_id);
         if (accounts.empty())
            continue;
         PSIBASE_SUBJECTIVE_TX
         {
            auto table  = XPortal{}.open<SignupTable>();
            auto stored = table.get(row.id);
            if (stored && stored->state == stateInvited)
            {
               stored->account = accounts.front();
               stored->state   = std::string{stateRedeemed};
               stored->updated = wallNow();
               table.put(*stored);
            }
         }
      }
   }

   HttpReply signupViewForSession(const HttpRequest& req, std::string_view idText)
   {
      HttpReply denied;
      auto      session = requireSession(req, denied);
      if (!session)
         return denied;
      auto id = parseSignupId(idText);
      if (!id)
         return textError(req, HttpStatus::badRequest, "invalid signup id\n");
      std::optional<Signup> stored;
      PSIBASE_SUBJECTIVE_TX
      {
         stored = XPortal{}.open<SignupTable>().get(*id);
      }
      if (!stored || !stored->x_id || *stored->x_id != session->x_id)
         return textError(req, HttpStatus::notFound, "signup not found\n");
      return jsonBody(req, signupView(*stored));
   }

   HttpReply serveRedeemed(const HttpRequest& req, std::string_view idText)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);
      return signupViewForSession(req, idText);
   }

   HttpReply serveCreatorKeygen(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return *reply;
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);

      if (to<Accounts>().exists(XPortal::creatorAccount))
      {
         auto stored = readCreatorAgentKey();
         check(stored.has_value(), "creator key is not stored");
         if (!stored->pending_pubkey)
         {
            stored->pending_pubkey = to<XKeys>().newKey();
            writeCreatorAgentKey(*stored);
         }
         return jsonBody(req, *stored);
      }

      if (auto stored = readCreatorAgentKey())
         return jsonBody(req, *stored);

      AgentKey created{.name = std::string{XPortal::creatorAgent}, .pubkey = to<XKeys>().newKey()};
      writeCreatorAgentKey(created);
      return jsonBody(req, created);
   }

   HttpReply serveActivateCreator(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return *reply;
      if (req.method != "POST")
         return HttpReply::methodNotAllowed(req);

      auto stored = readCreatorAgentKey();
      if (!stored || !stored->pending_pubkey)
         return textError(req, HttpStatus::conflict, "creator key has no pending key\n");
      auto chain = to<AuthScope>().get(XPortal::creatorAccount);
      if (!chain || chain->pubkey != *stored->pending_pubkey)
         return textError(req, HttpStatus::conflict, "chain key is not the pending key\n");

      auto previous          = stored->pubkey;
      stored->pubkey         = *stored->pending_pubkey;
      stored->pending_pubkey = std::nullopt;
      writeCreatorAgentKey(*stored);
      to<XKeys>().deleteKey(previous);
      return jsonBody(req, *stored);
   }

   HttpReply serveAgents(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return *reply;
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      if (!to<Accounts>().exists(XPortal::creatorAccount))
         return textError(req, HttpStatus::notFound, "account does not exist\n");

      auto chain = to<AuthScope>().get(XPortal::creatorAccount);
      check(chain.has_value(), "ac-creator has no auth-scope key");

      // No system token means there is no PSI balance to report.
      Quantity psi;
      if (auto sys = to<Tokens>().getSysToken())
         psi = to<Tokens>().getBalance(sys->id, XPortal::creatorAccount);
      // Resources are not tracked until billing is on.
      Quantity resources;
      if (to<VirtualServer>().is_billing_enabled())
         resources = resourceBuffer(XPortal::creatorAccount);

      return jsonBody(req, AgentView{.account          = XPortal::creatorAccount,
                                     .pubkey_pem       = AuthSig::to_string(chain->pubkey),
                                     .psi_balance      = psi,
                                     .resource_balance = resources,
                                     .std_buffer_cost  = to<VirtualServer>().std_buffer_cost()});
   }

   struct SignupQuery
   {
      std::string state;
      PSIO_REFLECT(SignupQuery, state)
   };

   HttpReply serveAdminSignups(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      if (req.method == "OPTIONS")
         return HttpReply{.headers = cors(req)};
      if (auto reply = to<XAdmin>().checkAuth(req, socket))
         return *reply;
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      auto state = req.query<SignupQuery>().state;
      if (state != stateInvited && state != stateRedeemed && state != stateFailed)
         return textError(req, HttpStatus::badRequest,
                          "state must be invited, redeemed, or failed\n");

      auto                     mode = readConfig().mode;
      std::vector<AdminSignup> rows;
      PSIBASE_SUBJECTIVE_TX
      {
         rows.clear();
         auto users = XPortal{}.open<XUserTable>();
         for (auto row : XPortal{}.open<SignupTable>().getIndex<0>())
         {
            if (row.state != state || row.mode != mode)
               continue;
            std::string handle;
            if (row.x_id)
            {
               if (auto user = users.get(*row.x_id))
                  handle = user->handle;
            }
            rows.push_back(AdminSignup{.id                = signupId(row.id),
                                       .handle            = std::move(handle),
                                       .account           = row.account,
                                       .tier              = row.tier,
                                       .state             = row.state,
                                       .attempts          = row.attempts,
                                       .last_error        = row.last_error,
                                       .stripe_session_id = row.stripe_session_id,
                                       .created           = row.created});
         }
      }
      std::ranges::sort(rows, std::greater{}, &AdminSignup::created);
      return jsonBody(req, rows);
   }
}  // namespace xportal

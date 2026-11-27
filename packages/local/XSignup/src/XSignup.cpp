#include <services/local/XSignup.hpp>

#include <algorithm>
#include <format>
#include <psibase/HttpHeaders.hpp>
#include <psibase/base64.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/verifier.hpp>
#include <psio/json_value.hpp>
#include <psio/to_hex.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/local/XKeys.hpp>
#include <services/local/XUsage.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/Transact.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;
using AuthSig::SubjectPublicKeyInfo;

namespace
{
   constexpr auto supervisor     = AccountNumber{"supervisor"};
   constexpr auto signInPage     = "/sign-in.html";
   constexpr auto authRequestTtl = std::chrono::minutes(10);
   // How long a signed creation transaction stays valid, and how long the
   // chosen name is held for it.
   constexpr std::uint32_t creationSeconds = 45;
   constexpr auto          devProvider     = "dev";
   // How long a recovery grant lasts once a provider sign-in has earned it
   constexpr auto          recoveryGrantTtl = std::chrono::minutes(10);
   // An account list is exactly this long: the browser pads it, so that its
   // size does not show how many accounts it holds.
   constexpr std::size_t   accountListSize = 4096;
   // Shorter names are sold by the name market; the accounts service
   // refuses them here (MIN_ALLOWED_ACCOUNT_LENGTH in Accounts.cpp).
   constexpr std::size_t minAccountNameLength = 8;

   TimePointUSec wallNow()
   {
      return std::chrono::time_point_cast<MicroSeconds>(std::chrono::system_clock::now());
   }

   // Lowercase, to match what browsers and RTransact's guest ids use.
   std::string hexOf(std::span<const char> bytes)
   {
      static const char digits[] = "0123456789abcdef";
      std::string       result;
      result.reserve(bytes.size() * 2);
      for (unsigned char b : bytes)
      {
         result += digits[b >> 4];
         result += digits[b & 15];
      }
      return result;
   }

   std::string sha256Hex(std::string_view text)
   {
      auto hash = sha256(text.data(), text.size());
      return hexOf({reinterpret_cast<const char*>(hash.data()), hash.size()});
   }

   std::string randomToken()
   {
      char bytes[32];
      raw::getRandom(bytes, sizeof(bytes));
      return hexOf(bytes);
   }

   std::string formEncode(std::initializer_list<std::pair<std::string_view, std::string_view>> fields)
   {
      constexpr std::string_view hex = "0123456789ABCDEF";
      std::string                out;
      auto                       append = [&](std::string_view text)
      {
         for (unsigned char c : text)
         {
            if (std::isalnum(c) || c == '-' || c == '.' || c == '_' || c == '~')
               out += static_cast<char>(c);
            else
            {
               out += '%';
               out += hex[c >> 4];
               out += hex[c & 0xf];
            }
         }
      };
      for (const auto& [key, value] : fields)
      {
         if (!out.empty())
            out += '&';
         append(key);
         out += '=';
         append(value);
      }
      return out;
   }

   std::string codeChallenge(std::string_view verifier)
   {
      auto hash = sha256(verifier.data(), verifier.size());
      return toBase64Url({reinterpret_cast<const char*>(hash.data()), hash.size()});
   }

   // ------------------------------------------------------------- config

   SignupConfig readConfig()
   {
      SignupConfig config;
      PSIBASE_SUBJECTIVE_TX
      {
         config = XSignup{}.open<SignupConfigTable>().get({}).value_or(SignupConfig{});
      }
      return config;
   }

   // Fills the fields an operator may leave out for a built-in provider.
   SignupProvider withDefaults(SignupProvider p)
   {
      auto def = [](std::optional<std::string>& field, std::string_view value)
      {
         if (!field)
            field = std::string{value};
      };
      if (p.name == "x")
      {
         def(p.label, "X");
         def(p.authorize_url, "https://x.com/i/oauth2/authorize");
         def(p.token_url, "https://api.x.com/2/oauth2/token");
         def(p.user_url, "https://api.x.com/2/users/me");
         def(p.scope, "users.read tweet.read");
         def(p.id_field, "data.id");
         def(p.handle_field, "data.username");
         def(p.token_auth, "basic");
      }
      else if (p.name == "github")
      {
         def(p.label, "GitHub");
         def(p.authorize_url, "https://github.com/login/oauth/authorize");
         def(p.token_url, "https://github.com/login/oauth/access_token");
         def(p.user_url, "https://api.github.com/user");
         def(p.scope, "read:user");
         def(p.id_field, "id");
         def(p.handle_field, "login");
         def(p.token_auth, "post");
      }
      def(p.label, p.name);
      def(p.token_auth, "post");
      return p;
   }

   bool usable(const SignupProvider& p)
   {
      return p.client_id && p.client_secret && p.authorize_url && p.token_url && p.user_url &&
             p.id_field && p.handle_field && p.scope;
   }

   std::optional<SignupProvider> findProvider(const SignupConfig& config, std::string_view name)
   {
      for (const auto& p : config.providers)
      {
         if (p.name == name)
         {
            auto full = withDefaults(p);
            if (usable(full))
               return full;
         }
      }
      return std::nullopt;
   }

   // ------------------------------------------------------------ replies

   // Replies are read by the supervisor's sign-in page and nobody else.
   std::vector<HttpHeader> cors(const HttpRequest& req)
   {
      auto headers = allowCors(req, supervisor);
      if (auto requested = req.getHeader("access-control-request-headers"))
         for (auto& h : headers)
            if (h.name == "Access-Control-Allow-Headers")
               h.value = std::string{*requested};
      headers.push_back({"Cache-Control", "no-store"});
      return headers;
   }

   template <typename T>
   HttpReply json(const HttpRequest& req, const T& value, HttpStatus status = HttpStatus::ok)
   {
      HttpReply reply{.status = status, .contentType = "application/json", .headers = cors(req)};
      psio::to_ijson(value, reply.body);
      return reply;
   }

   struct ErrorBody
   {
      std::string error;
      PSIO_REFLECT(ErrorBody, attr(error, utf8))
   };

   HttpReply fail(const HttpRequest& req, HttpStatus status, std::string_view message)
   {
      return json(req, ErrorBody{std::string{message}}, status);
   }

   HttpReply failNoCors(HttpStatus status, std::string_view message)
   {
      HttpReply reply{.status = status, .contentType = "application/json"};
      psio::to_ijson(ErrorBody{std::string{message}}, reply.body);
      return reply;
   }

   HttpReply redirectTo(std::string location)
   {
      return HttpReply{.status  = HttpStatus::found,
                       .headers = {{"Location", std::move(location)}, {"Cache-Control", "no-store"}}};
   }

   // scheme://<service>.<root host>[:port]
   std::string siblingOrigin(const HttpRequest&          req,
                             std::optional<std::int32_t> socket,
                             AccountNumber               service)
   {
      std::string scheme = "https://";
      if (auto proto = forwardedProto(req))
         scheme = *proto + "://";
      else if (socket)
         scheme = to<XHttp>().isSecure(*socket) ? "https://" : "http://";
      std::string origin = scheme + service.str() + ".";
      origin += to<XHttp>().rootHost(req.host);
      origin += hostHeaderPortSuffix(req);
      return origin;
   }

   // The sign-in page's own query string, given back to it unchanged. It is
   // only ever appended to the supervisor's sign-in page URL.
   bool validResume(std::string_view resume)
   {
      return resume.size() <= 512 &&
             std::ranges::all_of(resume, [](unsigned char c) {
                return std::isalnum(c) || std::string_view{"-._~%=&/"}.find(c) !=
                                              std::string_view::npos;
             });
   }

   // -------------------------------------------------------------- links

   std::optional<SignupLink> linkOfGuest(std::string_view guest)
   {
      std::optional<SignupLink> result;
      PSIBASE_SUBJECTIVE_TX
      {
         result.reset();
         auto index = XSignup{}.open<SignupLinkTable>().getIndex<1>();
         for (auto row : index.subindex(std::string{guest}))
         {
            // Prefer the link that already has an account.
            if (!result || row.account)
               result = std::move(row);
         }
      }
      return result;
   }

   // The auth-sig record of `account`, if it is an auth-sig account. Asked
   // of auth-sig itself: its tables are not readable from here. Who the
   // account's keys and partner are does not depend on its state, so this
   // answers the same while the account is paused or frozen.
   std::optional<AuthSig::AuthRecord> recordOf(AccountNumber account)
   {
      auto row = to<Accounts>().getAccount(account);
      if (!row || row->authService != AuthSig::AuthSig::service)
         return std::nullopt;
      return to<AuthSig::AuthSig>().getRecord(account);
   }

   // Whether `account` is an auth-sig account whose owner key is `key`.
   bool hasOwnerKey(AccountNumber account, const std::vector<unsigned char>& key)
   {
      auto record = recordOf(account);
      return record && record->owner.key.data == key;
   }

   // Notices that an issued creation transaction has landed. The account is
   // this link's if it exists with the owner key the transaction was issued
   // for.
   SignupLink settle(SignupLink link)
   {
      if (link.account || !link.pending)
         return link;
      auto name    = *link.pending;
      auto account = to<Accounts>().getAccount(name);
      bool mine    = account && hasOwnerKey(name, link.pending_key);
      if (mine)
      {
         link.account = name;
         link.pending.reset();
         link.pending_key.clear();
      }
      else if (account || link.pending_until <= wallNow())
      {
         // Someone else took the name, or the transaction was never pushed.
         link.pending.reset();
         link.pending_key.clear();
      }
      else
      {
         return link;
      }
      PSIBASE_SUBJECTIVE_TX
      {
         XSignup{}.open<SignupLinkTable>().put(link);
      }
      // What the guest used of this node so far becomes the account's.
      // (x-usage is a dependency of this service's package.)
      if (mine)
         to<XUsage>().carryOver(link.guest, name);
      return link;
   }

   // Every link of a guest, each settled
   std::vector<SignupLink> linksOfGuest(std::string_view guest)
   {
      std::vector<SignupLink> result;
      PSIBASE_SUBJECTIVE_TX
      {
         result.clear();
         auto index = XSignup{}.open<SignupLinkTable>().getIndex<1>();
         for (auto row : index.subindex(std::string{guest}))
            result.push_back(std::move(row));
      }
      for (auto& link : result)
         link = settle(std::move(link));
      return result;
   }

   // Links a provider identity to a guest. Returns an error message if the
   // identity has already been used to create an account for someone else.
   std::optional<std::string> linkGuest(std::string_view provider,
                                        std::string_view subject,
                                        std::string_view handle,
                                        std::string_view guest)
   {
      std::optional<std::string> error;
      PSIBASE_SUBJECTIVE_TX
      {
         error.reset();
         auto table    = XSignup{}.open<SignupLinkTable>();
         auto existing = table.get(std::tuple{std::string{provider}, std::string{subject}});
         if (existing && existing->guest != guest && (existing->account || existing->pending))
         {
            error = "This sign-in has already been used to create an account.";
         }
         else
         {
            SignupLink link = existing.value_or(SignupLink{.provider = std::string{provider},
                                                           .subject  = std::string{subject},
                                                           .created  = wallNow()});
            link.handle = std::string{handle};
            link.guest  = std::string{guest};
            table.put(link);
         }
      }
      return error;
   }

   // ------------------------------------------------------------ sponsor

   SubjectPublicKeyInfo sponsorKey()
   {
      std::optional<SponsorKeyRow> row;
      PSIBASE_SUBJECTIVE_TX
      {
         row = XSignup{}.open<SponsorKeyTable>().get({});
      }
      if (row)
         return row->key;
      auto key = to<XKeys>().newKey();
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XSignup{}.open<SponsorKeyTable>();
         // Another request may have created one in the meantime.
         if (auto existing = table.get({}))
            row = existing;
         else
            table.put(SponsorKeyRow{key});
      }
      if (row)
      {
         to<XKeys>().deleteKey(key);
         return row->key;
      }
      return key;
   }

   // Whether the sponsor account exists on chain with this node's key.
   bool sponsorReady(const SignupConfig& config)
   {
      std::optional<SponsorKeyRow> row;
      PSIBASE_SUBJECTIVE_TX
      {
         row = XSignup{}.open<SponsorKeyTable>().get({});
      }
      if (!row)
         return false;
      // The sponsor signs with the key x-keys holds for it: either of its keys.
      auto record = recordOf(config.sponsor);
      return record && (record->active.key.data == row->key.data ||
                        record->owner.key.data == row->key.data);
   }

   // ----------------------------------------------------- recovery grants

   std::optional<SignupRecoveryGrant> grantOf(std::string_view guest)
   {
      std::optional<SignupRecoveryGrant> result;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XSignup{}.open<SignupRecoveryGrantTable>();
         result     = table.get(std::string{guest});
         if (result && result->expires <= wallNow())
         {
            table.remove(*result);
            result.reset();
         }
      }
      return result;
   }

   void putGrant(std::string_view guest, AccountNumber account)
   {
      PSIBASE_SUBJECTIVE_TX
      {
         XSignup{}.open<SignupRecoveryGrantTable>().put(SignupRecoveryGrant{
             .guest = std::string{guest}, .account = account, .expires = wallNow() + recoveryGrantTtl});
      }
   }

   struct RecoveryInfo
   {
      AccountNumber account;
      std::uint32_t valid_seconds = 0;
      PSIO_REFLECT(RecoveryInfo, account, valid_seconds)
   };

   RecoveryInfo describe(const SignupRecoveryGrant& grant)
   {
      auto left = std::chrono::duration_cast<std::chrono::seconds>(grant.expires - wallNow());
      return RecoveryInfo{grant.account,
                          static_cast<std::uint32_t>(std::max<std::int64_t>(left.count(), 0))};
   }

   // Whether the provider identity (provider, subject) is the one `account`
   // was created with. The development provider checks nothing when it
   // links, and checks nothing here: any account created through it.
   bool createdWith(std::string_view provider, std::string_view subject, AccountNumber account)
   {
      std::vector<SignupLink> candidates;
      PSIBASE_SUBJECTIVE_TX
      {
         candidates.clear();
         auto table = XSignup{}.open<SignupLinkTable>();
         if (provider == devProvider)
         {
            for (auto row : table.getIndex<2>().subindex(account))
               if (row.provider == devProvider)
                  candidates.push_back(std::move(row));
         }
         else if (auto link = table.get(std::tuple{std::string{provider}, std::string{subject}}))
            candidates.push_back(std::move(*link));
      }
      // A creation that has landed but was not looked at since is the link's account too.
      for (auto& link : candidates)
         if (settle(std::move(link)).account == account)
            return true;
      return false;
   }

   // ----------------------------------------------------------- outbound

   std::int32_t sendTo(std::string_view url, HttpRequest request)
   {
      auto split     = splitURL(url);
      request.host   = std::string{split.host};
      request.target = split.path.empty() ? "/" : std::string{split.path};
      std::optional<TLSInfo> tls;
      if (split.scheme == "https")
         tls.emplace();
      return to<XHttp>().sendRequest(std::move(request), tls, std::nullopt);
   }

   void track(std::int32_t outbound, MethodNumber callback, SignupPendingRequest pending)
   {
      pending.socket = outbound;
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().setCallback(outbound, callback, MethodNumber{"onError"});
         XSignup{}.open<SignupPendingRequestTable>().put(pending);
      }
   }

   SignupPendingRequest takePending(std::int32_t socket)
   {
      std::optional<SignupPendingRequest> pending;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XSignup{}.open<SignupPendingRequestTable>();
         pending    = table.get(socket);
         check(pending.has_value(), "no pending request on socket " + std::to_string(socket));
         table.remove(*pending);
      }
      return *pending;
   }

   // Sends the waiting browser its answer. The browser's request came from
   // the sign-in page, so the reply names that origin.
   void replyToBrowser(const SignupPendingRequest& pending, HttpReply reply)
   {
      reply.headers.push_back({"Access-Control-Allow-Origin", pending.origin});
      reply.headers.push_back({"Cache-Control", "no-store"});
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().autoClose(pending.client, true);
         to<XHttp>().sendReply(pending.client, reply);
      }
   }

   // Reads a dot-separated path out of a provider's JSON as text.
   std::optional<std::string> jsonText(const psio::json_value& root, std::string_view path)
   {
      const psio::json_value* value = &root;
      while (!path.empty())
      {
         auto key = path.substr(0, path.find('.'));
         path.remove_prefix(std::min(path.size(), key.size() + 1));
         value = value->find(key);
         if (!value)
            return std::nullopt;
      }
      if (auto text = value->as_string())
         return *text;
      if (auto number = value->as_number())
         return number->text;
      return std::nullopt;
   }

   std::optional<psio::json_value> parseJson(const HttpReply& reply)
   {
      if (reply.status != HttpStatus::ok)
         return std::nullopt;
      return psio::from_ijson<psio::json_value>(std::string(reply.body.begin(), reply.body.end()));
   }

   // -------------------------------------------------------------- status

   struct ProviderInfo
   {
      std::string name;
      std::string label;
      PSIO_REFLECT(ProviderInfo, attr(name, utf8), attr(label, utf8))
   };

   struct LinkInfo
   {
      std::string                  provider;
      std::string                  handle;
      std::optional<AccountNumber> account;
      std::optional<AccountNumber> pending;
      PSIO_REFLECT(LinkInfo, attr(provider, utf8), attr(handle, utf8), account, pending)
   };

   struct Status
   {
      bool                      open = false;
      std::vector<ProviderInfo> providers;
      std::string               guest;
      std::optional<LinkInfo>   link;
      // The accounts created with this guest's provider identities
      std::vector<AccountNumber> accounts;
      // The recovery grant this guest holds, if any
      std::optional<RecoveryInfo> recovery;
      // The account that creates accounts here and so is their default
      // recovery partner. Public: it is in every such account's record.
      AccountNumber sponsor;
      PSIO_REFLECT(Status, open, providers, attr(guest, utf8), link, accounts, recovery, sponsor)
   };

   LinkInfo describe(const SignupLink& link)
   {
      return LinkInfo{link.provider, link.handle, link.account, link.pending};
   }

   HttpReply serveStatus(const HttpRequest& req, const SessionInfo& session)
   {
      auto   config = readConfig();
      Status status{.open = config.open && sponsorReady(config), .guest = session.guest};
      status.sponsor = config.sponsor;
      for (const auto& p : config.providers)
      {
         auto full = withDefaults(p);
         if (usable(full))
            status.providers.push_back({full.name, *full.label});
      }
      if (config.dev_provider)
         status.providers.push_back({devProvider, "Development sign-in (no identity check)"});
      if (!session.guest.empty())
      {
         for (auto& link : linksOfGuest(session.guest))
         {
            if (link.account)
               status.accounts.push_back(*link.account);
            // Prefer the link that already has an account.
            if (!status.link || link.account)
               status.link = describe(link);
         }
         if (auto grant = grantOf(session.guest))
            status.recovery = describe(*grant);
      }
      return json(req, status);
   }

   // --------------------------------------------------------------- oauth

   struct RecoveryReply
   {
      RecoveryInfo recovery;
      PSIO_REFLECT(RecoveryReply, recovery)
   };

   constexpr auto notCreatedWith =
       "That account was not created with this sign-in.";

   struct StartRequest
   {
      std::string provider;
      std::string browser;
      std::string resume;
      // "signup" (the default) or "recover", which needs `account`
      std::optional<std::string>   purpose;
      std::optional<AccountNumber> account;
      PSIO_REFLECT(StartRequest,
                   attr(provider, utf8),
                   attr(browser, utf8),
                   attr(resume, utf8),
                   attr(purpose, utf8),
                   account)
   };

   struct StartReply
   {
      // Where to send the browser; empty when the link is already made.
      std::string             url;
      std::optional<LinkInfo> link;
      // Set when a recovery was granted without leaving the page
      std::optional<RecoveryInfo> recovery;
      PSIO_REFLECT(StartReply, attr(url, utf8), link, recovery)
   };

   HttpReply serveStart(const HttpRequest&          req,
                        std::optional<std::int32_t> socket,
                        const SessionInfo&          session)
   {
      auto body   = psio::from_ijson<StartRequest>(req.body);
      auto config = readConfig();
      // A sign-in is for signing up, or for proving ownership of an account
      // so that the sponsor acts as its recovery partner.
      std::optional<AccountNumber> recover;
      if (body.purpose && *body.purpose == "recover")
      {
         if (!body.account || *body.account == AccountNumber{})
            return fail(req, HttpStatus::badRequest, "Which account?");
         recover = body.account;
      }
      else if (body.purpose && *body.purpose != "signup")
         return fail(req, HttpStatus::badRequest, "Unknown purpose.");
      // A node that has stopped creating accounts still stands by the ones it created.
      if (!config.open && !recover)
         return fail(req, HttpStatus::serviceUnavailable, "This node is not creating accounts.");

      if (body.provider == devProvider)
      {
         if (!config.dev_provider)
            return fail(req, HttpStatus::notFound, "Unknown sign-in provider.");
         if (recover)
         {
            if (!createdWith(devProvider, session.guest, *recover))
               return fail(req, HttpStatus::forbidden, notCreatedWith);
            putGrant(session.guest, *recover);
            return json(req, StartReply{.recovery = describe(*grantOf(session.guest))});
         }
         if (auto error = linkGuest(devProvider, session.guest, "developer", session.guest))
            return fail(req, HttpStatus::conflict, *error);
         return json(req, StartReply{.link = describe(*linkOfGuest(session.guest))});
      }

      auto provider = findProvider(config, body.provider);
      if (!provider)
         return fail(req, HttpStatus::notFound, "Unknown sign-in provider.");
      if (body.browser.size() != 64 || !validResume(body.resume))
         return fail(req, HttpStatus::badRequest, "Malformed request.");

      auto              now = wallNow();
      SignupAuthRequest started{
          .state         = randomToken(),
          .guest         = session.guest,
          .provider      = provider->name,
          .code_verifier = randomToken(),
          .redirect_uri  = siblingOrigin(req, socket, XSignup::service) + "/oauth/callback",
          .browser       = body.browser,
          .resume        = body.resume,
          .expires       = now + authRequestTtl,
          .recover       = recover};
      PSIBASE_SUBJECTIVE_TX
      {
         auto                           table = XSignup{}.open<SignupAuthRequestTable>();
         std::vector<SignupAuthRequest> expired;
         for (auto row : table.getIndex<1>())
         {
            if (row.expires > now)
               break;
            expired.push_back(std::move(row));
         }
         for (const auto& row : expired)
            table.remove(row);
         table.put(started);
      }
      auto query = formEncode({{"response_type", "code"},
                               {"client_id", *provider->client_id},
                               {"redirect_uri", started.redirect_uri},
                               {"scope", *provider->scope},
                               {"state", started.state},
                               {"code_challenge", codeChallenge(started.code_verifier)},
                               {"code_challenge_method", "S256"}});
      return json(req, StartReply{.url = *provider->authorize_url + "?" + query});
   }

   struct CallbackQuery
   {
      std::string code;
      std::string state;
      std::string error;
      PSIO_REFLECT(CallbackQuery, attr(code, utf8), attr(state, utf8), attr(error, utf8))
   };

   // The provider sends the browser here. Nothing is trusted yet: the code
   // is parked, and the sign-in page, holding the secret, must claim it.
   HttpReply serveCallback(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      auto                             query = req.query<CallbackQuery>();
      std::optional<SignupAuthRequest> started;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XSignup{}.open<SignupAuthRequestTable>();
         started    = table.get(query.state);
         if (started && !started->code && started->expires > wallNow())
         {
            if (query.code.empty())
               table.remove(*started);
            else
            {
               started->code = query.code;
               table.put(*started);
            }
         }
         else
            started.reset();
      }
      auto page = siblingOrigin(req, socket, supervisor) + signInPage;
      if (!started)
         return redirectTo(page + "?step=account&provider_error=expired");
      auto to = page + "?" + started->resume + (started->resume.empty() ? "" : "&") + "step=account";
      if (query.code.empty())
         return redirectTo(to + "&provider_error=cancelled");
      return redirectTo(to + "&state=" + started->state);
   }

   struct FinishRequest
   {
      std::string state;
      std::string secret;
      PSIO_REFLECT(FinishRequest, attr(state, utf8), attr(secret, utf8))
   };

   std::optional<HttpReply> serveFinish(const HttpRequest&          req,
                                        std::optional<std::int32_t> socket,
                                        const SessionInfo&          session)
   {
      auto                             body = psio::from_ijson<FinishRequest>(req.body);
      std::optional<SignupAuthRequest> started;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = XSignup{}.open<SignupAuthRequestTable>();
         started    = table.get(body.state);
         // One attempt: whatever happens next, the code is spent.
         if (started)
            table.remove(*started);
      }
      if (!started || !started->code || started->expires <= wallNow() ||
          started->guest != session.guest || sha256Hex(body.secret) != started->browser)
         return fail(req, HttpStatus::forbidden,
                     "This sign-in was not started from this browser, or it has expired.");

      auto provider = findProvider(readConfig(), started->provider);
      if (!provider)
         return fail(req, HttpStatus::serviceUnavailable, "Sign-in provider is not configured.");

      std::string             form;
      std::vector<HttpHeader> headers{{"Accept", "application/json"},
                                      {"User-Agent", "psibase-node"}};
      if (*provider->token_auth == "basic")
      {
         form = formEncode({{"grant_type", "authorization_code"},
                            {"code", *started->code},
                            {"redirect_uri", started->redirect_uri},
                            {"code_verifier", started->code_verifier}});
         auto credentials = *provider->client_id + ":" + *provider->client_secret;
         headers.push_back({"Authorization", "Basic " + toBase64(credentials)});
      }
      else
      {
         form = formEncode({{"grant_type", "authorization_code"},
                            {"client_id", *provider->client_id},
                            {"client_secret", *provider->client_secret},
                            {"code", *started->code},
                            {"redirect_uri", started->redirect_uri},
                            {"code_verifier", started->code_verifier}});
      }
      // x-http does not add Content-Length to outgoing requests
      headers.push_back({"Content-Length", std::to_string(form.size())});
      auto outbound =
          sendTo(*provider->token_url,
                 HttpRequest{.method      = "POST",
                             .contentType = "application/x-www-form-urlencoded",
                             .headers     = std::move(headers),
                             .body        = std::vector<char>(form.begin(), form.end())});
      track(outbound, MethodNumber{"onToken"},
            SignupPendingRequest{.client   = *socket,
                                 .guest    = session.guest,
                                 .provider = provider->name,
                                 .origin   = std::string{req.getHeader("origin").value_or("")},
                                 .recover  = started->recover});
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().autoClose(*socket, false);
      }
      return std::nullopt;
   }

   // -------------------------------------------------------------- create

   // A key as the page sends it
   struct KeyInput
   {
      std::vector<char> key;  // DER SubjectPublicKeyInfo
      std::uint64_t     seq = 0;
      PSIO_REFLECT(KeyInput, key, seq)

      // As auth-sig takes it, or nothing if no verifier accepts the key
      std::optional<AuthSig::KeySpec> spec() const
      {
         SubjectPublicKeyInfo spki{{key.begin(), key.end()}};
         if (!verifierFor(spki.data))
            return std::nullopt;
         return AuthSig::KeySpec{std::move(spki), seq, {}};
      }
   };

   struct CreateRequest
   {
      std::string name;
      KeyInput    owner;
      KeyInput    active;
      PSIO_REFLECT(CreateRequest, attr(name, utf8), owner, active)
   };

   struct CreateReply
   {
      // A packed SignedTransaction for the browser to push.
      std::vector<char> transaction;
      std::uint32_t     valid_seconds;
      PSIO_REFLECT(CreateReply, transaction, valid_seconds)
   };

   // Why a name cannot be used, or nothing if it can.
   std::optional<std::string> nameProblem(std::string_view text)
   {
      if (text.size() < minAccountNameLength)
         return "Names need at least " + std::to_string(minAccountNameLength) + " characters.";
      AccountNumber name{text};
      // Names are packed into 64 bits; long or unusual ones do not fit.
      if (name == AccountNumber{} || name.str() != text)
         return "That name doesn't fit. Try a shorter one, or fewer digits and hyphens.";
      if (text.ends_with('-') || text.starts_with("x-") || name.subaccount())
         return "That is not a valid account name.";
      if (to<Accounts>().getAccount(name))
         return "That name is taken.";
      return std::nullopt;
   }

   struct NameQuery
   {
      std::string name;
      PSIO_REFLECT(NameQuery, attr(name, utf8))
   };

   struct NameReply
   {
      bool        ok = false;
      std::string problem;
      PSIO_REFLECT(NameReply, ok, attr(problem, utf8))
   };

   HttpReply serveCheckName(const HttpRequest& req)
   {
      auto problem = nameProblem(req.query<NameQuery>().name);
      return json(req, NameReply{!problem, problem.value_or("")});
   }

   HttpReply serveCreate(const HttpRequest& req, const SessionInfo& session)
   {
      auto body   = psio::from_ijson<CreateRequest>(req.body);
      auto config = readConfig();
      if (!config.open || !sponsorReady(config))
         return fail(req, HttpStatus::serviceUnavailable, "This node is not creating accounts.");

      // The account's keys are derived by the browser for this account; they
      // are not the guest's key, and only their public halves come here.
      auto owner  = body.owner.spec();
      auto active = body.active.spec();
      if (!owner || !active)
         return fail(req, HttpStatus::badRequest, "Unsupported public key.");

      auto found = linkOfGuest(session.guest);
      if (!found)
         return fail(req, HttpStatus::forbidden,
                     "Sign in with a provider before creating an account.");
      auto link = settle(std::move(*found));
      if (link.account)
         return fail(req, HttpStatus::conflict,
                     "You already have the account " + link.account->str() + ".");

      if (auto problem = nameProblem(body.name))
         return fail(req, HttpStatus::badRequest, *problem);
      AccountNumber name{body.name};
      if (link.pending && *link.pending != name)
         return fail(req, HttpStatus::conflict,
                     "Still finishing " + link.pending->str() + ". Try again in a moment.");
      // Hold the name before signing, so one sign-in cannot mint two.
      link.pending       = name;
      link.pending_key   = owner->key.data;
      link.pending_until = wallNow() + std::chrono::seconds(creationSeconds + 15);
      PSIBASE_SUBJECTIVE_TX
      {
         XSignup{}.open<SignupLinkTable>().put(link);
      }

      Action create{.sender  = config.sponsor,
                    .service = AuthSig::AuthSig::service,
                    .method  = MethodNumber{"newAccount"},
                    // The sponsor, as the sender, becomes the account's
                    // recovery partner.
                    .rawData = psio::to_pssz(std::tuple{name, *owner, *active})};
      auto   trx = to<XKeys>().signTxFor(std::vector<Action>{std::move(create)}, creationSeconds);
      return json(req, CreateReply{psio::to_pssz(trx), creationSeconds});
   }

   // ------------------------------------------------------- account lists

   struct ListReply
   {
      std::vector<char> blob;
      std::uint64_t     version = 0;
      PSIO_REFLECT(ListReply, blob, version)
   };

   struct ListWrite
   {
      std::vector<char> blob;
      std::vector<char> key;  // DER SubjectPublicKeyInfo of the guest key
      std::uint64_t     version = 0;
      std::vector<char> sig;  // 64 bytes, r || s, low S
      PSIO_REFLECT(ListWrite, blob, key, version, sig)
   };

   // What the writer of an account list signs (its SHA-256):
   //
   //    "psibase account list\n" <locator, lowercase hex> "\n" <version, decimal> "\n"
   //    <SHA-256 of the blob, lowercase hex>
   std::string listMessage(std::string_view locator, std::uint64_t version, std::span<const char> blob)
   {
      auto hash = sha256(blob.data(), blob.size());
      return "psibase account list\n" + std::string{locator} + "\n" + std::to_string(version) +
             "\n" + hexOf({reinterpret_cast<const char*>(hash.data()), hash.size()});
   }

   // 32 bytes as lowercase hex
   bool validLocator(std::string_view text)
   {
      return text.size() == 64 && std::ranges::all_of(text, [](char c) {
                return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
             });
   }

   HttpReply serveList(const HttpRequest& req, std::string_view locator)
   {
      if (!validLocator(locator))
         return fail(req, HttpStatus::badRequest, "Malformed locator.");
      auto table = XSignup{}.open<SignupAccountListTable>();

      if (req.method == "GET")
      {
         // Whoever can compute the locator may read: it comes from the passkey.
         std::optional<SignupAccountList> row;
         PSIBASE_SUBJECTIVE_TX
         {
            row = table.get(std::string{locator});
         }
         if (!row)
            return fail(req, HttpStatus::notFound, "No such list.");
         return json(req, ListReply{std::move(row->blob), row->version});
      }
      if (req.method != "PUT")
         return HttpReply::methodNotAllowed(req);
      if (req.contentType != "application/json")
         return fail(req, HttpStatus::unsupportedMediaType, "Content-Type must be application/json");

      auto body = psio::from_ijson<ListWrite>(req.body);
      if (body.blob.size() != accountListSize)
         return fail(req, HttpStatus::badRequest,
                     "An account list is exactly " + std::to_string(accountListSize) + " bytes.");
      if (body.sig.size() != 64)
         return fail(req, HttpStatus::badRequest, "Malformed signature.");
      auto verifier = verifierFor(body.key);
      if (!verifier)
         return fail(req, HttpStatus::badRequest, "Unsupported public key.");

      std::optional<SignupAccountList> existing;
      PSIBASE_SUBJECTIVE_TX
      {
         existing = table.get(std::string{locator});
      }
      // The first writer's key owns the locator, and versions only go up.
      auto sameKey = [&](const SignupAccountList& row)
      {
         return std::ranges::equal(row.key, body.key, {}, {},
                                   [](char c) { return static_cast<unsigned char>(c); });
      };
      if (existing)
      {
         if (!sameKey(*existing))
            return fail(req, HttpStatus::forbidden, "This list belongs to another key.");
         if (body.version <= existing->version)
            return fail(req, HttpStatus::conflict,
                        "The list is already at version " + std::to_string(existing->version) + ".");
      }

      // Aborts the request if the signature is not this key's over this write.
      auto message = listMessage(locator, body.version, body.blob);
      Actor<VerifyInterface> verify(XSignup::service, *verifier);
      verify.verifySys(sha256(message.data(), message.size()), Claim{*verifier, body.key}, body.sig);

      bool stored = false;
      PSIBASE_SUBJECTIVE_TX
      {
         // Another write may have landed since the checks above.
         auto current = table.get(std::string{locator});
         stored = current ? sameKey(*current) && current->version < body.version : true;
         if (stored)
            table.put(SignupAccountList{.locator = std::string{locator},
                                        .blob    = body.blob,
                                        .key     = {body.key.begin(), body.key.end()},
                                        .version = body.version});
      }
      if (!stored)
         return fail(req, HttpStatus::conflict, "The list changed. Read it and try again.");
      return json(req, ListReply{{}, body.version});
   }

   // ------------------------------------------- the sponsor as partner

   struct PartnerRequest
   {
      AccountNumber           account;
      std::optional<KeyInput> owner;
      std::optional<KeyInput> active;
      PSIO_REFLECT(PartnerRequest, account, owner, active)
   };

   // The node's sponsor is the recovery partner of the accounts it created.
   // A guest holding a recovery grant for an account (see serveStart and
   // onUser) gets one transaction, signed by the sponsor, that acts on it.
   HttpReply servePartner(const HttpRequest& req, const SessionInfo& session, std::string_view what)
   {
      auto body   = psio::from_ijson<PartnerRequest>(req.body);
      auto config = readConfig();
      if (!sponsorReady(config))
         return fail(req, HttpStatus::serviceUnavailable, "This node has no sponsor account.");

      auto grant = grantOf(session.guest);
      if (!grant || grant->account != body.account)
         return fail(req, HttpStatus::forbidden,
                     "Sign in with the provider the account was created with first.");

      auto record = recordOf(body.account);
      if (!record)
         return fail(req, HttpStatus::notFound, "No such account.");
      if (record->partner != config.sponsor)
         return fail(req, HttpStatus::forbidden,
                     "This node's sponsor is not that account's recovery partner.");

      using AuthSig::AccountState;
      Action act{.sender = config.sponsor, .service = AuthSig::AuthSig::service};
      if (what == "confirm" || what == "reject")
      {
         if (record->state != AccountState::paused || !record->pending)
            return fail(req, HttpStatus::conflict, "That account has no pending change.");
         act.method  = MethodNumber{what};
         act.rawData = psio::to_pssz(std::tuple{body.account});
      }
      else if (what == "end-pause")
      {
         if (record->state != AccountState::paused)
            return fail(req, HttpStatus::conflict, "That account is not paused.");
         if (record->pending)
            return fail(req, HttpStatus::conflict,
                        "That account has a pending change: confirm or reject it.");
         act.method  = MethodNumber{"endPause"};
         act.rawData = psio::to_pssz(std::tuple{body.account});
      }
      else
      {
         if (record->state != AccountState::frozen)
            return fail(req, HttpStatus::conflict, "That account is not frozen.");
         auto owner  = body.owner ? body.owner->spec() : std::nullopt;
         auto active = body.active ? body.active->spec() : std::nullopt;
         if (!owner || !active)
            return fail(req, HttpStatus::badRequest, "New owner and active keys are needed.");
         act.method  = MethodNumber{"unfreezeWith"};
         act.rawData = psio::to_pssz(std::tuple{body.account, *owner, *active});
      }

      // One transaction per grant.
      PSIBASE_SUBJECTIVE_TX
      {
         XSignup{}.open<SignupRecoveryGrantTable>().erase(session.guest);
      }
      auto trx = to<XKeys>().signTxFor(std::vector<Action>{std::move(act)}, creationSeconds);
      return json(req, CreateReply{psio::to_pssz(trx), creationSeconds});
   }

   // --------------------------------------------------------------- admin

   struct SponsorInfo
   {
      AccountNumber account;
      std::string   key;
      bool          ready = false;
      PSIO_REFLECT(SponsorInfo, account, attr(key, utf8), ready)
   };

   std::optional<HttpReply> serveAdmin(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      auto target = req.path();
      if (target != "/config" && target != "/sponsor")
         return std::nullopt;
      if (auto denied = to<XAdmin>().checkAuth(req, socket))
         return denied;
      auto headers = allowCors(req, XAdmin::service);

      if (target == "/sponsor")
      {
         if (req.method != "GET")
            return HttpReply::methodNotAllowed(req);
         auto        config = readConfig();
         auto        key    = sponsorKey();
         SponsorInfo info{.account = config.sponsor,
                          .key     = AuthSig::SubjectPublicKeyInfoText::text(key),
                          .ready   = sponsorReady(config)};
         HttpReply   reply{.contentType = "application/json", .headers = std::move(headers)};
         psio::to_ijson(info, reply.body);
         return reply;
      }

      if (req.method == "PUT")
      {
         if (req.contentType != "application/json")
            return failNoCors(HttpStatus::unsupportedMediaType,
                              "Content-Type must be application/json");
         auto config = psio::from_ijson<SignupConfig>(req.body);
         auto old    = readConfig();
         // A secret that is not sent stays as it was, so a config read back
         // with its secrets hidden can be edited and written again.
         for (auto& p : config.providers)
            if (!p.client_secret)
               for (const auto& q : old.providers)
                  if (q.name == p.name)
                     p.client_secret = q.client_secret;
         PSIBASE_SUBJECTIVE_TX
         {
            XSignup{}.open<SignupConfigTable>().put(config);
         }
         return HttpReply{.headers = std::move(headers)};
      }
      if (req.method != "GET")
         return HttpReply::methodNotAllowed(req);
      auto config = readConfig();
      for (auto& p : config.providers)
         p.client_secret.reset();
      HttpReply reply{.contentType = "application/json", .headers = std::move(headers)};
      psio::to_ijson(config, reply.body);
      return reply;
   }
}  // namespace

auto XSignup::serveSys(HttpRequest request, std::optional<std::int32_t> socket)
    -> std::optional<HttpReply>
{
   check(getSender() == XHttp::service, "Wrong sender");
   check(socket.has_value(), "Missing socket");

   if (auto reply = serveAdmin(request, socket))
      return reply;

   auto target = request.path();
   if (request.method == "OPTIONS")
      return HttpReply{.headers = cors(request)};

   if (target == "/oauth/callback")
   {
      if (request.method != "GET")
         return HttpReply::methodNotAllowed(request);
      return serveCallback(request, socket);
   }

   if (target.starts_with("/list/"))
      return serveList(request, std::string_view{target}.substr(6));

   // Everything else is the sign-in page acting for a guest.
   auto session = to<RTransact>().getSession(request);

   if (target == "/status")
   {
      if (request.method != "GET")
         return HttpReply::methodNotAllowed(request);
      return serveStatus(request, session);
   }

   if (target == "/check_name")
   {
      if (request.method != "GET")
         return HttpReply::methodNotAllowed(request);
      if (session.guest.empty())
         return fail(request, HttpStatus::unauthorized, "Sign in with your passkey first.");
      return serveCheckName(request);
   }

   if (target == "/oauth/start" || target == "/oauth/finish" || target == "/create" ||
       target.starts_with("/partner/"))
   {
      if (request.method != "POST")
         return HttpReply::methodNotAllowed(request);
      if (request.contentType != "application/json")
         return fail(request, HttpStatus::unsupportedMediaType,
                     "Content-Type must be application/json");
      if (session.guest.empty())
         return fail(request, HttpStatus::unauthorized, "Sign in with your passkey first.");
      if (target == "/oauth/start")
         return serveStart(request, socket, session);
      if (target == "/oauth/finish")
         return serveFinish(request, socket, session);
      if (target == "/create")
         return serveCreate(request, session);
      auto what = std::string_view{target}.substr(9);
      if (what == "confirm" || what == "reject" || what == "end-pause" || what == "unfreeze")
         return servePartner(request, session, what);
      return std::nullopt;
   }

   return std::nullopt;
}

void XSignup::onToken(std::int32_t socket, HttpReply reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto pending  = takePending(socket);
   auto provider = findProvider(readConfig(), pending.provider);
   auto body     = parseJson(reply);
   auto token    = body ? jsonText(*body, "access_token") : std::nullopt;
   if (!provider || !token)
   {
      replyToBrowser(pending, failNoCors(HttpStatus::badGateway,
                                         "The sign-in provider did not accept the sign-in."));
      return;
   }
   // The token is used once, here, and never stored.
   auto outbound =
       sendTo(*provider->user_url,
              HttpRequest{.method  = "GET",
                          .headers = {{"Authorization", "Bearer " + *token},
                                      {"Accept", "application/json"},
                                      {"User-Agent", "psibase-node"}}});
   track(outbound, MethodNumber{"onUser"}, std::move(pending));
}

void XSignup::onUser(std::int32_t socket, HttpReply reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto pending  = takePending(socket);
   auto provider = findProvider(readConfig(), pending.provider);
   auto body     = parseJson(reply);
   auto subject  = body && provider ? jsonText(*body, *provider->id_field) : std::nullopt;
   if (!subject || subject->empty())
   {
      replyToBrowser(pending, failNoCors(HttpStatus::badGateway,
                                         "The sign-in provider did not say who you are."));
      return;
   }
   auto handle = jsonText(*body, *provider->handle_field).value_or(*subject);
   if (pending.recover)
   {
      // The identity is not linked to this guest (who may hold a new
      // passkey): it only has to be the one the account was created with.
      if (!createdWith(pending.provider, *subject, *pending.recover))
      {
         replyToBrowser(pending, failNoCors(HttpStatus::forbidden, notCreatedWith));
         return;
      }
      putGrant(pending.guest, *pending.recover);
      HttpReply granted{.contentType = "application/json"};
      psio::to_ijson(RecoveryReply{describe(*grantOf(pending.guest))}, granted.body);
      replyToBrowser(pending, std::move(granted));
      return;
   }
   if (auto error = linkGuest(pending.provider, *subject, handle, pending.guest))
   {
      replyToBrowser(pending, failNoCors(HttpStatus::conflict, *error));
      return;
   }
   HttpReply ok{.contentType = "application/json"};
   psio::to_ijson(LinkInfo{pending.provider, handle, std::nullopt, std::nullopt}, ok.body);
   replyToBrowser(pending, std::move(ok));
}

void XSignup::onError(std::int32_t socket, std::optional<HttpReply> reply)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto pending = takePending(socket);
   replyToBrowser(pending, failNoCors(HttpStatus::badGateway,
                                      "Could not reach the sign-in provider."));
}

PSIBASE_DISPATCH(XSignup)

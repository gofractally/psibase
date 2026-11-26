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
#include <services/system/Accounts.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/RTransact.hpp>

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

   // The guest id RTransact puts in a guest session for this key.
   std::string guestIdOf(const std::vector<unsigned char>& key)
   {
      auto hash = sha256(reinterpret_cast<const char*>(key.data()), key.size());
      return hexOf({reinterpret_cast<const char*>(hash.data()), 16});
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

   // Whether `account` exists and is an auth-sig account with exactly this
   // key. Asked of auth-sig itself: its tables are not readable from here.
   bool hasKey(AccountNumber account, const std::vector<unsigned char>& key)
   {
      auto row = to<Accounts>().getAccount(account);
      if (!row || row->authService != AuthSig::AuthSig::service)
         return false;
      auto type = keyType(key);
      if (!type)
         return false;
      // The account may have chosen any verifier allowed for the key; which
      // one makes no difference to whose key it is.
      std::vector<Claim> claims;
      for (auto verifier : allowedVerifiers(*type))
         claims.push_back(Claim{.service = verifier, .rawData = {key.begin(), key.end()}});
      return to<AuthSig::AuthSig>().checkAuthSys(AuthInterface::firstAuthFlag, account,
                                                 ServiceMethod{}, std::move(claims));
   }

   // Notices that an issued creation transaction has landed.
   SignupLink settle(SignupLink link)
   {
      if (link.account || !link.pending)
         return link;
      auto name    = *link.pending;
      auto account = to<Accounts>().getAccount(name);
      bool mine    = account && hasKey(name, link.pending_key);
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
      return link;
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
      return hasKey(config.sponsor, row->key.data);
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
      PSIO_REFLECT(Status, open, providers, attr(guest, utf8), link)
   };

   LinkInfo describe(const SignupLink& link)
   {
      return LinkInfo{link.provider, link.handle, link.account, link.pending};
   }

   HttpReply serveStatus(const HttpRequest& req, const SessionInfo& session)
   {
      auto   config = readConfig();
      Status status{.open = config.open && sponsorReady(config), .guest = session.guest};
      for (const auto& p : config.providers)
      {
         auto full = withDefaults(p);
         if (usable(full))
            status.providers.push_back({full.name, *full.label});
      }
      if (config.dev_provider)
         status.providers.push_back({devProvider, "Development sign-in (no identity check)"});
      if (!session.guest.empty())
         if (auto link = linkOfGuest(session.guest))
            status.link = describe(settle(std::move(*link)));
      return json(req, status);
   }

   // --------------------------------------------------------------- oauth

   struct StartRequest
   {
      std::string provider;
      std::string browser;
      std::string resume;
      PSIO_REFLECT(StartRequest, attr(provider, utf8), attr(browser, utf8), attr(resume, utf8))
   };

   struct StartReply
   {
      // Where to send the browser; empty when the link is already made.
      std::string             url;
      std::optional<LinkInfo> link;
      PSIO_REFLECT(StartReply, attr(url, utf8), link)
   };

   HttpReply serveStart(const HttpRequest&          req,
                        std::optional<std::int32_t> socket,
                        const SessionInfo&          session)
   {
      auto body   = psio::from_ijson<StartRequest>(req.body);
      auto config = readConfig();
      if (!config.open)
         return fail(req, HttpStatus::serviceUnavailable, "This node is not creating accounts.");

      if (body.provider == devProvider)
      {
         if (!config.dev_provider)
            return fail(req, HttpStatus::notFound, "Unknown sign-in provider.");
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
          .expires       = now + authRequestTtl};
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
                                 .origin   = std::string{req.getHeader("origin").value_or("")}});
      PSIBASE_SUBJECTIVE_TX
      {
         to<XHttp>().autoClose(*socket, false);
      }
      return std::nullopt;
   }

   // -------------------------------------------------------------- create

   struct CreateRequest
   {
      std::string       name;
      std::vector<char> key;
      PSIO_REFLECT(CreateRequest, attr(name, utf8), key)
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

      // The account gets the guest's own key: the one this session proved.
      SubjectPublicKeyInfo key{{body.key.begin(), body.key.end()}};
      if (guestIdOf(key.data) != session.guest || !verifierFor(key.data))
         return fail(req, HttpStatus::forbidden, "That is not this guest's key.");

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
      link.pending_key   = key.data;
      link.pending_until = wallNow() + std::chrono::seconds(creationSeconds + 15);
      PSIBASE_SUBJECTIVE_TX
      {
         XSignup{}.open<SignupLinkTable>().put(link);
      }

      Action create{.sender  = config.sponsor,
                    .service = AuthSig::AuthSig::service,
                    .method  = MethodNumber{"newAccount"},
                    // The guest has one key: it is both the owner and the
                    // active key. The sponsor, as the sender, becomes the
                    // account's recovery partner.
                    .rawData = psio::to_pssz(std::tuple{name, AuthSig::KeySpec::of(key),
                                                        AuthSig::KeySpec::of(key)})};
      auto   trx = to<XKeys>().signTxFor(std::vector<Action>{std::move(create)}, creationSeconds);
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

   if (target == "/oauth/start" || target == "/oauth/finish" || target == "/create")
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
      return serveCreate(request, session);
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

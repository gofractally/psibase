#include <psibase/ConfigFile.hpp>
#include <psibase/EcdsaProver.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/bft.hpp>
#include <psibase/cft.hpp>
#include <psibase/direct_routing.hpp>
#include <psibase/http.hpp>
#include <psibase/log.hpp>
#include <psibase/node.hpp>
#include <psibase/peer_manager.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/websocket.hpp>
#include <psio/finally.hpp>
#include <psio/to_json.hpp>

#include <boost/algorithm/string/replace.hpp>
#include <boost/log/core/core.hpp>
#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>
#include <boost/program_options/parsers.hpp>
#include <boost/program_options/variables_map.hpp>

#include <boost/asio/ssl/host_name_verification.hpp>
#include <boost/asio/system_timer.hpp>

#include <charconv>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <thread>

using namespace psibase;
using namespace psibase::net;

using http::listen_spec;

struct native_service
{
   std::string           host;
   std::filesystem::path root;
   friend auto           operator<=>(const native_service&, const native_service&) = default;
};
PSIO_REFLECT(native_service, host, root)

void to_json(const native_service& obj, auto& stream)
{
   stream.write('{');
   to_json("host", stream);
   stream.write(':');
   to_json(obj.host, stream);
   stream.write(',');
   to_json("root", stream);
   stream.write(':');
   to_json(obj.root.native(), stream);
   stream.write('}');
}

void from_json(native_service& obj, auto& stream)
{
   psio::from_json_object(stream,
                          [&](std::string_view key)
                          {
                             if (key == "host")
                             {
                                obj.host = stream.get_string();
                             }
                             else if (key == "root")
                             {
                                obj.root = stream.get_string();
                             }
                             else
                             {
                                psio::from_json_skip_value(stream);
                             }
                          });
}

std::string to_string(const native_service& obj)
{
   return obj.host + ":" + obj.root.native();
}

struct autoconnect_t
{
   static constexpr std::size_t max   = std::numeric_limits<std::size_t>::max();
   std::size_t                  value = max;
};

void to_json(const autoconnect_t& obj, auto& stream)
{
   if (obj.value == autoconnect_t::max)
   {
      to_json(true, stream);
   }
   else
   {
      to_json(obj.value, stream);
   }
}

void from_json(autoconnect_t& obj, auto& stream)
{
   auto t = stream.peek_token();
   if (t.get().type == psio::json_token_type::type_bool)
   {
      if (stream.get_bool())
      {
         obj.value = autoconnect_t::max;
      }
      else
      {
         obj.value = 0;
      }
   }
   else
   {
      from_json(obj.value, stream);
   }
}

void validate(boost::any& v, const std::vector<std::string>& values, autoconnect_t*, int)
{
   boost::program_options::validators::check_first_occurrence(v);
   auto s = boost::program_options::validators::get_single_string(values);
   if (s == "on" || s == "true")
   {
      v = autoconnect_t{};
   }
   else if (s == "off" || s == "false")
   {
      v = autoconnect_t{0};
   }
   else
   {
      v = autoconnect_t{boost::lexical_cast<std::size_t>(s)};
   }
}

std::filesystem::path get_prefix()
{
   auto prefix = std::filesystem::read_symlink("/proc/self/exe").parent_path();
   if (prefix.filename() == "bin")
   {
      prefix = prefix.parent_path();
   }
   return prefix;
}

std::filesystem::path option_path;
std::filesystem::path parse_path(std::string_view             s,
                                 const std::filesystem::path& context = option_path)
{
   if (s.starts_with("$PREFIX"))
   {
      return get_prefix() / std::filesystem::path(s.substr(7)).relative_path();
   }
   else
   {
      return context / s;
   }
}

void parse_config(native_service&              service,
                  std::string_view             str,
                  const std::filesystem::path& context = option_path)
{
   auto pos = str.find(':');
   if (pos == std::string_view::npos)
   {
      service.root = parse_path(str, context);
      service.host = (service.root.has_filename() ? service.root.filename()
                                                  : service.root.parent_path().filename())
                         .native() +
                     ".";
   }
   else
   {
      service.host = str.substr(0, pos);
      service.root = parse_path(str.substr(pos + 1), context);
   }
}

native_service service_from_string(std::string_view s)
{
   native_service result;
   parse_config(result, s);
   return result;
}

void validate(boost::any& v, const std::vector<std::string>& values, native_service*, int)
{
   boost::program_options::validators::check_first_occurrence(v);
   native_service result;
   parse_config(result, boost::program_options::validators::get_single_string(values));
   v = std::move(result);
}

std::filesystem::path config_template_path()
{
   return get_prefix() / "share" / "psibase" / "config.in";
}

void load_service(const native_service& config,
                  http::services_t&     services,
                  const std::string&    root_host)
{
   auto  host    = config.host.ends_with('.') ? config.host + root_host : config.host;
   auto& service = services[config.host];
   for (const auto& entry : std::filesystem::recursive_directory_iterator{config.root})
   {
      auto                 extension = entry.path().filename().extension().native();
      http::native_content result;
      if (extension == ".html")
      {
         result.content_type = "text/html";
      }
      else if (extension == ".svg")
      {
         result.content_type = "image/svg+xml";
      }
      else if (extension == ".js" || extension == ".mjs")
      {
         result.content_type = "text/javascript";
      }
      else if (extension == ".css")
      {
         result.content_type = "text/css";
      }
      else if (extension == ".ttf")
      {
         result.content_type = "font/ttf";
      }
      if (!result.content_type.empty() && entry.is_regular_file())
      {
         result.path = entry.path();
         auto path   = "/" + entry.path().lexically_relative(config.root).generic_string();
         service.try_emplace(path, result);
         if (path.ends_with("/index.html"))
         {
            service.try_emplace(path.substr(0, path.size() - 10), result);
            if (path.size() > 11)
            {
               service.try_emplace(path.substr(0, path.size() - 11), result);
            }
         }
      }
   }
}

namespace psibase
{
   void validate(boost::any& v, const std::vector<std::string>& values, PrivateKey*, int)
   {
      boost::program_options::validators::check_first_occurrence(v);
      v = privateKeyFromString(boost::program_options::validators::get_single_string(values));
   }

   void validate(boost::any&                     v,
                 const std::vector<std::string>& values,
                 std::shared_ptr<Prover>*,
                 int)
   {
      boost::program_options::validators::check_first_occurrence(v);
      const auto& s = boost::program_options::validators::get_single_string(values);
      if (s.starts_with('{'))
      {
         auto key = psio::convert_from_json<ClaimKey>(s);
         if (key.service.str() != "verifyec-sys")
         {
            throw std::runtime_error("Not implemented: keys from service " + key.service.str());
         }
         auto result = std::make_shared<EcdsaSecp256K1Sha256Prover>(
             key.service, psio::convert_from_frac<PrivateKey>(key.rawData));
         v = std::shared_ptr<Prover>(std::move(result));
      }
      else
      {
         auto result = std::make_shared<EcdsaSecp256K1Sha256Prover>(AccountNumber{"verifyec-sys"},
                                                                    privateKeyFromString(s));
         v           = std::shared_ptr<Prover>(std::move(result));
      }
   }

   namespace http
   {
      void validate(boost::any& v, const std::vector<std::string>& values, admin_service*, int)
      {
         boost::program_options::validators::check_first_occurrence(v);
         const auto& s = boost::program_options::validators::get_single_string(values);
         v             = admin_service_from_string(s);
      }

      void validate(boost::any& v, const std::vector<std::string>& values, listen_spec*, int)
      {
         boost::program_options::validators::check_first_occurrence(v);
         v = parse_listen(boost::program_options::validators::get_single_string(values));
      }
   }  // namespace http
}  // namespace psibase

struct transaction_queue
{
   struct entry
   {
      bool                            is_boot = false;
      std::vector<char>               packed_signed_trx;
      http::push_boot_callback        boot_callback;
      http::push_transaction_callback callback;
   };

   std::mutex         mutex;
   std::vector<entry> entries;
};

#define RETHROW_BAD_ALLOC  \
   catch (std::bad_alloc&) \
   {                       \
      throw;               \
   }

#define CATCH_IGNORE \
   catch (...) {}

bool push_boot(BlockContext& bc, transaction_queue::entry& entry)
{
   try
   {
      // TODO: verify no extra data
      // TODO: view
      auto transactions =
          psio::convert_from_frac<std::vector<SignedTransaction>>(entry.packed_signed_trx);
      TransactionTrace trace;

      try
      {
         if (!bc.needGenesisAction)
         {
            trace.error = "chain is already booted";
         }
         else
         {
            for (auto& trx : transactions)
            {
               trace = {};
               if (!trx.proofs.empty())
                  // Proofs execute as of the state at the beginning of a block.
                  // That state is empty, so there are no proof services installed.
                  trace.error = "Transactions in boot block may not have proofs";
               else
                  bc.pushTransaction(trx, trace, std::nullopt);
            }
         }
      }
      RETHROW_BAD_ALLOC
      catch (...)
      {
         // Don't give a false positive
         if (!trace.error)
            throw;
      }

      try
      {
         if (trace.error)
         {
            entry.boot_callback(std::move(trace.error));
         }
         else
         {
            entry.boot_callback(std::nullopt);
            return true;
         }
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
   RETHROW_BAD_ALLOC
   catch (std::exception& e)
   {
      try
      {
         entry.boot_callback(e.what());
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
   catch (...)
   {
      try
      {
         entry.boot_callback("unknown error");
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
   return false;
}  // push_boot

template <typename Timer, typename F>
void loop(Timer& timer, F&& f)
{
   using namespace std::literals::chrono_literals;
   timer.expires_after(100ms);
   timer.async_wait(
       [&timer, f](const std::error_code& e)
       {
          f(e);
          if (!e)
          {
             loop(timer, f);
          }
       });
}

void pushTransaction(psibase::SharedState&                  sharedState,
                     const std::shared_ptr<const Revision>& revisionAtBlockStart,
                     BlockContext&                          bc,
                     SystemContext&                         proofSystem,
                     transaction_queue::entry&              entry,
                     std::chrono::microseconds              firstAuthWatchdogLimit,
                     std::chrono::microseconds              proofWatchdogLimit,
                     std::chrono::microseconds              initialWatchdogLimit)
{
   try
   {
      // TODO: verify no extra data
      // TODO: view
      auto             trx = psio::convert_from_frac<SignedTransaction>(entry.packed_signed_trx);
      TransactionTrace trace;

      try
      {
         if (bc.needGenesisAction)
            trace.error = "Need genesis block; use 'psibase boot' to boot chain";
         else
         {
            // All proofs execute as of the state at block begin. This will allow
            // consistent parallel execution of all proofs within a block during
            // replay. Proofs don't have direct database access, but they do rely
            // on the set of services stored within the database. They may call
            // other services; e.g. to call crypto functions.
            //
            // TODO: move proof execution to background threads
            // TODO: track CPU usage of proofs and pass it somehow to the main
            //       execution for charging
            // TODO: If by the time the transaction executes it's on a different
            //       block than the proofs were verified on, then either the proofs
            //       need to be rerun, or the hashes of the services which ran
            //       during the proofs need to be compared against the current
            //       service hashes. This will prevent a poison block.
            // TODO: If the first proof and the first auth pass, but the transaction
            //       fails (including other proof failures), then charge the first
            //       authorizer
            BlockContext proofBC{proofSystem, revisionAtBlockStart};
            proofBC.start(bc.current.header.time);
            for (size_t i = 0; i < trx.proofs.size(); ++i)
            {
               proofBC.verifyProof(trx, trace, i, proofWatchdogLimit);
               trace = {};
            }

            // TODO: in another thread: check first auth and first proof. After
            //       they pass, schedule the remaining proofs. After they pass,
            //       schedule the transaction for execution in the main thread.
            //
            // The first auth check is a prefiltering measure and is mostly redundant
            // with main execution. Unlike the proofs, the first auth check is allowed
            // to run with any state on any fork. This is OK since the main execution
            // checks all auths including the first; the worst that could happen is
            // the transaction being rejected because it passes on one fork but not
            // another, potentially charging the user for the failed transaction. The
            // first auth check, when not part of the main execution, runs in read-only
            // mode. TransactionSys lets the account's auth service know it's in a
            // read-only mode so it doesn't fail the transaction trying to update its
            // tables.
            //
            // Replay doesn't run the first auth check separately. This separate
            // execution is a subjective measure; it's possible, but not advisable,
            // for a modified node to skip it during production. This won't hurt
            // consensus since replay never uses read-only mode for auth checks.
            auto saveTrace = trace;
            proofBC.checkFirstAuth(trx, trace, firstAuthWatchdogLimit);
            trace = std::move(saveTrace);

            // TODO: RPC: don't forward failed transactions to P2P; this gives users
            //       feedback.
            // TODO: P2P: do forward failed transactions; this enables producers to
            //       bill failed transactions which have tied up P2P nodes.
            // TODO: If the first authorizer doesn't have enough to bill for failure,
            //       then drop before running any other checks. Don't propagate.
            // TODO: Don't propagate failed transactions which have
            //       do_not_broadcast_flag.
            // TODO: Revisit all of this. It doesn't appear to eliminate the need to
            //       shadow bill, and once shadow billing is in place, failed
            //       transaction billing seems unnecessary.

            bc.pushTransaction(trx, trace, initialWatchdogLimit);
         }
      }
      RETHROW_BAD_ALLOC
      catch (...)
      {
         // Don't give a false positive
         if (!trace.error)
            throw;
      }

      try
      {
         entry.callback(std::move(trace));
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
   RETHROW_BAD_ALLOC
   catch (std::exception& e)
   {
      try
      {
         entry.callback(e.what());
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
   catch (...)
   {
      try
      {
         entry.callback("unknown error");
      }
      RETHROW_BAD_ALLOC
      CATCH_IGNORE
   }
}  // pushTransaction

std::tuple<bool, std::string_view, std::string_view> parse_endpoint(std::string_view peer)
{
   // TODO: handle ipv6 addresses [addr]:port
   bool secure = false;
   if (peer.starts_with("ws://"))
   {
      peer = peer.substr(5);
   }
   else if (peer.starts_with("http://"))
   {
      peer = peer.substr(7);
   }
   else if (peer.starts_with("wss://"))
   {
      secure = true;
      peer   = peer.substr(6);
   }
   else if (peer.starts_with("https://"))
   {
      secure = true;
      peer   = peer.substr(8);
   }
   if (peer.ends_with('/'))
   {
      peer = peer.substr(0, peer.size() - 1);
   }
   auto pos = peer.find(':');
   if (pos == std::string_view::npos)
   {
      return {secure, peer, secure ? "443" : "80"};
   }
   else
   {
      return {secure, peer.substr(0, pos), peer.substr(pos + 1)};
   }
}

std::vector<std::string> translate_endpoints(std::vector<std::string> urls)
{
   for (auto& url : urls)
   {
      if (!url.starts_with("http:") && !url.starts_with("ws:") && !url.starts_with("https") &&
          !url.starts_with("wss:"))
      {
         url = "http://" + url + "/";
      }
   }
   return urls;
}

struct ShutdownRequest
{
   bool restart = false;
   bool force   = false;
   bool soft    = false;
};
PSIO_REFLECT(ShutdownRequest, restart, force, soft);

// connect,disconnect

struct ConnectRequest
{
   std::string url;
};
PSIO_REFLECT(ConnectRequest, url);

struct DisconnectRequest
{
   peer_id id;
};
PSIO_REFLECT(DisconnectRequest, id);

struct NewKeyRequest
{
   AccountNumber                    service;
   std::optional<std::vector<char>> rawData;
};
PSIO_REFLECT(NewKeyRequest, service, rawData);

struct RestartInfo
{
   // If the server stops for any reason other than an explicit
   // shutdown request, then all the other parameters should be ignored.
   std::atomic<bool> shutdownRequested = false;
   std::atomic<bool> shouldRestart     = true;
   std::atomic<bool> soft              = true;
   bool              keysChanged       = false;
   bool              configChanged     = false;
};
PSIO_REFLECT(RestartInfo, shouldRestart);

struct PsinodeConfig
{
   bool                        p2p = false;
   std::vector<std::string>    peers;
   autoconnect_t               autoconnect;
   AccountNumber               producer;
   std::string                 host;
   std::vector<listen_spec>    listen;
   std::vector<native_service> services;
   http::admin_service         admin;
   psibase::loggers::Config    loggers;
};
PSIO_REFLECT(PsinodeConfig,
             p2p,
             peers,
             autoconnect,
             producer,
             host,
             listen,
             services,
             admin,
             loggers);

void to_config(const PsinodeConfig& config, ConfigFile& file)
{
   file.set("", "p2p", config.p2p ? "on" : "off", "Whether to accept incoming P2P connections");
   if (!config.peers.empty())
   {
      file.set(
          "", "peer", config.peers, [](std::string_view text) { return std::string(text); },
          "Peer URL's");
   }
   if (config.autoconnect.value != autoconnect_t::max)
   {
      file.set("", "autoconnect", std::to_string(config.autoconnect.value),
               "The preferred number of outgoing peer connections.");
   }
   if (config.producer != AccountNumber())
   {
      file.set("", "producer", config.producer.str(), "The name to use for block production");
   }
   if (!config.host.empty())
   {
      file.set("", "host", config.host, "The HTTP server's host name");
   }
   if (!config.listen.empty())
   {
      std::vector<std::string> listen;
      for (const auto& l : config.listen)
      {
         listen.push_back(to_string(l));
      }
      file.set(
          "", "listen", listen, [](std::string_view text) { return std::string(text); },
          "TCP or local socket endpoint on which the server accepts connections");
   }
   if (!config.services.empty())
   {
      std::vector<std::string> services;
      for (const auto& service : config.services)
      {
         services.push_back(to_string(service));
      }
      file.set(
          "", "service", services,
          [](std::string_view text) { return service_from_string(text).host; },
          "Native service root directory");
   }
   if (!std::holds_alternative<http::admin_none>(config.admin))
   {
      file.set("", "admin", std::visit([](const auto& v) { return v.str(); }, config.admin),
               "Which services can access the admin API");
   }
   // TODO: Not implemented yet.  Sign needs some thought,
   // because it's probably a bad idea to reveal the
   // private keys.
   file.keep("", "key");
   file.keep("", "leeway");
   //
   to_config(config.loggers, file);
}

using timer_type = boost::asio::system_timer;

template <typename Derived>
using cft_consensus = basic_cft_consensus<blocknet<Derived, timer_type>, timer_type>;

template <typename Derived>
using bft_consensus = basic_bft_consensus<blocknet<Derived, timer_type>, timer_type>;

template <typename Derived, typename Timer>
using basic_consensus =
    basic_bft_consensus<basic_cft_consensus<blocknet<Derived, Timer>, Timer>, Timer>;

template <typename Derived>
using consensus = basic_consensus<Derived, timer_type>;

void run(const std::string&              db_path,
         AccountNumber                   producer,
         std::shared_ptr<CompoundProver> prover,
         const std::vector<std::string>& peers,
         autoconnect_t                   autoconnect,
         bool                            enable_incoming_p2p,
         std::string                     host,
         std::vector<listen_spec>        listen,
         std::vector<native_service>&    services,
         http::admin_service&            admin,
         const std::vector<std::string>& root_ca,
         const std::string&              tls_cert,
         const std::string&              tls_key,
         uint32_t                        leeway_us,
         RestartInfo&                    runResult)
{
   ExecutionContext::registerHostFunctions();

   // TODO: configurable WasmCache size
   auto sharedState =
       std::make_shared<psibase::SharedState>(SharedDatabase{db_path, true}, WasmCache{128});
   auto system      = sharedState->getSystemContext();
   auto proofSystem = sharedState->getSystemContext();
   auto queue       = std::make_shared<transaction_queue>();

   if (system->sharedDatabase.isSlow())
   {
      PSIBASE_LOG(psibase::loggers::generic::get(), error)
          << "unable to lock memory for " << db_path
          << ". Try upgrading your shell's limits using \"sudo prlimit --memlock=-1 --pid "
             "$$\". "
             "If that doesn't work, try running psinode with \"sudo\".";
   }

   // If the server's config file doesn't exist yet, create it
   {
      auto config_path = std::filesystem::path(db_path) / "config";
      if (!std::filesystem::exists(config_path))
      {
         auto template_path = config_template_path();
         if (std::filesystem::is_regular_file(template_path))
         {
            std::filesystem::copy_file(template_path, config_path);
         }
      }
   }

   // http_config must live until server shutdown which happens when chainContext
   // is destroyed.
   auto http_config = std::make_shared<http::http_config>();

   boost::asio::io_context chainContext;

   auto server_work = boost::asio::make_work_guard(chainContext);

#ifdef PSIBASE_ENABLE_SSL
   http_config->tls_context =
       std::make_shared<boost::asio::ssl::context>(boost::asio::ssl::context::tlsv13);
   boost::asio::ssl::context& sslContext(*http_config->tls_context);
   if (root_ca.empty())
   {
      sslContext.set_default_verify_paths();
   }
   else
   {
      for (const auto& ca : root_ca)
      {
         sslContext.load_verify_file(ca);
      }
   }
   if (!tls_cert.empty())
   {
      sslContext.use_certificate_chain_file(tls_cert);
      sslContext.use_private_key_file(tls_key, boost::asio::ssl::context::pem);
   }
#endif

   using node_type = node<peer_manager, direct_routing, consensus, ForkDb>;
   node_type node(chainContext, system.get(), prover);
   node.set_producer_id(producer);
   node.load_producers();

   // Used for outgoing connections
   boost::asio::ip::tcp::resolver resolver(chainContext);

   auto connect_one = [&resolver, &node, &chainContext, &http_config, &runResult](
                          const std::string& peer, auto&& f)
   {
      auto [secure, host, service] = parse_endpoint(peer);
      auto do_connect              = [&](auto&& conn)
      {
         conn->url = peer;
         async_connect(std::move(conn), resolver, host, service,
                       [&node, &http_config, &runResult, f = static_cast<decltype(f)>(f)](
                           const std::error_code& ec, auto&& conn)
                       {
                          if (!ec)
                          {
                             if (http_config->status.load().shutdown)
                             {
                                conn->close(runResult.shouldRestart
                                                ? connection_base::close_code::restart
                                                : connection_base::close_code::shutdown);
                                f(make_error_code(boost::asio::error::operation_aborted));
                                return;
                             }
                             node.add_connection(std::move(conn));
                          }
                          f(ec);
                       });
      };
      if (secure)
      {
#if PSIBASE_ENABLE_SSL
         auto conn = std::make_shared<
             websocket_connection<boost::beast::ssl_stream<boost::beast::tcp_stream>>>(
             chainContext, *http_config->tls_context);
         conn->stream.next_layer().set_verify_mode(boost::asio::ssl::verify_peer);
         conn->stream.next_layer().set_verify_callback(
             boost::asio::ssl::host_name_verification(std::string(host)));
         do_connect(std::move(conn));
#else
         PSIBASE_LOG(psibase::loggers::generic::get(), warning)
             << "Connection to " << peer
             << " not attempted because psinode was built without TLS support";
         boost::asio::post(chainContext, [f = static_cast<decltype(f)>(f)]
                           { f(std::error_code(EPROTONOSUPPORT, std::generic_category())); });
#endif
      }
      else
      {
         do_connect(std::make_shared<websocket_connection<boost::beast::tcp_stream>>(chainContext));
      }
   };

   timer_type timer(chainContext);

   if (!listen.empty())
   {
      // TODO: command-line options
      http_config->num_threads         = 4;
      http_config->max_request_size    = 20 * 1024 * 1024;
      http_config->idle_timeout_ms     = std::chrono::milliseconds{4000};
      http_config->allow_origin        = "*";
      http_config->listen              = listen;
      http_config->host                = host;
      http_config->enable_transactions = !host.empty();
      http_config->status =
          http::http_status{.slow = system->sharedDatabase.isSlow(), .startup = 1};

      for (const auto& entry : services)
      {
         load_service(entry, http_config->services, host);
      }
      http_config->admin = admin;

      // TODO: speculative execution on non-producers
      http_config->push_boot_async =
          [queue](std::vector<char> packed_signed_transactions, http::push_boot_callback callback)
      {
         std::scoped_lock lock{queue->mutex};
         queue->entries.push_back(
             {true, std::move(packed_signed_transactions), std::move(callback), {}});
      };

      http_config->push_transaction_async =
          [queue](std::vector<char> packed_signed_trx, http::push_transaction_callback callback)
      {
         std::scoped_lock lock{queue->mutex};
         queue->entries.push_back({false, std::move(packed_signed_trx), {}, std::move(callback)});
      };

      http_config->accept_p2p_websocket = [&chainContext, &node](auto&& stream)
      {
         boost::asio::post(
             chainContext,
             [&node, stream = std::move(stream)]() mutable
             {
                node.add_connection(
                    std::make_shared<websocket_connection<
                        typename std::remove_cv_t<decltype(stream)>::next_layer_type>>(
                        std::move(stream)));
             });
      };

      http_config->shutdown = [&chainContext, &node, &http_config, &connect_one, &timer, &runResult,
                               &server_work](std::vector<char> data)
      {
         data.push_back('\0');
         psio::json_token_stream stream(data.data());
         auto [restart, force, soft] = psio::from_json<ShutdownRequest>(stream);
         // In the case of concurrent shutdown requests, prefer shutdown over
         // restart and hard restart over soft restart.
         runResult.shutdownRequested = true;
         if (!restart)
            runResult.shouldRestart = false;
         if (!soft)
            runResult.soft = false;
         if (force)
         {
            chainContext.stop();
         }
         else
         {
            boost::asio::post(chainContext,
                              [&chainContext, &node, &connect_one, &http_config, &timer, &runResult,
                               &server_work, restart, soft]()
                              {
                                 auto status     = http_config->status.load();
                                 status.shutdown = true;
                                 http_config->status.store(status);
                                 boost::asio::use_service<http::server_service>(
                                     static_cast<boost::asio::execution_context&>(chainContext))
                                     .async_close(restart,
                                                  [&chainContext, &server_work]() {
                                                     boost::asio::post(chainContext,
                                                                       [&server_work]()
                                                                       { server_work.reset(); });
                                                  });
                                 timer.cancel();
                                 node.consensus().async_shutdown();
                                 node.peers().autoconnect({}, 0, connect_one);
                                 node.peers().disconnect_all(restart);
                              });
         }
      };

      http_config->get_peers = [&chainContext, &node](http::get_peers_callback callback)
      {
         boost::asio::post(chainContext,
                           [&chainContext, &node, callback = std::move(callback)]
                           {
                              http::get_peers_result result;
                              for (const auto& [id, conn] : node.peers().connections())
                              {
                                 result.push_back({id, conn->endpoint(), conn->url});
                              }
                              callback(std::move(result));
                           });
      };

      http_config->connect = [&chainContext, &node, &resolver, &connect_one](
                                 std::vector<char> peer, http::connect_callback callback)
      {
         peer.push_back('\0');
         psio::json_token_stream stream(peer.data());

         boost::asio::post(chainContext,
                           [&chainContext, &node, &resolver, &connect_one,
                            peer     = psio::from_json<ConnectRequest>(stream),
                            callback = std::move(callback)]() mutable
                           {
                              // TODO: This is currently fire-and-forget, do we want
                              // to try to report errors establishing the connection?
                              // If so, when do we consider it successful? TCP connection?
                              // websocket handshake? Initial sync negotiation?
                              node.peers().connect(peer.url, connect_one);
                              callback(std::nullopt);
                           });
      };

      http_config->disconnect =
          [&chainContext, &node, &resolver](std::vector<char> peer, http::connect_callback callback)
      {
         peer.push_back('\0');
         psio::json_token_stream stream(peer.data());

         boost::asio::post(
             chainContext,
             [&chainContext, &node, &resolver, peer = psio::from_json<DisconnectRequest>(stream),
              callback = std::move(callback)]() mutable
             {
                if (!node.peers().disconnect(peer.id, connection_base::close_code::normal))
                {
                   callback("Unknown peer");
                }
                else
                {
                   callback(std::nullopt);
                }
             });
      };

      http_config->set_config =
          [&chainContext, &node, &db_path, &runResult, &http_config, &host, &admin, &services,
           &connect_one](std::vector<char> json, http::connect_callback callback)
      {
         json.push_back('\0');
         psio::json_token_stream stream(json.data());

         boost::asio::post(chainContext,
                           [&chainContext, &node, config = psio::from_json<PsinodeConfig>(stream),
                            &db_path, &runResult, &http_config, &host, &services, &admin,
                            &connect_one, callback = std::move(callback)]() mutable
                           {
                              std::optional<http::services_t> new_services;
                              if (services != config.services || host != config.host)
                              {
                                 new_services.emplace();
                                 for (const auto& entry : config.services)
                                 {
                                    load_service(entry, *new_services, config.host);
                                 }
                              }
                              node.set_producer_id(config.producer);
                              http_config->enable_p2p = config.p2p;
                              if (!http_config->status.load().shutdown)
                              {
                                 node.autoconnect(std::vector(config.peers),
                                                  config.autoconnect.value, connect_one);
                              }
                              host     = config.host;
                              services = config.services;
                              admin    = config.admin;
                              loggers::configure(config.loggers);
                              {
                                 std::shared_lock l{http_config->mutex};
                                 http_config->host                = host;
                                 http_config->listen              = config.listen;
                                 http_config->admin               = admin;
                                 http_config->enable_transactions = !host.empty();
                                 if (new_services)
                                 {
                                    // Use swap instead of move to delay freeing the old
                                    // services until after releasing the mutex
                                    http_config->services.swap(*new_services);
                                 }
                              }
                              {
                                 auto       path = std::filesystem::path(db_path) / "config";
                                 ConfigFile file;
                                 {
                                    std::ifstream in(path);
                                    file.parse(in);
                                 }
                                 to_config(config, file);
                                 {
                                    std::ofstream out(path);
                                    file.write(out);
                                 }
                                 runResult.configChanged = true;
                              }
                              callback(std::nullopt);
                           });
      };

      http_config->get_config = [&chainContext, &node, &http_config, &host, &admin,
                                 &services](http::get_config_callback callback)
      {
         boost::asio::post(chainContext,
                           [&chainContext, &node, &http_config, &host, &services, &admin,
                            callback = std::move(callback)]() mutable
                           {
                              PsinodeConfig result;
                              result.p2p = http_config->enable_p2p;
                              std::tie(result.peers, result.autoconnect.value) = node.autoconnect();
                              result.producer = node.producer_name();
                              result.host     = host;
                              result.listen   = http_config->listen;
                              result.services = services;
                              result.admin    = admin;
                              result.loggers  = loggers::Config::get();
                              callback(
                                  [result = std::move(result)]() mutable
                                  {
                                     std::vector<char>   json;
                                     psio::vector_stream stream(json);
                                     to_json(result, stream);
                                     return json;
                                  });
                           });
      };

      http_config->get_keys = [&chainContext, &prover](auto callback)
      {
         boost::asio::post(chainContext,
                           [&prover, callback = std::move(callback)]()
                           {
                              std::vector<Claim> result;
                              prover->get(result);
                              callback(
                                  [result = std::move(result)]() mutable
                                  {
                                     std::vector<char>   json;
                                     psio::vector_stream stream(json);
                                     to_json(result, stream);
                                     return json;
                                  });
                           });
      };

      http_config->new_key =
          [&chainContext, &prover, &db_path, &runResult](std::vector<char> json, auto callback)
      {
         json.push_back('\0');
         psio::json_token_stream stream(json.data());
         auto                    key = psio::from_json<NewKeyRequest>(stream);
         if (key.service.str() != "verifyec-sys")
         {
            throw std::runtime_error("Not implemented for native signing: " + key.service.str());
         }
         boost::asio::post(
             chainContext,
             [&prover, &db_path, &runResult, callback = std::move(callback),
              key = std::move(key)]() mutable
             {
                try
                {
                   std::shared_ptr<EcdsaSecp256K1Sha256Prover> result;
                   if (key.rawData)
                   {
                      result = std::make_shared<EcdsaSecp256K1Sha256Prover>(
                          key.service, psio::convert_from_frac<PrivateKey>(*key.rawData));
                   }
                   else
                   {
                      result = std::make_shared<EcdsaSecp256K1Sha256Prover>(key.service);
                   }
                   std::vector<Claim> existing;
                   prover->get(existing);
                   auto claim = result->get();
                   if (std::find(existing.begin(), existing.end(), claim) == existing.end())
                   {
                      prover->add(std::move(result));

                      auto       path = std::filesystem::path(db_path) / "config";
                      ConfigFile file;
                      {
                         std::ifstream in(path);
                         file.parse(in);
                      }
                      std::vector<ClaimKey> allKeys;
                      prover->get(allKeys);
                      std::vector<std::string> stringKeys;
                      for (const auto& k : allKeys)
                      {
                         stringKeys.push_back(psio::convert_to_json(k));
                      }
                      file.set(
                          "", "key", stringKeys, [](std::string_view s) { return std::string(s); },
                          "");
                      {
                         std::ofstream out(path);
                         file.write(out, true);
                      }
                      runResult.keysChanged = true;
                   }
                   callback(
                       [result = std::move(claim)]() mutable
                       {
                          std::vector<char>   json;
                          psio::vector_stream stream(json);
                          to_json(result, stream);
                          return json;
                       });
                }
                catch (std::exception& e)
                {
                   callback(e.what());
                }
             });
      };

      boost::asio::make_service<http::server_service>(chainContext, http_config, sharedState);
   }
   else
   {
      server_work.reset();
   }

   node.set_producer_id(producer);
   http_config->enable_p2p = enable_incoming_p2p;
   {
      // For now no one else writes the status, so we don't need an atomic RMW.
      auto status         = http_config->status.load();
      status.startup      = false;
      http_config->status = status;
   }

   bool showedBootMsg = false;

   node.autoconnect(translate_endpoints(peers), autoconnect.value, connect_one);

   // TODO: post the transactions to chainContext rather than batching them at fixed intervals.
   auto process_transactions = [&](const std::error_code& ec)
   {
      std::vector<transaction_queue::entry> entries;
      {
         std::scoped_lock lock{queue->mutex};
         std::swap(entries, queue->entries);
      }
      auto fail_all = [&](const std::string& message)
      {
         for (auto& entry : entries)
         {
            if (entry.callback)
            {
               entry.callback(message);
            }
            else if (entry.boot_callback)
            {
               entry.boot_callback(message);
            }
         }
      };
      if (ec)
      {
         // TODO: 503
         fail_all("The server is shutting down");
      }
      else if (auto bc = node.chain().getBlockContext())
      {
         auto revisionAtBlockStart = node.chain().getHeadRevision();
         for (auto& entry : entries)
         {
            if (entry.is_boot)
               push_boot(*bc, entry);
            else
               pushTransaction(*sharedState, revisionAtBlockStart, *bc, *proofSystem, entry,
                               std::chrono::microseconds(leeway_us),  // TODO
                               std::chrono::microseconds(leeway_us),  // TODO
                               std::chrono::microseconds(leeway_us));
         }

         // TODO: this should go in the leader's production loop
         if (bc->needGenesisAction)
         {
            if (!showedBootMsg)
            {
               PSIBASE_LOG(node.chain().getLogger(), notice)
                   << "Need genesis block; use 'psibase boot' to boot chain";
               showedBootMsg = true;
            }
            //continue;
         }
      }
      else
      {
         fail_all("Only the current leader accepts transactions");
      }
   };
   loop(timer, process_transactions);

   chainContext.run();
}

const char usage[] = "USAGE: psinode [OPTIONS] database";

int main(int argc, char* argv[])
{
   std::string                 db_path;
   std::string                 producer = {};
   auto                        keys     = std::make_shared<CompoundProver>();
   std::string                 host     = {};
   std::vector<listen_spec>    listen;
   uint32_t                    leeway_us = 200000;  // TODO: real value once resources are in place
   std::vector<std::string>    peers;
   autoconnect_t               autoconnect;
   bool                        enable_incoming_p2p = false;
   std::vector<native_service> services;
   http::admin_service         admin;
   std::vector<std::string>    root_ca;
   std::string                 tls_cert;
   std::string                 tls_key;

   namespace po = boost::program_options;

   po::options_description desc("psinode");
   po::options_description common_opts("Options");
   auto                    opt = common_opts.add_options();
   opt("producer,p", po::value<std::string>(&producer)->default_value("")->value_name("name"),
       "Name of this producer");
   opt("key,k", po::value(&keys->provers)->default_value({}, ""),
       "A private key to use for block production");
   opt("host,o", po::value<std::string>(&host)->value_name("name")->default_value(""),
       "Root host name for the http server");
   opt("listen,l", po::value(&listen)->default_value({}, "")->value_name("endpoint"),
       "TCP or local socket endpoint on which the server accepts connections");
   opt("p2p", po::bool_switch(&enable_incoming_p2p)->default_value(false, "off"),
       "Enable incoming p2p connections");
   opt("peer", po::value(&peers)->default_value({}, "")->value_name("URL"), "Peer endpoint");
   opt("autoconnect", po::value(&autoconnect)->default_value({}, "")->value_name("num"),
       "Limits the number of peers to be connected automatically");
   opt("service", po::value(&services)->default_value({}, "")->value_name("host:directory"),
       "Serve static content from directory using the specified virtual host name");
   opt("admin", po::value(&admin)->default_value({}, ""),
       "Controls which services can access the admin API");
#ifdef PSIBASE_ENABLE_SSL
   opt("tls-trustfile", po::value(&root_ca)->default_value({}, "")->value_name("path"),
       "A list of trusted Certification Authorities in PEM format");
   opt("tls-cert", po::value(&tls_cert)->default_value("")->value_name("path"),
       "The file containing the server's certificate in PEM format");
   opt("tls-key", po::value(&tls_key)->default_value("")->value_name("path"),
       "The file containing the private key corresponding to --tls-cert in PEM format");
#endif
   opt("leeway", po::value<uint32_t>(&leeway_us)->default_value(200000),
       "Transaction leeway, in µs.");
   desc.add(common_opts);
   opt = desc.add_options();
   // Options that can only be specified on the command line
   opt("database", po::value<std::string>(&db_path)->value_name("path")->required(),
       "Path to database");
   opt("help,h", "Show this message");

   po::positional_options_description p;
   p.add("database", 1);

   // Options that are only allowed in the config file
   po::options_description cfg_opts("psinode");
   cfg_opts.add(common_opts);
   cfg_opts.add_options()("logger.*", po::value<std::string>(), "Log configuration");

   auto parse_args =
       [&desc, &p, &cfg_opts](int argc, const char* const* argv, po::variables_map& vm)
   {
      option_path = std::filesystem::current_path();
      po::store(po::command_line_parser(argc, argv).options(desc).positional(p).run(), vm);
      if (vm.count("database"))
      {
         auto db_root     = std::filesystem::path(vm["database"].as<std::string>());
         option_path      = option_path / db_root;
         auto config_path = db_root / "config";
         if (std::filesystem::is_regular_file(config_path))
         {
            std::ifstream in(config_path);
            po::store(psibase::parse_config_file(in, cfg_opts, config_path), vm);
         }
         else if (!exists(config_path))
         {
            auto template_path = config_template_path();
            if (std::filesystem::is_regular_file(template_path))
            {
               std::ifstream in(template_path);
               po::store(psibase::parse_config_file(in, cfg_opts, template_path), vm);
            }
         }
      }
      po::notify(vm);
   };

   po::variables_map vm;
   try
   {
      parse_args(argc, argv, vm);
   }
   catch (std::exception& e)
   {
      if (!vm.count("help"))
      {
         std::cerr << e.what() << "\n";
         return 1;
      }
   }

   if (vm.count("help"))
   {
      std::cerr << usage << "\n\n";
      std::cerr << common_opts << "\n";
      return 1;
   }

   try
   {
      psibase::loggers::set_path(db_path);
      psibase::loggers::configure(vm);
      RestartInfo restart;
      while (true)
      {
         restart.shutdownRequested = false;
         restart.shouldRestart     = true;
         restart.soft              = true;
         run(db_path, AccountNumber{producer}, keys, peers, autoconnect, enable_incoming_p2p, host,
             listen, services, admin, root_ca, tls_cert, tls_key, leeway_us, restart);
         if (!restart.shouldRestart || !restart.shutdownRequested)
         {
            PSIBASE_LOG(psibase::loggers::generic::get(), info) << "Shutdown";
            break;
         }
         else
         {
            // Forward the command line, but remove any arguments that were
            // written to the config file.
            std::vector<const char*> args;
            auto                     original_args =
                po::command_line_parser(argc, argv).options(desc).positional(p).run();
            auto keep_opt = [&restart](const auto& opt)
            {
               if (opt.string_key == "database" || opt.string_key == "leeway")
                  return true;
               else if (opt.string_key == "key")
                  return !restart.keysChanged;
               else
                  return !restart.configChanged;
            };
            if (argc > 0)
            {
               args.push_back(argv[0]);
               for (const auto& opt : original_args.options)
               {
                  if (keep_opt(opt))
                  {
                     for (const auto& s : opt.original_tokens)
                     {
                        args.push_back(s.c_str());
                     }
                  }
               }
            }

            if (restart.soft)
            {
               PSIBASE_LOG(psibase::loggers::generic::get(), info) << "Soft restart";
               po::variables_map tmp;
               // Reload the config file
               parse_args(args.size(), args.data(), tmp);
            }
            else
            {
               PSIBASE_LOG(psibase::loggers::generic::get(), info) << "Restart";
               args.push_back(nullptr);
               // Cleanup that would normally happen in exit()
               boost::log::core::get()->remove_all_sinks();
               std::fflush(stdout);
               std::fflush(stderr);
               ::execvp(argv[0], const_cast<char**>(args.data()));
               break;
            }
         }
      }
      return 0;
   }
   catch (std::exception& e)
   {
      PSIBASE_LOG(psibase::loggers::generic::get(), error) << e.what();
   }
   return 1;
}

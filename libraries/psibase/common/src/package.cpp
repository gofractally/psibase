#include <psibase/Actor.hpp>
#include <psibase/check.hpp>
#include <psibase/fileUtil.hpp>
#include <psibase/package.hpp>
#include <psibase/semver.hpp>
#include <psio/schema.hpp>
#include <services/local/XSites.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/SetCode.hpp>
#include <services/user/Packages.hpp>
#include <services/user/Sites.hpp>
#include <unordered_map>
#include <unordered_set>

#include <zlib.h>

using namespace SystemService;
using namespace UserService;
using LocalService::XSites;

namespace psibase
{
   using namespace psibase::zip;

   namespace
   {
      const std::pair<std::string_view, std::string_view> fileTypes[] = {
          {".cpp", "text/plain"},
          {".css", "text/css"},
          {".eot", "application/vnd.ms-fontobject"},
          {".hpp", "text/plain"},
          {".html", "text/html"},
          {".js", "text/javascript"},
          {".json", "application/json"},
          {".mjs", "text/javascript"},
          {".png", "image/png"},
          {".svg", "image/svg+xml"},
          {".ttf", "font/ttf"},
          {".txt", "text/plain"},
          {".wasm", "application/wasm"},
          {".woff", "font/woff"},
          {".woff2", "font/woff2"}};
      std::string_view guessMimeType(std::string_view filename)
      {
         auto pos = filename.rfind('.');
         if (pos != std::string_view::npos)
         {
            auto extension = filename.substr(pos);
            auto result    = std::ranges::lower_bound(
                fileTypes, extension, {}, [](const auto& p) -> const auto& { return p.first; });
            if (result != std::end(fileTypes) && result->first == extension)
               return result->second;
         }
         check(false, "Cannot determine Mime-Type for " + std::string(filename));
         __builtin_unreachable();
      }

      struct PrettyAction
      {
         AccountNumber                    sender;
         AccountNumber                    service;
         MethodNumber                     method;
         std::optional<std::vector<char>> rawData;
         std::optional<psio::json::any>   data;
         PSIO_REFLECT(PrettyAction, sender, service, method, rawData, data)
      };

      const ServiceSchema* getSchema(std::span<const PackagedService> packages,
                                     AccountNumber                    service)
      {
         for (const auto& package : packages)
         {
            for (const auto& [account, _, info] : package.services)
            {
               if (service == account)
               {
                  if (info.schema)
                     return &*info.schema;
                  else
                     return nullptr;
               }
            }
         }
         return nullptr;
      }

      std::vector<PrettyAction> readPostinstall(PackagedService& package)
      {
         std::vector<PrettyAction> result;
         if (package.postinstallScript)
         {
            auto contents = package.archive.getEntry(*package.postinstallScript).read();
            contents.push_back('\0');
            psio::json_token_stream stream(contents.data());
            psio::from_json(result, stream);
         }
         return result;
      }

      Action to_action(PrettyAction&& act, std::span<const PackagedService> packages)
      {
         if (act.rawData)
         {
            return Action{act.sender, act.service, act.method, std::move(*act.rawData)};
         }
         auto* schema = getSchema(packages, act.service);
         if (!schema)
            abortMessage("Cannot find schema for " + act.service.str());
         auto pos = schema->actions.find(act.method.str());
         check(pos != schema->actions.end(), "Action not found");
         const auto&                        ty = pos->second.params;
         psio::schema_types::CompiledSchema cschema{schema->types, psibase_types(), {&ty}};
         auto*                              cty = cschema.get(ty.resolve(schema->types));
         if (!act.data)
            act.data = psio::json::any_object{};
         Action              result{act.sender, act.service, act.method};
         psio::vector_stream stream{result.rawData};
         to_frac(*cty, *act.data, stream, cschema.builtin);
         return result;
      }

      bool hasService(const PackagedService& package, AccountNumber account)
      {
         return std::ranges::find(package.meta.services, account) != package.meta.services.end();
      }

      struct RequiredAccounts
      {
         explicit RequiredAccounts(PackagedService& package)
         {
            bool local = package.meta.scope == "local";

            for (auto account : package.meta.accounts)
            {
               if (!hasService(package, account))
               {
                  if (!local)
                     services.push_back(Accounts::service);
                  else
                     abortMessage("Local packages do not support non-service accounts");
                  break;
               }
            }

            if (!package.data.empty())
            {
               if (!local)
                  services.push_back(Sites::service);
               else
                  services.push_back(XSites::service);
            }

            for (const auto& [account, file, info] : package.services)
            {
               if (info.server)
               {
                  if (!local)
                     services.push_back(HttpServer::service);
                  // x-http is always present
                  break;
               }
            }

            for (const auto& act : readPostinstall(package))
            {
               accounts.push_back(act.sender);
               services.push_back(act.service);
            }

            std::ranges::sort(accounts);
            {
               auto res = std::ranges::unique(accounts);
               accounts.erase(res.begin(), res.end());
            }
            std::ranges::sort(services);
            {
               auto res = std::ranges::unique(services);
               services.erase(res.begin(), res.end());
            }
         }
         std::vector<AccountNumber> accounts;
         std::vector<AccountNumber> services;
      };

      // Finds all packages reachable from package in deps.
      // Packages that should not be considered should be excluded from deps.
      void get_transitive_services(
          std::string_view                                                            package,
          const std::unordered_map<std::string_view, const std::vector<PackageRef>*>& deps,
          std::unordered_set<std::string_view>&                                       visited,
          std::vector<std::string_view>&                                              out)
      {
         if (auto pos = deps.find(package); pos != deps.end())
         {
            if (visited.insert(package).second)
            {
               out.push_back(package);
               for (const auto& dep : *pos->second)
               {
                  get_transitive_services(dep.name, deps, visited, out);
               }
            }
         }
      }

      void sortPackagesImpl(
          std::string_view                                                           package,
          const std::unordered_map<std::string_view, std::vector<std::string_view>>& graph,
          std::unordered_map<std::string_view, PackagedService*>&                    byName,
          std::vector<PackagedService*>&                                             out)
      {
         if (auto pos = byName.find(package); pos != byName.end())
         {
            if (pos->second == nullptr)
            {
               abortMessage("Circular install dependency for: " + std::string(package));
            }
            auto packagePtr = pos->second;
            pos->second     = nullptr;
            auto deps       = graph.find(package);
            if (deps == graph.end())
               abortMessage("Missing vertex for " + std::string(package));
            for (auto dep : deps->second)
            {
               sortPackagesImpl(dep, graph, byName, out);
            }
            out.push_back(packagePtr);
            byName.erase(pos);
         }
      }

      template <typename T>
      void applyPermutation(std::span<T> dest, std::span<T*> order)
      {
         assert(dest.size() == order.size());
         std::vector<T> tmp;
         tmp.reserve(dest.size());
         for (T* p : order)
            tmp.push_back(std::move(*p));
         std::ranges::move(tmp, dest.begin());
      }
   }  // namespace

   // puts higher priority packages first
   std::weak_ordering operator<=>(const PackageInfo& lhs, const PackageInfo& rhs)
   {
      if (auto result = lhs.name <=> rhs.name; result != 0)
         return result;
      return versionCompare(rhs.version, lhs.version);
   }

   std::uint64_t ServiceInfo::parseFlags() const
   {
      std::uint64_t result = 0;
      for (const auto& flag : flags)
      {
         if (flag == "isPrivileged")
            result |= CodeRow::isPrivileged;
         else if (flag == "isVerify")
            result |= CodeRow::isVerify;
         else if (flag == "isReplacement")
            result |= CodeRow::isReplacement;
         else
            check(false, "Invalid service flags");
      }
      return result;
   }

   PackagedService::PackagedService(std::vector<char> buf)
       : buf(std::move(buf)),
         archive(this->buf),
         sha256(psibase::sha256(this->buf.data(), this->buf.size()))
   {
      std::map<AccountNumber, FileHeader>               info_files;
      std::vector<std::pair<AccountNumber, FileHeader>> service_files;
      std::optional<FileHeader>                         meta_index;

      for (auto cd = archive.centralDirectory(); cd.hasNext();)
      {
         auto file = cd.next();
         if (file.filename == "meta.json")
         {
            meta_index = file;
         }
         else if (file.filename.starts_with("service/"))
         {
            auto name = file.filename.substr(8);
            if (name.ends_with(".wasm"))
            {
               name.remove_suffix(5);
               service_files.push_back({AccountNumber{name}, file});
            }
            else if (name.ends_with(".json"))
            {
               name.remove_suffix(5);
               info_files.insert({AccountNumber{name}, file});
            }
         }
         else if (file.filename.starts_with("data/") && file.isFile())
         {
            auto name = file.filename.substr(5);
            auto pos  = name.find('/');
            if (pos != std::string::npos)
            {
               data.push_back({AccountNumber{name.substr(0, pos)}, file});
            }
         }
         else if (file.filename == "script/postinstall.json")
         {
            postinstallScript = file;
         }
      }

      check(!!meta_index, "Service does not contain meta.json");
      {
         auto metaContents = archive.getEntry(*meta_index).read();
         metaContents.push_back('\0');
         psio::json_token_stream stream(metaContents.data());
         psio::from_json(meta, stream);
      }
      for (const auto& [account, file] : service_files)
      {
         if (std::ranges::find(meta.accounts, account) == meta.accounts.end())
         {
            check(false, "Account " + account.str() + " not defined in meta.json");
         }
         ServiceInfo info = {};
         if (auto pos = info_files.find(account); pos != info_files.end())
         {
            auto contents = archive.getEntry(pos->second).read();
            contents.push_back('\0');
            psio::json_token_stream stream(contents.data());
            psio::from_json(info, stream);
         }
         services.push_back({account, file, info});
      }
      for (const auto& [account, file] : data)
      {
         if (std::ranges::find(meta.accounts, account) == meta.accounts.end())
         {
            check(false, "Account " + account.str() + " not defined in meta.json");
         }
      }
   }

   std::pair<std::string_view, std::string_view> PackagedService::dataFileInfo(
       std::string_view filename)
   {
      assert(filename.starts_with("data/"));
      auto path = filename.substr(5);
      auto pos  = path.find('/');
      assert(pos != std::string::npos);
      path = path.substr(pos);
      return {path, guessMimeType(path)};
   }

   void PackagedService::genesis(std::vector<GenesisService>& out)
   {
      for (const auto& [account, index, info] : services)
      {
         if (account.value == 0)
         {
            std::string filename = std::string(archive.getEntry(index).filename());
            abortMessage("Service with filename: " + filename + " has invalid account name");
         }

         out.push_back(GenesisService{
             .service   = account,
             .flags     = info.parseFlags(),
             .vmType    = 0,
             .vmVersion = 0,
             .code      = archive.getEntry(index).read(),
         });
      }
   }
   bool PackagedService::hasService(AccountNumber service) const
   {
      for (const auto& [account, index, info] : services)
      {
         if (account == service)
         {
            return true;
         }
      }
      return false;
   }
   void PackagedService::installCode(std::vector<Action>& actions)
   {
      for (const auto& [account, index, info] : services)
      {
         if (account.value == 0)
         {
            std::string filename = std::string(archive.getEntry(index).filename());
            abortMessage("Service with filename: " + filename + " has invalid account name");
         }

         actions.push_back(transactor<SetCode>(account, SetCode::service)
                               .setCode(account, 0, 0, archive.getEntry(index).read()));
         if (auto flags = info.parseFlags())
         {
            actions.push_back(
                transactor<SetCode>(SetCode::service, SetCode::service).setFlags(account, flags));
         }
      }
   }
   void PackagedService::setSchema(std::vector<Action>& actions)
   {
      for (const auto& [account, index, info] : services)
      {
         if (info.schema)
         {
            actions.push_back(
                transactor<Packages>{account, Packages::service}.setSchema(*info.schema));
         }
      }
   }
   void PackagedService::storeData(std::vector<Action>& actions)
   {
      for (const auto& [sender, index] : data)
      {
         auto [path, mimeType] = dataFileInfo(index.filename);
         actions.push_back(transactor<Sites>{sender, Sites::service}.storeSys(
             path, mimeType, std::nullopt, archive.getEntry(index).read()));
      }
   }
   void PackagedService::regServer(std::vector<Action>& actions)
   {
      for (const auto& [account, index, info] : services)
      {
         if (info.server)
         {
            actions.push_back(
                transactor<HttpServer>{account, HttpServer::service}.registerServer(*info.server));
         }
      }
   }
   std::span<const AccountNumber> PackagedService::accounts() const
   {
      return meta.accounts;
   }
   bool PackagedService::needsUI()
   {
      for (const auto& action : readPostinstall(*this))
      {
         if (action.service == Sites::service)
         {
            return true;
         }
      }
      return false;
   }
   void PackagedService::postinstall(std::vector<Action>&             actions,
                                     std::span<const PackagedService> packages)
   {
      for (auto&& action : readPostinstall(*this))
      {
         actions.push_back(to_action(std::move(action), packages));
      }
   }

   std::vector<char> gzip(std::vector<char> in)
   {
      z_stream stream = {};
      if (int err = deflateInit2(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 15 + 16, 8,
                                 Z_DEFAULT_STRATEGY);
          err != Z_OK)
      {
         abortMessage(zError(err));
      }
      std::vector<char> result(deflateBound(&stream, in.size()));
      stream.next_in   = reinterpret_cast<unsigned char*>(in.data());
      stream.avail_in  = in.size();
      stream.next_out  = reinterpret_cast<unsigned char*>(result.data());
      stream.avail_out = result.size();
      int err          = deflate(&stream, Z_FINISH);
      if (err != Z_STREAM_END)
      {
         abortMessage(std::string("deflate: ") + zError(err));
      }
      result.resize(stream.total_out);
      deflateEnd(&stream);
      return result;
   }

   std::vector<char> PackagedService::manifest()
   {
      std::vector<char>   manifest;
      psio::vector_stream stream{manifest};
      bool                first = true;
      stream.write('{');
      to_json("services", stream);
      stream.write(':');
      stream.write('{');
      for (const auto& [account, header, info] : services)
      {
         if (first)
            first = false;
         else
            stream.write(',');
         to_json(account, stream);
         stream.write(':');
         to_json(info, stream);
      }
      stream.write('}');
      stream.write(',');
      to_json("data", stream);
      stream.write(':');
      stream.write('[');
      first = true;
      for (const auto& [sender, index] : data)
      {
         AccountNumber service = Sites::service;
         if (hasService(sender))
         {
            service = sender;
         }
         auto path = index.filename.substr(5);
         auto pos  = path.find('/');
         assert(pos != std::string::npos);
         path = path.substr(pos);
         //
         if (first)
            first = false;
         else
            stream.write(',');
         stream.write('{');
         to_json("account", stream);
         stream.write(':');
         to_json(sender, stream);
         stream.write(',');

         to_json("filename", stream);
         stream.write(':');
         to_json(path, stream);
         stream.write('}');
      }
      stream.write(']');
      stream.write('}');

      return manifest;
   }

   void PackagedService::commitInstall(std::vector<Action>& actions, AccountNumber sender)
   {
      actions.push_back(transactor<Packages>{sender, Packages::service}.postinstall(
          meta, gzip(std::move(manifest()))));
   }

   PackageInfo& get(std::vector<PackageInfo>& index, const PackageRef& ref)
   {
      auto byname = [](const auto& info) -> const auto& { return info.name; };
      for (PackageInfo& package : std::ranges::equal_range(index, ref.name, {}, byname))
      {
         if (versionMatch(ref.version, package.version))
            return package;
      }
      abortMessage("No package matches " + ref.name + "(" + ref.version + ")");
   }

   void dfs(std::vector<PackageInfo>&             index,
            std::span<const PackageRef>           names,
            std::unordered_set<std::string_view>& found,
            std::vector<PackageInfo*>&            result)
   {
      for (const auto& ref : names)
      {
         if (found.insert(ref.name).second)
         {
            auto& package = get(index, ref);
            dfs(index, package.depends, found, result);
            result.push_back(&package);
         }
      }
   }

   DirectoryRegistry::DirectoryRegistry(std::string_view path) : path(path) {}

   std::vector<PackageInfo> DirectoryRegistry::index() const
   {
      std::vector<PackageInfo> result;
      {
         auto index_json = readWholeFile(path + "/index.json");
         index_json.push_back('\0');
         psio::json_token_stream stream(index_json.data());
         from_json(result, stream);
      }
      return result;
   }

   PackagedService DirectoryRegistry::get(std::string_view name) const
   {
      std::string filepath = path;
      filepath += '/';
      filepath += name;
      filepath += ".psi";
      return PackagedService(readWholeFile(filepath));
   }

   PackagedService DirectoryRegistry::get(const PackageInfo& info) const
   {
      std::string filepath = path;
      filepath += '/';
      filepath += info.file;
      return PackagedService(readWholeFile(filepath));
   }

   std::vector<PackageInfo> DirectoryRegistry::resolveInfo(std::span<const std::string> packages)
   {
      std::vector<PackageInfo> index = this->index();

      std::ranges::sort(index, std::less<>());
      std::vector<PackageRef> in;
      for (const auto& name : packages)
      {
         in.push_back({name, "*"});
      }
      std::vector<PackageInfo*> selected;
      {
         std::unordered_set<std::string_view> found;
         dfs(index, in, found, selected);
      }
      std::vector<PackageInfo> result;
      for (const auto* package : selected)
      {
         result.push_back(std::move(*package));
      }
      return result;
   }

   std::vector<PackagedService> DirectoryRegistry::resolve(
       std::span<const std::string>   packages,
       std::span<const AccountNumber> priorityServices)
   {
      auto                         packageInfo = resolveInfo(packages);
      std::vector<PackagedService> result;
      result.reserve(packageInfo.size());
      for (const auto& info : packageInfo)
      {
         result.push_back(get(info));
      }
      sortPackages(result, priorityServices);
      return result;
   }

   void sortPackages(std::span<PackagedService>     packages,
                     std::span<const AccountNumber> priorityServices)
   {
      std::map<AccountNumber, PackagedService*>                            provides_service;
      std::unordered_set<std::string_view>                                 has_postinstall;
      std::vector<PackageRef>                                              empty_deps;
      std::unordered_map<std::string_view, const std::vector<PackageRef>*> service_deps;
      std::unordered_map<std::string_view, std::vector<std::string_view>>  graph;
      // Build the graph of service dependencies. Service dependencies
      // can be cyclic as long as nothing calls any of the services in
      // the cycle before all of them are installed.
      for (PackagedService& package : packages)
      {
         // Create lookup table to find the package that contains
         // each service. Duplicates are an error.
         for (const auto& [service, header, info] : package.services)
         {
            auto [pos, inserted] = provides_service.insert({service, &package});
            if (!inserted)
            {
               abortMessage("The service " + service.str() +
                            " is defined by more than one package: " + pos->second->meta.name +
                            ", " + package.meta.name);
            }
         }
         bool postinstall = !readPostinstall(package).empty();
         if (postinstall)
         {
            has_postinstall.insert(package.meta.name);
         }
         if (!package.services.empty())
         {
            // If a package provides any services, direct dependents can
            // assume they are installed. This transitively requires all
            // services that this package might use to be installed.
            service_deps.insert({package.meta.name, &package.meta.depends});
         }
         else if (postinstall)
         {
            // If a package provides a postinstall script, direct dependents
            // can assume that it has been run. Dependencies only need to
            // be installed first if they are required to install this package
            service_deps.insert({package.meta.name, &empty_deps});
         }
      }

      // Construct a graph describing constraints on install order
      // All services that might be run during installation must
      // be installed first.
      for (PackagedService& package : packages)
      {
         std::vector<std::string_view>        all_required_packages;
         std::unordered_set<std::string_view> visited;
         for (auto service : RequiredAccounts{package}.services)
         {
            auto pos = provides_service.find(service);
            if (pos == provides_service.end())
            {
               abortMessage("The account " + service.str() + " required by " + package.meta.name +
                            " is not defined by any package");
            }
            PackagedService* required_package = pos->second;
            if (required_package != &package)
            {
               if (visited.insert(required_package->meta.name).second)
               {
                  all_required_packages.push_back(required_package->meta.name);
               }
            }
            for (const PackageRef& dep : required_package->meta.depends)
            {
               get_transitive_services(dep.name, service_deps, visited, all_required_packages);
            }
         }
         // The postinstall script can rely on direct dependencies'
         // postinstall scripts having run first.
         if (has_postinstall.find(package.meta.name) != has_postinstall.end())
         {
            for (const PackageRef& dep : package.meta.depends)
            {
               if (has_postinstall.find(dep.name) != has_postinstall.end() &&
                   visited.insert(dep.name).second)
               {
                  all_required_packages.push_back(dep.name);
               }
            }
         }
         graph.insert({package.meta.name, std::move(all_required_packages)});
      }
      std::unordered_map<std::string_view, PackagedService*> by_name;
      for (PackagedService& package : packages)
      {
         by_name.insert({package.meta.name, &package});
      }
      std::vector<PackagedService*> result;
      for (AccountNumber service : priorityServices)
      {
         if (auto pos = provides_service.find(service); pos != provides_service.end())
         {
            sortPackagesImpl(pos->second->meta.name, graph, by_name, result);
         }
      }
      for (PackagedService& package : packages)
      {
         sortPackagesImpl(package.meta.name, graph, by_name, result);
      }
      applyPermutation<PackagedService>(packages, result);
   }
}  // namespace psibase

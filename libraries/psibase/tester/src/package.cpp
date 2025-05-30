#include <psibase/Actor.hpp>
#include <psibase/check.hpp>
#include <psibase/package.hpp>
#include <psibase/semver.hpp>
#include <psio/schema.hpp>
#include <services/system/HttpServer.hpp>
#include <services/user/Packages.hpp>
#include <services/user/Sites.hpp>

#include <zlib.h>

using namespace SystemService;
using namespace UserService;

namespace psibase
{
   using namespace psibase::zip;

   std::vector<char> readWholeFile(std::string_view filename);

   namespace
   {
      std::uint64_t translateFlags(std::span<const std::string> flags)
      {
         std::uint64_t result = 0;
         for (const auto& flag : flags)
         {
            if (flag == "allowSudo")
               result |= (1 << 0);
            else if (flag == "allowWriteNative")
               result |= (1 << 1);
            else if (flag == "isSubjective")
               result |= (1 << 2);
            else if (flag == "allowWriteSubjective")
               result |= (1 << 3);
            else if (flag == "canNotTimeOut")
               result |= (1 << 4);
            else if (flag == "canSetTimeLimit")
               result |= (1 << 5);
            else if (flag == "isAuthService")
               result |= (1 << 6);
            else if (flag == "forceReplay")
               result |= (1 << 7);
            else if (flag == "allowSocket")
               result |= (1 << 8);
            else if (flag == "allowNativeSubjective")
               result |= (1 << 9);
            else
               check(false, "Invalid service flags");
         }
         return result;
      }
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
   }  // namespace

   // puts higher priority packages first
   std::weak_ordering operator<=>(const PackageInfo& lhs, const PackageInfo& rhs)
   {
      if (auto result = lhs.name <=> rhs.name; result != 0)
         return result;
      return versionCompare(rhs.version, lhs.version);
   }

   PackagedService::PackagedService(std::vector<char> buf) : buf(std::move(buf)), archive(this->buf)
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
             .flags     = translateFlags(info.flags),
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
         auto path = index.filename.substr(5);
         auto pos  = path.find('/');
         assert(pos != std::string::npos);
         path = path.substr(pos);
         actions.push_back(transactor<Sites>{sender, Sites::service}.storeSys(
             path, guessMimeType(path), std::nullopt, archive.getEntry(index).read()));
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
   void PackagedService::postinstall(std::vector<Action>&             actions,
                                     std::span<const PackagedService> packages)
   {
      if (postinstallScript)
      {
         auto contents = archive.getEntry(*postinstallScript).read();
         contents.push_back('\0');
         psio::json_token_stream   stream(contents.data());
         std::vector<PrettyAction> tmp;
         psio::from_json(tmp, stream);
         for (auto&& action : tmp)
         {
            actions.push_back(to_action(std::move(action), packages));
         }
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

   void PackagedService::commitInstall(std::vector<Action>& actions, AccountNumber sender)
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

         to_json("service", stream);
         stream.write(':');
         to_json(service, stream);
         stream.write(',');

         to_json("filename", stream);
         stream.write(':');
         to_json(path, stream);
         stream.write('}');
      }
      stream.write(']');
      stream.write('}');
      manifest = gzip(std::move(manifest));
      actions.push_back(
          transactor<Packages>{sender, Packages::service}.postinstall(meta, manifest));
   }

   const PackageInfo& get(const std::vector<PackageInfo>& index, const PackageRef& ref)
   {
      auto byname = [](const auto& info) -> const auto& { return info.name; };
      for (const PackageInfo& package : std::ranges::equal_range(index, ref.name, {}, byname))
      {
         if (versionMatch(ref.version, package.version))
            return package;
      }
      abortMessage("No package matches " + ref.name + "(" + ref.version + ")");
   }

   void dfs(const std::vector<PackageInfo>&   index,
            std::span<const PackageRef>       names,
            std::map<std::string_view, bool>& found,
            std::vector<const PackageInfo*>&  result)
   {
      for (const auto& ref : names)
      {
         if (auto [pos, inserted] = found.try_emplace(ref.name, false); !inserted)
         {
            check(pos->second, "Cycle in service dependencies");
         }
         else
         {
            auto& package = get(index, ref);
            dfs(index, package.depends, found, result);
            result.push_back(&package);
            pos->second = true;
         }
      }
   }

   DirectoryRegistry::DirectoryRegistry(std::string_view path) : path(path) {}

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

   std::vector<PackagedService> DirectoryRegistry::resolve(std::span<const std::string> packages)
   {
      std::vector<PackageInfo> index;
      {
         auto index_json = readWholeFile(path + "/index.json");
         index_json.push_back('\0');
         psio::json_token_stream stream(index_json.data());
         from_json(index, stream);
      }

      std::ranges::sort(index, std::less<>());
      std::vector<PackageRef> in;
      for (const auto& name : packages)
      {
         in.push_back({name, "*"});
      }
      std::vector<const PackageInfo*> selected;
      {
         std::map<std::string_view, bool> found;
         dfs(index, in, found, selected);
      }
      std::vector<PackagedService> result;
      for (const auto* package : selected)
      {
         result.push_back(get(*package));
      }
      return result;
   }

}  // namespace psibase

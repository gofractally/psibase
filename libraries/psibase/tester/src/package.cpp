#include <psibase/Actor.hpp>
#include <psibase/check.hpp>
#include <psibase/package.hpp>
#include <services/system/ProxySys.hpp>
#include <services/user/PackageSys.hpp>
#include <services/user/PsiSpaceSys.hpp>

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
   }  // namespace

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
   void PackagedService::storeData(std::vector<Action>& actions)
   {
      for (const auto& [sender, index] : data)
      {
         AccountNumber service = PsiSpaceSys::service;
         if (hasService(sender))
         {
            service = sender;
         }
         auto path = index.filename.substr(5);
         auto pos  = path.find('/');
         assert(pos != std::string::npos);
         path = path.substr(pos);
         actions.push_back(transactor<PsiSpaceSys>{sender, service}.storeSys(
             path, guessMimeType(path), archive.getEntry(index).read()));
      }
   }
   void PackagedService::regServer(std::vector<Action>& actions)
   {
      for (const auto& [account, index, info] : services)
      {
         if (info.server)
         {
            actions.push_back(
                transactor<ProxySys>{account, ProxySys::service}.registerServer(*info.server));
         }
      }
   }
   std::span<const AccountNumber> PackagedService::accounts() const
   {
      return meta.accounts;
   }
   void PackagedService::postinstall(std::vector<Action>& actions)
   {
      if (postinstallScript)
      {
         auto contents = archive.getEntry(*postinstallScript).read();
         contents.push_back('\0');
         psio::json_token_stream stream(contents.data());
         std::vector<Action>     tmp;
         psio::from_json(tmp, stream);
         for (auto&& action : tmp)
         {
            actions.push_back(std::move(action));
         }
      }
   }

   void PackagedService::commitInstall(std::vector<Action>& actions)
   {
      actions.push_back(
          transactor<PackageSys>{PackageSys::service, PackageSys::service}.postinstall(
              InstalledPackage{
                  .name = meta.name, .depends = meta.depends, .accounts = meta.accounts}));
   }

   void dfs(const auto&                       reg,
            std::span<const std::string>      names,
            std::map<std::string_view, bool>& found,
            std::vector<PackagedService>&     result)
   {
      for (const auto& name : names)
      {
         if (auto [pos, inserted] = found.try_emplace(name, false); !inserted)
         {
            check(pos->second, "Cycle in service dependencies");
         }
         else
         {
            auto package = reg.get(name);
            dfs(reg, package.meta.depends, found, result);
            result.push_back(std::move(package));
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

   std::vector<PackagedService> DirectoryRegistry::resolve(std::span<const std::string> packages)
   {
      std::vector<PackagedService>     result;
      std::map<std::string_view, bool> found;
      dfs(*this, packages, found, result);
      return result;
   }

}  // namespace psibase

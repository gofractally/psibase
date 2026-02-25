#include <psibase/Mount.hpp>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <algorithm>
#include <filesystem>
#include <psibase/check.hpp>
#include <ranges>

namespace psibase
{
   namespace
   {
      using Fd = Mount::Fd;
      template <typename Dir>
      struct PartialPath
      {
         Dir*               mount;
         std::vector<Dir*>& mountpoints;
         Fd                 mountFd{-1};
         std::vector<Fd>    path;
         // This contains path components to be resolved
         // in reverse order
         std::vector<std::string> stack;
         std::size_t              symlinkEnd = -1;
         void                     push(std::string_view sv)
         {
            std::size_t initialSize = stack.size();
            for (auto range : sv | std::views::split('/'))
            {
               std::string item(range.begin(), range.end());
               if (!item.empty())
               {
                  stack.push_back(item);
               }
            }
            std::ranges::reverse(stack | std::views::drop(initialSize));
         }
         void addDir(std::string item)
         {
            if (item == ".")
            {
            }
            else if (item == "..")
            {
               if (path.empty())
               {
                  mount   = mount->parent;
                  mountFd = Fd{-1};
                  if (symlinkEnd <= stack.size())
                  {
                     throw std::system_error{ENOENT, std::generic_category()};
                  }
               }
               else
               {
                  path.pop_back();
               }
               return;
            }
            else
            {
               if (path.empty())
               {
                  auto pos = mount->children.find(item);
                  if (pos != mount->children.end())
                  {
                     mount = &pos->second;
                     return;
                  }
                  if (!mountFd && !mount->hostPath.empty())
                  {
                     mountFd = Fd{::open(mount->hostPath.c_str(), O_PATH | O_DIRECTORY)};
                  }
                  if (!mountFd)
                  {
                     throw std::system_error{ENOENT, std::generic_category()};
                  }
               }
               int         prev = path.empty() ? mountFd.fd : path.back().fd;
               auto        dir  = Fd{::openat(prev, item.c_str(), O_PATH | O_NOFOLLOW)};
               struct stat statbuf;
               if (::fstat(dir.fd, &statbuf) != 0)
                  throw std::system_error{ENOENT, std::generic_category()};
               auto type = statbuf.st_mode & S_IFMT;
               if (type == S_IFLNK)
               {
                  std::string linkValue(statbuf.st_size ? statbuf.st_size + 1 : 256, '\0');
                  while (true)
                  {
                     auto sz = ::readlinkat(dir.fd, "", linkValue.data(), linkValue.size());
                     if (sz < 0)
                        throw std::system_error{ENOENT, std::generic_category()};
                     if (static_cast<std::size_t>(sz) == linkValue.size())
                        linkValue.resize(linkValue.size() * 2);
                     else
                     {
                        linkValue.resize(static_cast<std::size_t>(sz));
                        break;
                     }
                  }

                  if (!linkValue.ends_with('/'))
                     linkValue.push_back('/');
                  if (linkValue.starts_with('/'))
                  {
                     // absolute symlink: find longest matching prefix
                     auto pos =
                         std::ranges::find_if(mountpoints, [&](const auto& dir)
                                              { return linkValue.starts_with(dir->hostPath); });
                     if (pos == mountpoints.end())
                        throw std::system_error{ENOENT, std::generic_category()};
                     mountFd = Fd{-1};
                     mount   = *pos;
                     path.clear();
                     linkValue = linkValue.substr(mount->hostPath.size());
                  }
                  symlinkEnd = std::min(symlinkEnd, stack.size());
                  push(linkValue);
               }
               else if (type == S_IFDIR)
               {
                  path.push_back(std::move(dir));
               }
               else
               {
                  throw std::system_error{ENOTDIR, std::generic_category()};
               }
            }
         }
         Fd get(std::string item)
         {
            if (path.empty())
            {
               auto pos = mount->children.find(item);
               if (pos != mount->children.end())
               {
                  mount = &pos->second;
                  return Fd{-1};
               }
               if (mount->hostPath.empty())
                  return Fd{-1};
               if (!mountFd && !mount->hostPath.empty())
               {
                  return Fd{::open((mount->hostPath + item).c_str(), O_RDONLY)};
               }
            }
            auto prev = path.empty() ? mountFd.fd : path.back().fd;
            return Fd{::openat(prev, item.c_str(), O_RDONLY)};
         }
      };
      void validatePath(std::string_view path)
      {
         check(path.find('\0') == std::string_view::npos, "Invalid path");
      }
   }  // namespace

   Mount::Fd::~Fd()
   {
      if (fd >= 0)
         ::close(fd);
   }

   Mount::Mount()
   {
      root.parent = &root;
   }

   void Mount::mount(std::string hostpath, std::string mountpath)
   {
      check(mountpath.starts_with('/'), "Mounted paths must be rooted");
      validatePath(hostpath);
      validatePath(mountpath);
      hostpath = std::filesystem::canonical(hostpath).string();
      if (!hostpath.ends_with('/'))
         hostpath.push_back('/');

      Dir* current = &root;
      for (auto range : mountpath | std::views::split('/'))
      {
         std::string item(range.begin(), range.end());
         if (!item.empty())
         {
            if (item == "." || item == "..")
               abortMessage("Mounted path must not contain . or ..");
            auto [pos, inserted] = current->children.try_emplace(std::move(item));
            if (inserted)
            {
               pos->second.parent = current;
               if (!current->hostPath.empty())
               {
                  pos->second.hostPath = current->hostPath + item + '/';
               }
            }
            current = &pos->second;
         }
      }
      mountpoints.push_back(current);
      current->isMountpoint = true;
      current->hostPath     = std::move(hostpath);
      std::vector<Dir*> stack;
      stack.push_back(current);
      {
         auto parent = stack.back();
         stack.pop_back();
         for (auto& [name, dir] : parent->children)
         {
            if (!dir.isMountpoint)
            {
               dir.hostPath = parent->hostPath + name + '/';
               stack.push_back(&dir);
            }
         }
      }
   }

   Fd Mount::open(std::string_view filename)
   {
      if (!filename.starts_with('/'))
         throw std::system_error{ENOENT, std::generic_category()};
      if (filename.contains('\0'))
         throw std::system_error{EINVAL, std::generic_category()};
      PartialPath impl{&root, mountpoints};
      impl.push(filename);
      if (impl.stack.empty())
         return Fd(-1);
      while (impl.stack.size() > 1)
      {
         auto item = std::move(impl.stack.back());
         impl.stack.pop_back();
         impl.addDir(std::move(item));
      }
      return impl.get(std::move(impl.stack.back()));
   }
}  // namespace psibase

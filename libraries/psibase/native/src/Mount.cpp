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
         std::vector<Dir*>& mountpoints;
         Dir*               mount;
         std::size_t        dirsBelowMount = 0;
         // Contains file descriptors for [root mount, last dir]
         // empty if `mount` is not below a mountpoint
         std::vector<Fd> path;
         // This contains path components to be resolved
         // in reverse order
         std::vector<std::string> stack;
         std::size_t              symlinkEnd        = -1;
         std::size_t              remainingSymlinks = 64;
         void                     push(std::string_view sv)
         {
            std::size_t initialSize = stack.size();
            for (auto range : sv | std::views::split('/'))
            {
               std::string item(&*range.begin(),
                                static_cast<std::size_t>(std::ranges::distance(range)));
               if (!item.empty())
               {
                  stack.push_back(item);
               }
            }
            std::ranges::reverse(stack | std::views::drop(initialSize));
         }
         void addDir(Fd&& dir)
         {
            struct stat statbuf;
            if (::fstat(dir.fd, &statbuf) != 0)
               throw std::system_error{ENOENT, std::generic_category()};
            auto type = statbuf.st_mode & S_IFMT;
            if (type == S_IFLNK)
            {
               if (remainingSymlinks == 0)
                  throw std::system_error(ELOOP, std::generic_category());
               --remainingSymlinks;

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
                  auto pos = std::ranges::find_if(mountpoints, [&](const auto& dir)
                                                  { return linkValue.starts_with(dir->hostPath); });
                  if (pos == mountpoints.end())
                     throw std::system_error{ENOENT, std::generic_category()};
                  mount          = *pos;
                  dirsBelowMount = 0;
                  path.clear();
                  path.push_back(Fd{::open(mount->hostPath.c_str(), O_PATH | O_DIRECTORY)});
                  linkValue = linkValue.substr(mount->hostPath.size());
               }
               else if (dirsBelowMount != 0)
               {
                  --dirsBelowMount;
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
         // If the file exists and is a directory, returns it
         // If the file does not exist returns -1,
         // Otherwise, throws std::system_error
         // Does NOT dereference symbolic links
         Fd requireDir(const Fd& parent, const std::string& name)
         {
            if (!parent)
               return Fd{-1};
            int result = ::openat(parent.fd, name.c_str(), O_PATH | O_DIRECTORY | O_NOFOLLOW);
            if (result < 0)
            {
               // EINVAL catches the case where the filename is invalid
               if (errno == ENOENT || errno == EINVAL)
                  return Fd{-1};
               else
                  throw std::system_error{ENOTDIR, std::generic_category()};
            }
            return Fd{result};
         }
         void addDir(std::string item)
         {
            if (item == ".")
            {
            }
            else if (item == "..")
            {
               if (!path.empty())
               {
                  path.pop_back();
               }
               if (path.empty() && mount->isMountpoint)
               {
                  // This can only happen after reading an absolute symlink
                  // that points into a sub-mount.
                  auto*             base = mount;
                  std::vector<Dir*> dirs;
                  do
                  {
                     dirs.push_back(base);
                     base = base->parent;
                  } while (!base->isMountpoint && base->parent != base);
                  if (base->isMountpoint)
                  {
                     path.push_back(Fd{::open(base->hostPath.c_str(), O_PATH | O_DIRECTORY)});
                     for (Dir* d : dirs | std::views::reverse)
                     {
                        path.push_back(requireDir(path.back(), d->hostPath));
                     }
                     path.pop_back();
                  }
               }
               if (dirsBelowMount == 0)
               {
                  // symlinks cannot leave a mount point
                  if (mount->isMountpoint && symlinkEnd <= stack.size())
                  {
                     throw std::system_error{ENOENT, std::generic_category()};
                  }
                  mount = mount->parent;
               }
               else
               {
                  --dirsBelowMount;
               }
            }
            else
            {
               if (dirsBelowMount == 0)
               {
                  auto pos = mount->children.find(item);
                  if (pos != mount->children.end())
                  {
                     mount = &pos->second;
                  }
                  else
                  {
                     ++dirsBelowMount;
                  }
               }
               else
               {
                  ++dirsBelowMount;
               }
               if (dirsBelowMount == 0 && mount->isMountpoint)
               {
                  // Entered a new mount point. TODO: This should be an error
                  // if the host file exists but is not a directory.
                  path.push_back(Fd{::open(mount->hostPath.c_str(), O_PATH | O_DIRECTORY)});
               }
               else if (!path.empty())
               {
                  // Following the host file
                  const Fd& prev = path.back();
                  auto fd = Fd{prev ? ::openat(prev.fd, item.c_str(), O_PATH | O_NOFOLLOW) : -1};
                  if (!fd)
                     path.push_back(std::move(fd));
                  else
                     addDir(std::move(fd));
               }
               if (dirsBelowMount != 0 && (path.empty() || !path.back()))
               {
                  throw std::system_error{ENOENT, std::generic_category()};
               }
            }
         }
         Fd get(std::string item)
         {
            if (path.empty())
            {
               throw std::system_error{ENOENT, std::generic_category()};
            }
            return Fd{::openat(path.back().fd, item.c_str(), O_RDONLY)};
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
         std::string_view item(&*range.begin(),
                               static_cast<std::size_t>(std::ranges::distance(range)));
         if (!item.empty())
         {
            if (item == "." || item == "..")
               abortMessage("Mounted path must not contain . or ..");
            auto [pos, inserted] = current->children.try_emplace(std::string(item));
            if (inserted)
            {
               pos->second.parent = current;
               if (!current->hostPath.empty())
               {
                  pos->second.hostPath = std::string(item);
               }
            }
            current = &pos->second;
         }
      }
      auto pos = std::ranges::partition_point(
          mountpoints, [&](Dir* d) { return d->hostPath.size() > hostpath.size(); });
      mountpoints.insert(pos, current);
      current->isMountpoint = true;
      current->hostPath     = std::move(hostpath);
      std::vector<Dir*> stack;
      stack.push_back(current);
      while (!stack.empty())
      {
         auto parent = stack.back();
         stack.pop_back();
         for (auto& [name, dir] : parent->children)
         {
            if (dir.hostPath.empty())
            {
               dir.hostPath = name;
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
      PartialPath impl{mountpoints, &root};
      if (root.isMountpoint)
         impl.path.push_back(Fd{::open(root.hostPath.c_str(), O_PATH | O_DIRECTORY)});
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

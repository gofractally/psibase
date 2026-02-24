#pragma once

#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace psibase
{
   // Goals for handling symlinks
   // - If all mounted paths are re-rooted in the same way, then all
   //   symlinks will work, provided the actual file and all symlinks
   //   are mounted.
   // - Adding a mount will not change the resolution for paths that
   //   resolve outside the mount point.
   // - symlinks and .. should never allow access to a directory outside
   //   a mount point.
   // - A symlink to a regular file may be read regardless of its target
   //   This behavior is subject to change if it is found to cause a problem.
   //
   class Mount
   {
     public:
      struct Fd
      {
         explicit Fd(int fd) : fd(fd) {}
         Fd(Fd&& other) : fd(other.fd) { other.fd = -1; }
         Fd& operator=(Fd&& other)
         {
            fd       = other.fd;
            other.fd = -1;
            return *this;
         }
         ~Fd();
         explicit operator bool() const { return fd >= 0; }
         int      fd;
      };
      Mount();
      void mount(std::string hostpath, std::string mountpath);
      Fd   open(std::string_view filename);

     private:
      struct Dir
      {
         std::string                hostPath;
         Dir*                       parent;
         bool                       isMountpoint;
         std::map<std::string, Dir> children;
      };
      Dir               root;
      std::vector<Dir*> mountpoints;
   };
}  // namespace psibase

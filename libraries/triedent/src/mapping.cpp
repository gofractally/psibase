#include <triedent/mapping.hpp>

#include <cassert>
#include <system_error>

#include <fcntl.h>
#include <sys/file.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

namespace triedent
{
   namespace
   {
      int get_prot(access_mode mode)
      {
         if (mode == access_mode::read_write)
         {
            return PROT_READ | PROT_WRITE;
         }
         else
         {
            assert(mode == access_mode::read_only);
            return PROT_READ;
         }
      }

      void try_pin(bool* pinned, void* base, std::size_t size)
      {
         if (*pinned)
         {
            *pinned = ::mlock(base, size) == 0;
         }
      }

      int get_flags(open_mode mode)
      {
         switch (mode)
         {
            case open_mode::read_only:
               return O_RDONLY;
            case open_mode::read_write:
            case open_mode::gc:
               return O_RDWR;
            case open_mode::create:
               return O_RDWR | O_CREAT;
            case open_mode::trunc:
               return O_RDWR | O_CREAT | O_TRUNC;
            case open_mode::create_new:
               return O_RDWR | O_CREAT | O_EXCL;
            case open_mode::temporary:
#ifdef O_TMPFILE
               return O_RDWR | O_TMPFILE;
#else
               return O_RDWR | O_CREAT | O_EXCL;
#endif
         }
         __builtin_unreachable();
      }
   }  // namespace

   mapping::mapping(const std::filesystem::path& file, open_mode mode, bool pin)
       : _mode(mode == open_mode::read_only ? access_mode::read_only : access_mode::read_write),
         _pinned(pin)
   {
      int flags           = O_CLOEXEC | get_flags(mode);
      int flock_operation = mode == open_mode::read_only ? LOCK_SH : LOCK_EX;
#ifdef O_TMPFILE
      _fd = ::open(file.native().c_str(), flags, 0644);
      if (_fd == -1 && mode == open_mode::temporary && errno == EOPNOTSUPP)
#else
      if (mode != open_mode::temporary)
         _fd = ::open(file.native().c_str(), flags, 0644);
      else
#endif
      {
         std::string filename = (file / "triedent-XXXXXX").native();
         _fd                  = ::mkstemp(filename.data());
         ::unlink(filename.data());
      }
      if (_fd == -1)
      {
         throw std::system_error{errno, std::generic_category()};
      }
      if (::flock(_fd, flock_operation | LOCK_NB) != 0)
      {
         ::close(_fd);
         throw std::system_error{errno, std::generic_category()};
      }
      struct stat statbuf[1];
      if (::fstat(_fd, statbuf) != 0)
      {
         ::close(_fd);
         throw std::system_error{errno, std::generic_category()};
      }
      _size = statbuf->st_size;
      if (_size == 0)
      {
         _data = nullptr;
      }
      else
      {
         if (auto addr = ::mmap(nullptr, _size, get_prot(_mode), MAP_SHARED, _fd, 0);
             addr != MAP_FAILED)
         {
            _data = addr;
            try_pin(&_pinned, addr, _size);
         }
         else
         {
            ::close(_fd);
            throw std::system_error{errno, std::generic_category()};
         }
      }
   }

   mapping::~mapping()
   {
      if (auto p = _data.load())
         ::munmap(p, _size);
      ::close(_fd);
   }

   std::shared_ptr<void> mapping::resize(std::size_t new_size)
   {
      if (new_size < _size)
      {
         throw std::runtime_error("Not implemented: shrink mapping");
      }
      else if (new_size == _size)
      {
         return nullptr;
      }
      struct munmapper
      {
         ~munmapper()
         {
            if (addr)
            {
               ::munmap(addr, size);
            }
         }
         void*       addr = nullptr;
         std::size_t size;
      };
      // Do this first, because it can throw
      auto result = std::make_shared<munmapper>();
      if (::ftruncate(_fd, new_size) < 0)
      {
         throw std::system_error{errno, std::generic_category()};
      }
      auto prot = get_prot(_mode);
#ifdef MAP_FIXED_NOREPLACE
      // Try to extend the existing mapping
      {
         auto end = (char*)_data.load() + _size;
         auto addr =
             ::mmap(end, new_size - _size, prot, MAP_SHARED | MAP_FIXED_NOREPLACE, _fd, _size);
         if (addr == end)
         {
            try_pin(&_pinned, end, new_size - _size);
            _size = new_size;
            return nullptr;
         }
         else
         {
            if (addr != MAP_FAILED)
            {
               // fail safe in case the kernel does not support MAP_FIXED_NOREPLACE
               ::munmap(addr, new_size - _size);
            }
         }
      }
#endif
      // Move the mapping to a new location
      if (auto addr = ::mmap(nullptr, new_size, prot, MAP_SHARED, _fd, 0); addr != MAP_FAILED)
      {
         result->addr = _data.load();
         result->size = _size;
         _data        = addr;
         _size        = new_size;
         try_pin(&_pinned, addr, _size);
         return std::shared_ptr<void>(std::move(result), result->addr);
      }
      else
      {
         throw std::system_error{errno, std::generic_category()};
      }
   }

}  // namespace triedent

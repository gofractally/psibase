#include <triedent/mapping.hpp>

#include <cassert>
#include <system_error>

#include <fcntl.h>
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
   }  // namespace

   mapping::mapping(const std::filesystem::path& file, access_mode mode, bool pin)
       : _mode(mode), _pinned(pin)
   {
      int flags = O_CLOEXEC;
      if (mode == access_mode::read_write)
      {
         flags |= O_RDWR;
         flags |= O_CREAT;
      }
      else
      {
         flags |= O_RDONLY;
      }
      _fd = ::open(file.native().c_str(), flags, 0644);
      if (_fd == -1)
      {
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
         if (auto addr = ::mmap(nullptr, _size, get_prot(mode), MAP_SHARED, _fd, 0);
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
#ifdef MAP_FIXED_NOREPLACE
      auto prot = get_prot(_mode);
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

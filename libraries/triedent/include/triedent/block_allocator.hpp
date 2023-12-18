#pragma once
#include <filesystem>
#include <memory>
#include <utility>

#include <cassert>
#include <system_error>

#include <fcntl.h>
#include <sys/file.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <iostream>
#include <vector>

#include <triedent/mapping.hpp>

namespace triedent
{

   class block_allocator
   {
     public:
      using id = uint32_t;

      block_allocator(std::filesystem::path file,
                      uint64_t              block_size,
                      uint32_t              max_blocks,
                      bool                  read_write = true)
          : _filename(file), _block_size(block_size)
      {
         _max_blocks = max_blocks;
         _block_mapping = new char_ptr[max_blocks];

         int flags = O_CLOEXEC;
         int flock_operation;
         if (read_write)
         {
            flags |= O_RDWR;
            flags |= O_CREAT;
            flock_operation = LOCK_EX;
         }
         else
         {
            flags |= O_RDONLY;
            flock_operation = LOCK_SH;
         }

         _fd = ::open(file.native().c_str(), flags, 0644);
         if (_fd == -1) {
            std::cerr <<"opening " << file.native() <<"\n";
            throw std::runtime_error("unable to open block file");
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
         _file_size = statbuf->st_size;
         if (_file_size % block_size != 0)
         {
            ::close(_fd);
            throw std::runtime_error("block file isn't a multiple of block size");
         }
         if (_file_size)
         {
            auto prot = PROT_READ | PROT_WRITE;  //get_prot(_mode);
            if (auto addr = ::mmap(nullptr, _file_size, prot, MAP_SHARED, _fd, 0);
                addr != MAP_FAILED)
            {
               char* data = (char*)addr;
               auto  end  = data + _file_size;
               while (data != end)
               {
                  _block_mapping[ _num_blocks.fetch_add(1) ] = data;
                  //_block_mapping.push_back(data);
                  data += _block_size;
               }
               // try_pin(&_pinned, addr, _size);
               //      std::cerr<<"madvise random  " << int64_t(addr) <<"   " << _size << " \n";
               //      madvise(addr, _size, MADV_RANDOM );
            }
            else
            {
               ::close(_fd);
               throw std::system_error{errno, std::generic_category()};
            }
         }
      }
      ~block_allocator()
      {
         if (_fd)
         {
            for( uint32_t i = 0; i < _num_blocks.load(); ++i )
               ::munmap(_block_mapping[i], _block_size);
            ::close(_fd);
         }
      }

      uint64_t block_size() const { return _block_size; }
      uint64_t num_blocks()const  { return _num_blocks.load( std::memory_order_relaxed ); } 
      
      /**
       * This method brute forces syncing all blocks which likely
       * flushes more than needed.
       */
      void sync(sync_type st) {
         if (_fd and sync_type::none != st )
         {
            uint64_t nb = num_blocks();
            for( uint32_t i = 0; i < nb; ++i )
               ::msync(_block_mapping[i], _block_size, msync_flag(st) );
         }
      }

      // return the base pointer for the mapped segment
      inline void* get(id i) { 
         assert( i < _num_blocks.load(std::memory_order_relaxed) );
         // this is safe because block mapping reserved capacity so 
         // resize should never move the data
         return _block_mapping[i]; 
      }

      id alloc()
      {
         std::lock_guard l{_resize_mutex};

         auto new_size = _file_size + _block_size;
         if (::ftruncate(_fd, new_size) < 0)
         {
            throw std::system_error(errno, std::generic_category());
         }

         auto prot = PROT_READ | PROT_WRITE;  //get_prot(_mode);
         if (auto addr = ::mmap(nullptr, _block_size, prot, MAP_SHARED, _fd, _file_size);
             addr != MAP_FAILED)
         {
            auto nb = _num_blocks.load( std::memory_order_relaxed );
            if( nb == _max_blocks )
               throw std::runtime_error("maximum block number reached");

               _block_mapping[_num_blocks.load(std::memory_order_relaxed)] = (char*)addr;
               _file_size = new_size;
               return _num_blocks.fetch_add(1, std::memory_order_release);
         }
         if (::ftruncate(_fd, _file_size) < 0)
         {
            throw std::system_error(errno, std::generic_category());
         }
         throw std::runtime_error("unable to mmap new block");
      }

     private:
      std::filesystem::path _filename;
      uint64_t              _block_size;
      uint64_t              _max_blocks;
      uint64_t              _file_size;
      int                   _fd;
      std::atomic<uint64_t> _num_blocks;
    //  std::vector<void*>    _block_mapping;
      using char_ptr = char*;
      char_ptr*             _block_mapping;
      mutable std::mutex    _resize_mutex;
   };
}  // namespace triedent

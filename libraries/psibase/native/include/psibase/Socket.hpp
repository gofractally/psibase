#pragma once

#include <cstdint>
#include <memory>
#include <mutex>
#include <span>
#include <vector>

namespace psibase
{

   struct Socket
   {
      virtual void send(std::span<const char>) = 0;
      std::int32_t id;
   };

   struct Sockets
   {
      std::vector<std::weak_ptr<Socket>> sockets;
      std::mutex                         mutex;
      std::int32_t                       send(std::int32_t fd, std::span<const char> buf)
      {
         constexpr auto          wasi_errno_badf = 8;
         constexpr auto          wasi_errno_pipe = 64;
         std::shared_ptr<Socket> p;
         {
            std::lock_guard l{mutex};
            if (fd < 0 || fd > sockets.size())
               return wasi_errno_badf;
            p = sockets[fd].lock();
         }
         if (!p)
            return wasi_errno_pipe;

         p->send(buf);
         return 0;
      }
      void add(const std::shared_ptr<Socket>& socket)
      {
         std::lock_guard l{mutex};
         socket->id = sockets.size();
         sockets.push_back(socket);
      }
   };

}  // namespace psibase

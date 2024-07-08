#pragma once

#include <boost/dynamic_bitset.hpp>
#include <cstdint>
#include <memory>
#include <mutex>
#include <psibase/check.hpp>
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
      std::vector<std::shared_ptr<Socket>> sockets;
      boost::dynamic_bitset<>              available;
      std::mutex                           mutex;
      std::int32_t                         send(std::int32_t fd, std::span<const char> buf)
      {
         constexpr auto          wasi_errno_badf = 8;
         constexpr auto          wasi_errno_pipe = 64;
         std::shared_ptr<Socket> p;
         {
            std::lock_guard l{mutex};
            if (fd < 0 || fd > sockets.size())
               return wasi_errno_badf;
            p = sockets[fd];
         }
         if (!p)
            return wasi_errno_pipe;

         p->send(buf);
         return 0;
      }
      void add(const std::shared_ptr<Socket>& socket)
      {
         std::lock_guard l{mutex};
         if (auto pos = available.find_first(); pos != boost::dynamic_bitset<>::npos)
         {
            socket->id   = pos;
            sockets[pos] = socket;
            available.reset(pos);
         }
         else
         {
            check(sockets.size() <=
                      static_cast<std::uint32_t>(std::numeric_limits<std::int32_t>::max()),
                  "Too many open sockets");

            socket->id = sockets.size();
            sockets.push_back(socket);
            available.push_back(false);
         }
      }
      void remove(const std::shared_ptr<Socket>& socket)
      {
         std::lock_guard l{mutex};
         if (socket->id >= 0 && socket->id < sockets.size())
         {
            if (sockets[socket->id] == socket)
            {
               available.set(socket->id);
               sockets[socket->id].reset();
            }
         }
      }
   };

}  // namespace psibase

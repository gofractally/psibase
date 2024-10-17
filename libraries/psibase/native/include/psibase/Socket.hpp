#pragma once

#include <boost/dynamic_bitset.hpp>
#include <cstdint>
#include <memory>
#include <mutex>
#include <psibase/check.hpp>
#include <set>
#include <span>
#include <vector>

namespace psibase
{
   struct Sockets;
   struct Socket
   {
      ~Socket();
      virtual void           send(std::span<const char>) = 0;
      virtual bool           canAutoClose() const;
      std::int32_t           id;
      bool                   closed = false;
      bool                   once   = false;
      std::weak_ptr<Sockets> weak_sockets;
   };

   struct SocketAutoCloseSet;

   struct AutoCloseSocket : Socket
   {
      virtual bool        canAutoClose() const override;
      virtual void        autoClose(const std::optional<std::string>& message) noexcept = 0;
      SocketAutoCloseSet* owner;
   };

   struct SocketChange
   {
      std::shared_ptr<AutoCloseSocket> socket;
      SocketAutoCloseSet*              owner;
   };

   using SocketChangeSet = std::vector<SocketChange>;

   struct SocketAutoCloseSet
   {
      std::set<std::shared_ptr<AutoCloseSocket>> sockets;
      void close(const std::optional<std::string>& message = {});
      bool owns(Sockets& sockets, const AutoCloseSocket& sock);
      ~SocketAutoCloseSet();
   };

   struct Sockets : std::enable_shared_from_this<Sockets>
   {
      std::vector<std::shared_ptr<Socket>> sockets;
      boost::dynamic_bitset<>              available;
      bool                                 stopped = false;
      std::mutex                           mutex;
      void                                 shutdown();
      std::int32_t                         send(std::int32_t fd, std::span<const char> buf);
      void         add(const std::shared_ptr<Socket>& socket, SocketAutoCloseSet* owner = nullptr);
      void         remove(const std::shared_ptr<Socket>& socket);
      std::int32_t autoClose(std::int32_t               socket,
                             bool                       value,
                             SocketAutoCloseSet*        owner,
                             std::vector<SocketChange>* diff = nullptr);
      bool         applyChanges(const std::vector<SocketChange>& diff, SocketAutoCloseSet* owner);
   };

}  // namespace psibase

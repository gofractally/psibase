#include <psibase/Socket.hpp>

using namespace psibase;

static constexpr auto wasi_errno_acces      = 2;
static constexpr auto wasi_errno_badf       = 8;
static constexpr auto wasi_errno_noprotoopt = 50;

Socket::~Socket()
{
   if (auto sockets = weak_sockets.lock())
   {
      std::lock_guard l{sockets->mutex};
      sockets->available.set(id);
   }
}

bool Socket::canAutoClose() const
{
   return false;
}

bool AutoCloseSocket::canAutoClose() const
{
   return true;
}

void SocketAutoCloseSet::close(const std::optional<std::string>& message)
{
   for (const auto& socket : sockets)
   {
      socket->autoClose(message);
   }
   sockets.clear();
}
SocketAutoCloseSet::~SocketAutoCloseSet()
{
   close();
}

std::int32_t Sockets::send(std::int32_t fd, std::span<const char> buf)
{
   std::shared_ptr<Socket> p;
   {
      std::lock_guard l{mutex};
      if (fd >= 0 && fd < sockets.size())
         p = sockets[fd];
   }
   if (!p)
      return wasi_errno_badf;

   p->send(buf);
   return 0;
}
void Sockets::add(const std::shared_ptr<Socket>& socket, SocketAutoCloseSet* owner)
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
      check(sockets.size() <= static_cast<std::uint32_t>(std::numeric_limits<std::int32_t>::max()),
            "Too many open sockets");

      // TODO: exception safety
      socket->id = sockets.size();
      sockets.push_back(socket);
      available.push_back(false);
   }
   if (owner)
   {
      assert(socket->canAutoClose());
      auto sockptr   = std::static_pointer_cast<AutoCloseSocket>(socket);
      sockptr->owner = owner;
      owner->sockets.insert(sockptr);
   }
   socket->weak_sockets = shared_from_this();
}
void Sockets::remove(const std::shared_ptr<Socket>& socket)
{
   std::lock_guard l{mutex};
   if (socket->id >= 0 && socket->id < sockets.size())
   {
      if (sockets[socket->id] == socket)
      {
         assert(!socket->closed);
         if (socket->canAutoClose())
         {
            auto sockptr = std::static_pointer_cast<AutoCloseSocket>(socket);
            if (sockptr->owner)
               sockptr->owner->sockets.erase(sockptr);
         }
         socket->closed = true;
         sockets[socket->id].reset();
      }
   }
}
std::int32_t Sockets::autoClose(std::int32_t               fd,
                                bool                       value,
                                SocketAutoCloseSet*        owner,
                                std::vector<SocketChange>* diff)
{
   std::shared_ptr<AutoCloseSocket> sockptr;
   {
      std::lock_guard l{mutex};
      if (fd < 0 || fd >= sockets.size() || !sockets[fd])
         return wasi_errno_badf;
      auto p = sockets[fd];

      if (!p->canAutoClose())
         return wasi_errno_noprotoopt;

      sockptr = std::static_pointer_cast<AutoCloseSocket>(p);

      if (sockptr->owner && sockptr->owner != owner)
         return wasi_errno_acces;

      if (!diff)
         sockptr->owner = value ? owner : nullptr;
   }

   if (diff)
   {
      diff->push_back({sockptr, value ? owner : nullptr});
   }
   else
   {
      if (value)
         owner->sockets.insert(sockptr);
      else
         owner->sockets.erase(sockptr);
   }
   return 0;
}
bool Sockets::applyChanges(const std::vector<SocketChange>& diff, SocketAutoCloseSet* owner)
{
   std::lock_guard l{mutex};
   for (const auto& change : diff)
   {
      if (change.socket->closed || change.socket->owner && change.socket->owner != owner)
         return false;
   }
   for (const auto& change : diff)
   {
      if (change.socket->owner && !change.owner)
      {
         owner->sockets.erase(change.socket);
      }
      else if (!change.socket->owner && change.owner)
      {
         owner->sockets.insert(change.socket);
      }
      change.socket->owner = change.owner;
   }
   return true;
}

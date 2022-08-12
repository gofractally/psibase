#pragma once

namespace psibase::net
{
   template <template <typename> typename Link,
             template <typename>
             typename Routing,
             template <typename>
             typename Consensus,
             typename Chain>
   struct node : Link<node<Link, Routing, Consensus, Chain>>,
                 Routing<node<Link, Routing, Consensus, Chain>>,
                 Consensus<node<Link, Routing, Consensus, Chain>>
   {
      template <typename ExecutionContext, typename ChainArg>
      explicit node(ExecutionContext& ctx, ChainArg&& chainArg)
          : Link<node>(ctx),
            Routing<node>(ctx),
            Consensus<node>(ctx),
            _chain{std::forward<ChainArg>(chainArg)}
      {
      }
      Link<node>&      peers() { return *this; }
      Routing<node>&   network() { return *this; }
      Consensus<node>& consensus() { return *this; }
      Chain&           chain() { return _chain; }
      Chain            _chain;
   };
}  // namespace psibase::net

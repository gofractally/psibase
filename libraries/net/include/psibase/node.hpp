#pragma once

namespace psibase::net
{
   template<template<typename> typename Link, template<typename> typename Routing, template<typename> typename Consensus, typename Chain>
   struct node :
      Link<node<Link, Routing, Consensus, Chain>>,
      Routing<node<Link, Routing, Consensus, Chain>>,
      Consensus<node<Link, Routing, Consensus, Chain>>
   {
      template<typename ExecutionContext>
      explicit node(ExecutionContext& ctx) : Routing<node>(ctx), Consensus<node>(ctx) {}
      Routing<node>& network() { return *this; }
      Consensus<node>& consensus() { return *this; }
      Chain& chain() { return _chain; }
      Chain _chain;
   };
}

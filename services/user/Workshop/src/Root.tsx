"use client";
import React, { useState } from "react";
import { IconBrandTabler, IconSettings } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Sidebar, SidebarBody, SidebarLink } from "./components/ui/sidebar";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Fuel, LifeBuoy, Plus } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { ChartContainer } from "./components/ui/chart";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import { Separator } from "@/components/ui/separator";
import { Outlet } from "react-router-dom";

export function SidebarDemo() {
  const [apps, setApps] = useState([
    {
      id: "tokens",
      name: "Tokens",
    },
    {
      id: "symbols",
      name: "Symbols",
    },
  ]);

  const links = [
    {
      label: "Dashboard",
      href: "#",
      icon: (
        <IconBrandTabler className="text-neutral-700 dark:text-neutral-200 h-5 w-5 flex-shrink-0" />
      ),
    },
    {
      label: "Gas",
      href: "#",
      icon: (
        <Fuel className="text-neutral-700 dark:text-neutral-200 h-5 w-5 flex-shrink-0" />
      ),
    },
    {
      label: "Support",
      href: "#",
      icon: (
        <LifeBuoy className="text-neutral-700 dark:text-neutral-200 h-5 w-5 flex-shrink-0" />
      ),
    },
    {
      label: "Settings",
      href: "#",
      icon: (
        <IconSettings className="text-neutral-700 dark:text-neutral-200 h-5 w-5 flex-shrink-0" />
      ),
    },
  ];

  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "rounded-md h-screen flex flex-col md:flex-row w-full flex-1 max-w-screen-2xl mx-auto border  overflow-hidden"
      )}
    >
      <Sidebar open={open} setOpen={setOpen} animate={false}>
        <SidebarBody className="justify-between gap-10">
          <div className="flex flex-col gap-5 flex-1 overflow-y-auto overflow-x-hidden">
            <>
              <Logo />
            </>
            <div>
              <Select>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Tokens" />
                </SelectTrigger>
                <SelectContent>
                  {apps.map((app) => (
                    <SelectItem value={app.id}>{app.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              {links.map((link, idx) => (
                <SidebarLink key={idx} link={link} />
              ))}
            </div>
          </div>
          <div>
            <SidebarLink
              link={{
                label: "Create new app",
                href: "#",
                icon: (
                  <Plus className="text-neutral-700 dark:text-neutral-200 h-5 w-5 flex-shrink-0" />
                ),
              }}
            />
            <SidebarLink
              link={{
                label: "Manu Arora",
                href: "/profile",
                icon: (
                  <img
                    src="https://assets.aceternity.com/manu.png"
                    className="h-7 w-7 flex-shrink-0 rounded-full"
                    width={50}
                    height={50}
                    alt="Avatar"
                  />
                ),
              }}
            />
          </div>
        </SidebarBody>
      </Sidebar>
      <Dashboard />
    </div>
  );
}
export const Logo = () => {
  return (
    <a
      href="#"
      className="font-normal flex space-x-2 items-center text-sm text-black py-1 relative z-20"
    >
      <div className="h-5 w-6 bg-black dark:bg-white rounded-br-lg rounded-tr-sm rounded-tl-lg rounded-bl-sm flex-shrink-0" />
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="font-medium text-black dark:text-white whitespace-pre"
      >
        Workshop
      </motion.span>
    </a>
  );
};
export const LogoIcon = () => {
  return (
    <a
      href="#"
      className="font-normal flex space-x-2 items-center text-sm text-black py-1 relative z-20"
    >
      <div className="h-5 w-6 bg-black dark:bg-white rounded-br-lg rounded-tr-sm rounded-tl-lg rounded-bl-sm flex-shrink-0" />
    </a>
  );
};

const FuelComponent = () => (
  <Card className="max-w-sm" x-chunk="charts-01-chunk-4">
    <CardContent className="flex gap-4 p-4 pb-2">
      <ChartContainer
        config={{
          move: {
            label: "Move",
            color: "hsl(var(--chart-1))",
          },
          stand: {
            label: "Stand",
            color: "hsl(var(--chart-2))",
          },
          exercise: {
            label: "Exercise",
            color: "hsl(var(--chart-3))",
          },
        }}
        className="h-[140px] w-full"
      >
        <BarChart
          margin={{
            left: 0,
            right: 0,
            top: 0,
            bottom: 10,
          }}
          data={[
            {
              activity: "stand",
              value: (8 / 12) * 100,
              label: "8/12 hr",
              fill: "var(--color-stand)",
            },
            {
              activity: "exercise",
              value: (46 / 60) * 100,
              label: "46/60 min",
              fill: "var(--color-exercise)",
            },
            {
              activity: "move",
              value: (245 / 360) * 100,
              label: "245/360 kcal",
              fill: "var(--color-move)",
            },
          ]}
          layout="vertical"
          barSize={32}
          barGap={2}
        >
          <XAxis type="number" dataKey="value" hide />
          <YAxis
            dataKey="activity"
            type="category"
            tickLine={false}
            tickMargin={4}
            axisLine={false}
            className="capitalize"
          />
          <Bar dataKey="value" radius={5}>
            <LabelList
              position="insideLeft"
              dataKey="label"
              fill="white"
              offset={8}
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </CardContent>
    <CardFooter className="flex flex-row border-t p-4">
      <div className="flex w-full items-center gap-2">
        <div className="grid flex-1 auto-rows-min gap-0.5">
          <div className="text-xs text-muted-foreground">Storage</div>
          <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
            562
            <span className="text-sm font-normal text-muted-foreground">
              mb
            </span>
          </div>
        </div>
        <Separator orientation="vertical" className="mx-2 h-10 w-px" />
        <div className="grid flex-1 auto-rows-min gap-0.5">
          <div className="text-xs text-muted-foreground">CPU</div>
          <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
            73
            <span className="text-sm font-normal text-muted-foreground">
              ms
            </span>
          </div>
        </div>
        <Separator orientation="vertical" className="mx-2 h-10 w-px" />
        <div className="grid flex-1 auto-rows-min gap-0.5">
          <div className="text-xs text-muted-foreground">Network</div>
          <div className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
            14
            <span className="text-sm font-normal text-muted-foreground">
              mb
            </span>
          </div>
        </div>
      </div>
    </CardFooter>
  </Card>
);

const Dashboard = () => {
  return (
    <div className="flex flex-1">
      <div className="p-2 md:p-10  bg-white dark:bg-neutral-900 flex flex-col gap-2 flex-1 w-full h-full">
        <div className="flex gap-2 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default SidebarDemo;

"use client";

import type { ReactNode } from "react";
import { BookOpen, Clock3, Plug, SlidersHorizontal } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Panels stay mounted so switching sections preserves unsaved form state. */
export function AllokAgentWorkspace({ behavior, knowledge, hours, connections }: {
  behavior: ReactNode; knowledge: ReactNode; hours: ReactNode; connections: ReactNode;
}) {
  const panels = [
    { id: "behavior", label: "Comportamiento", icon: SlidersHorizontal, content: behavior },
    { id: "knowledge", label: "Conocimiento", icon: BookOpen, content: knowledge },
    { id: "hours", label: "Horarios", icon: Clock3, content: hours },
    { id: "connections", label: "Conexiones", icon: Plug, content: connections },
  ];
  return <Tabs defaultValue="behavior" className="allok-agent-workspace">
    <TabsList aria-label="Configuración del agente" className="allok-agent-tabs">
      {panels.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id}>
        <Icon className="h-4 w-4" aria-hidden="true" />{label}
      </TabsTrigger>)}
    </TabsList>
    {panels.map(({ id, content }) => <TabsContent key={id} value={id} forceMount className="allok-agent-panel data-[state=inactive]:hidden">
      {content}
    </TabsContent>)}
  </Tabs>;
}

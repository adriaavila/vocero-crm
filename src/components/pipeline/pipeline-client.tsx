"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { MessageSquareText, Settings2, Trophy, XCircle } from "lucide-react";
import type { StageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast-provider";
import { formatTime } from "@/components/inbox/helpers";
import { StageManager } from "./stage-manager";

export type BoardLead = {
  id: string;
  stageId: string;
  position: number;
  lastActivityAt: string | null;
  contact: { id: string; name: string; phone: string | null };
  conversationId: string | null;
};

export function PipelineClient({ canManage }: { canManage: boolean }) {
  const [stages, setStages] = useState<StageDto[]>([]);
  const [leads, setLeads] = useState<BoardLead[]>([]);
  const [activeLead, setActiveLead] = useState<BoardLead | null>(null);
  const [managing, setManaging] = useState(false);
  const notify = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const refetch = useCallback(async () => {
    const res = await fetch("/api/pipeline/board").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { stages: StageDto[]; leads: BoardLead[] };
    setStages(data.stages);
    setLeads(data.leads);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function onDragStart(event: DragStartEvent) {
    const lead = leads.find((l) => l.id === event.active.id);
    setActiveLead(lead ?? null);
  }

  async function moveLead(leadId: string, stageId: string) {
    const lead = leads.find((item) => item.id === leadId);
    if (!lead || lead.stageId === stageId) return;
    const previous = leads;
    const position = leads.filter((item) => item.stageId === stageId).length;
    setLeads((current) => current.map((item) => item.id === leadId ? { ...item, stageId, position } : item));
    const response = await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stageId, position }),
    }).catch(() => null);
    if (!response?.ok) {
      setLeads(previous);
      notify("No se pudo mover el contacto. Se restauró la etapa anterior.", "error");
      return;
    }
    notify("Etapa actualizada.");
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const leadId = String(event.active.id);
    const overStage = event.over ? String(event.over.id) : null;
    if (!overStage) return;
    await moveLead(leadId, overStage);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="font-semibold">Pipeline</h2>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => setManaging(true)}>
            <Settings2 className="h-4 w-4" /> Gestionar etapas
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-x-auto p-4">
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={(e) => void onDragEnd(e)}
        >
          <div className="flex h-full snap-x snap-mandatory gap-3 md:snap-none">
            {stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                leads={leads
                  .filter((l) => l.stageId === stage.id)
                  .sort((a, b) => a.position - b.position)}
                stages={stages}
                onMove={moveLead}
              />
            ))}
          </div>
          <DragOverlay>
            {activeLead ? <LeadCard lead={activeLead} overlay /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {managing && (
        <StageManager
          stages={stages}
          onClose={() => setManaging(false)}
          onChanged={() => void refetch()}
        />
      )}
    </div>
  );
}

function StageColumn({ stage, leads, stages, onMove }: { stage: StageDto; leads: BoardLead[]; stages: StageDto[]; onMove: (leadId: string, stageId: string) => Promise<void> }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-[82vw] max-w-72 shrink-0 snap-center flex-col rounded-lg border bg-card/50 md:w-64",
        isOver && "ring-2 ring-primary/60"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {stage.kind === "won" && <Trophy className="h-3.5 w-3.5 text-primary" />}
          {stage.kind === "lost" && (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {stage.name}
        </span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {leads.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {leads.map((lead) => (
          <DraggableLead key={lead.id} lead={lead} stages={stages} onMove={onMove} />
        ))}
      </div>
    </div>
  );
}

function DraggableLead({ lead, stages, onMove }: { lead: BoardLead; stages: StageDto[]; onMove: (leadId: string, stageId: string) => Promise<void> }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(isDragging && "opacity-40")}
    >
      <LeadCard lead={lead} stages={stages} onMove={onMove} />
    </div>
  );
}

function LeadCard({ lead, stages = [], onMove, overlay = false }: { lead: BoardLead; stages?: StageDto[]; onMove?: (leadId: string, stageId: string) => Promise<void>; overlay?: boolean }) {
  return (
    <div
      className={cn(
        "cursor-grab rounded-md border bg-card p-3 shadow-sm",
        overlay && "rotate-2 shadow-xl"
      )}
    >
      <div className="flex items-center gap-2.5">
        <ContactAvatar name={lead.contact.name} seed={lead.contact.id} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.contact.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {lead.lastActivityAt
              ? `Actividad: ${formatTime(lead.lastActivityAt)}`
              : "Sin actividad"}
          </p>
        </div>
        {lead.conversationId && (
          <Link
            href={`/inbox?contact=${lead.contact.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Abrir conversación"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MessageSquareText className="h-4 w-4" />
          </Link>
        )}
      </div>
      {!overlay && onMove && (
        <select
          value={lead.stageId}
          aria-label={`Mover ${lead.contact.name} de etapa`}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => void onMove(lead.id, event.target.value)}
          className="mt-3 h-11 w-full rounded-md border bg-background px-2 text-sm md:hidden"
        >
          {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </select>
      )}
    </div>
  );
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "../lib/logger";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase.service";

export interface AuditEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorUsername: string;
  officeId: string;
  action: string;
  entityType:
    | "auth"
    | "user"
    | "session"
    | "poa"
    | "task"
    | "judgment"
    | "case"
    | "client"
    | "document"
    | "finance"
    | "settings"
    | "backup";
  entityId: string;
  summary: string;
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const AUDIT_FILE = path.join(DATA_DIR, "audit_log.json");
const MAX_LOCAL_AUDIT = 2000;

let memoryAudit: AuditEntry[] = [];

function loadLocalAudit(): AuditEntry[] {
  try {
    if (fs.existsSync(AUDIT_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
      if (Array.isArray(parsed)) {
        memoryAudit = parsed;
        return parsed;
      }
    }
  } catch {
    // Fall back to in-memory buffer
  }
  return memoryAudit;
}

function saveLocalAudit(entries: AuditEntry[]): void {
  const trimmed = entries.slice(-MAX_LOCAL_AUDIT);
  memoryAudit = trimmed;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(trimmed, null, 2), "utf8");
  } catch {
    // Serverless read-only FS uses Supabase when configured or memory buffer
  }
}

export async function recordAuditEvent(input: Omit<AuditEntry, "id" | "timestamp">): Promise<void> {
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...input,
  };

  // Safe technical log without sensitive PII message bodies
  logger.info(
    {
      auditId: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      officeId: entry.officeId,
      actorId: entry.actorId,
    },
    "Audit event recorded",
  );

  if (isSupabaseConfigured()) {
    try {
      const client = getSupabaseClient();
      if (client) {
        await client.from("audit_logs").insert({
          id: entry.id,
          created_at: entry.timestamp,
          actor_id: entry.actorId,
          actor_username: entry.actorUsername,
          office_id: entry.officeId,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          summary: entry.summary,
        });
      }
    } catch {
      // Optional table in Supabase; still retain local/memory trail
    }
  }

  const existing = loadLocalAudit();
  existing.push(entry);
  saveLocalAudit(existing);
}

export async function listAuditEvents(options: {
  officeId?: string;
  isPlatformAdmin?: boolean;
  limit?: number;
}): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

  if (isSupabaseConfigured()) {
    try {
      const client = getSupabaseClient();
      if (client) {
        let query = client
          .from("audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (!options.isPlatformAdmin && options.officeId) {
          query = query.eq("office_id", options.officeId);
        }
        const { data, error } = await query;
        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map((row: Record<string, unknown>) => ({
            id: String(row.id ?? ""),
            timestamp: String(row.created_at ?? ""),
            actorId: String(row.actor_id ?? ""),
            actorUsername: String(row.actor_username ?? ""),
            officeId: String(row.office_id ?? ""),
            action: String(row.action ?? ""),
            entityType: (row.entity_type as AuditEntry["entityType"]) ?? "settings",
            entityId: String(row.entity_id ?? ""),
            summary: String(row.summary ?? ""),
          }));
        }
      }
    } catch {
      // Fallback to local buffer
    }
  }

  const all = loadLocalAudit();
  const filtered = options.isPlatformAdmin
    ? all
    : all.filter((e) => e.officeId === options.officeId);
  return [...filtered].reverse().slice(0, limit);
}

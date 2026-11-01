import crypto from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "../config/env";
import { logger } from "../lib/logger";
import { ExternalServiceError } from "../lib/errors";
import { readOfficeLocalRows, writeOfficeLocalRows } from "./googleSheets.service";
import { withSheetLock } from "../utils/sheetMeta";

export type CaseStage = "ابتدائية" | "استئناف" | "تنفيذ" | "عليا" | "صلح وتسوية";
export type CaseStatus = "active" | "closed" | "appealed" | "suspended";

export interface CaseDocumentVersion {
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  notes?: string | null;
  contentUrlOrBase64?: string | null;
  uploadedBy: string;
  uploadedAt: string;
}

export interface CaseDocument {
  id: string;
  caseId: string;
  officeId: string;
  title: string;
  category: "مذكرة" | "صك حكم" | "عقد" | "مستند إثبات" | "تقرير خبرة" | "أخرى";
  currentVersion: number;
  versions: CaseDocumentVersion[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CaseFinancialEntry {
  id: string;
  caseId: string;
  clientId?: string | null;
  officeId: string;
  entryType: "payment" | "expense" | "invoice";
  amount: number;
  description: string;
  date: string;
  referenceNumber?: string | null;
  recordedBy: string;
  createdAt: string;
  deletedAt?: string | null;
}

export interface CaseFile {
  id: string;
  internalNumber: string; // Internal Office Case ID, e.g. "CAS-2026-001"
  courtCaseNumber: string; // Ministry of Justice / Najiz Case Number, e.g. "441098234"
  title: string;
  clientId: string;
  clientName: string;
  opponentName: string;
  court: string;
  circuit?: string | null;
  assignedLawyer: string;
  assigneeId?: string | null;
  stage: CaseStage;
  status: CaseStatus;
  filingDateHijri?: string | null;
  nextHearing?: string | null;
  lastAction?: string | null;
  requiredAction?: string | null;
  missingDocuments?: string[];
  totalFees?: number;
  paidFees?: number;
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
  officeId: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
}

function getSupabase() {
  if (!isSupabaseConfigured() || !env.supabaseUrl) return null;
  return createSupabaseClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadOfficeCollection<T>(kind: string, officeId: string): Promise<T[]> {
  if (!officeId || officeId === "all") {
    throw new ExternalServiceError("لا يُسمح بقراءة القضايا أو المستندات دون تحديد المكتب المالك.");
  }

  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("office_collections")
        .select("payload")
        .eq("office_id", officeId)
        .eq("collection_name", kind)
        .maybeSingle();

      if (!error && data && Array.isArray((data as any).payload)) {
        return (data as any).payload as T[];
      }
    } catch (err) {
      logger.warn({ kind, officeId }, "Supabase office_collections lookup fallback to durable store");
    }
  }

  return readOfficeLocalRows<T>(kind, officeId);
}

async function saveOfficeCollection<T>(kind: string, officeId: string, items: T[]): Promise<void> {
  if (!officeId || officeId === "all") {
    throw new ExternalServiceError("لا يُسمح بحفظ السجلات دون تحديد معرّف المكتب المالك.");
  }

  const sb = getSupabase();
  let savedRemote = false;
  if (sb) {
    try {
      const { error } = await sb.from("office_collections").upsert(
        {
          office_id: officeId,
          collection_name: kind,
          payload: items,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "office_id,collection_name" },
      );
      if (!error) savedRemote = true;
    } catch {
      savedRemote = false;
    }
  }

  if (!savedRemote) {
    writeOfficeLocalRows(kind, officeId, items);
  } else {
    try {
      writeOfficeLocalRows(kind, officeId, items);
    } catch {
      // Remote write already succeeded
    }
  }
}

export async function listCases(
  officeId: string,
  clientId?: string,
  includeDeleted = false,
): Promise<CaseFile[]> {
  const all = await loadOfficeCollection<CaseFile>("cases", officeId);
  return all.filter((c) => {
    if (c.officeId !== officeId) return false;
    if (!includeDeleted && c.deletedAt) return false;
    if (clientId && c.clientId !== clientId) return false;
    return true;
  });
}

export async function getCaseById(id: string, officeId: string): Promise<CaseFile | null> {
  const all = await listCases(officeId, undefined, false);
  return (
    all.find((c) => c.id === id || c.internalNumber === id || c.courtCaseNumber === id) || null
  );
}

export async function createCase(
  data: Omit<CaseFile, "id" | "internalNumber" | "createdAt" | "status" | "officeId"> &
    Partial<CaseFile> & { officeId: string },
): Promise<CaseFile> {
  const officeId = data.officeId;
  return withSheetLock(`cases:${officeId}`, async () => {
    const all = await loadOfficeCollection<CaseFile>("cases", officeId);
    const year = new Date().getFullYear();
    const seq = String(all.length + 1).padStart(3, "0");
    const internalNumber = data.internalNumber || `CAS-${year}-${seq}`;

    const newCase: CaseFile = {
      id: `case-${crypto.randomUUID().slice(0, 12)}`,
      internalNumber,
      courtCaseNumber: data.courtCaseNumber,
      title: data.title,
      clientId: data.clientId || "",
      clientName: data.clientName,
      opponentName: data.opponentName,
      court: data.court,
      circuit: data.circuit || null,
      assignedLawyer: data.assignedLawyer || "المحامي المسؤول",
      assigneeId: data.assigneeId || null,
      stage: data.stage || "ابتدائية",
      status: data.status || "active",
      filingDateHijri: data.filingDateHijri || null,
      nextHearing: data.nextHearing || null,
      lastAction: data.lastAction || null,
      requiredAction: data.requiredAction || null,
      missingDocuments: Array.isArray(data.missingDocuments) ? data.missingDocuments : [],
      totalFees: Number(data.totalFees) || 0,
      paidFees: Number(data.paidFees) || 0,
      notes: data.notes || null,
      createdAt: new Date().toISOString(),
      officeId,
      deletedAt: null,
    };

    all.unshift(newCase);
    await saveOfficeCollection("cases", officeId, all);
    return newCase;
  });
}

export async function updateCase(
  id: string,
  officeId: string,
  data: Partial<CaseFile>,
): Promise<CaseFile | null> {
  return withSheetLock(`cases:${officeId}`, async () => {
    const all = await loadOfficeCollection<CaseFile>("cases", officeId);
    const idx = all.findIndex(
      (c) => c.officeId === officeId && !c.deletedAt && (c.id === id || c.internalNumber === id),
    );
    if (idx === -1) return null;

    const { id: _ignoreId, officeId: _ignoreOffice, createdAt: _ignoreCreated, ...safePatch } = data;
    all[idx] = {
      ...all[idx],
      ...safePatch,
      id: all[idx].id,
      officeId,
      updatedAt: new Date().toISOString(),
    };

    await saveOfficeCollection("cases", officeId, all);
    return all[idx];
  });
}

export async function deleteCase(
  id: string,
  officeId: string,
  deletedBy?: string,
): Promise<boolean> {
  return withSheetLock(`cases:${officeId}`, async () => {
    const all = await loadOfficeCollection<CaseFile>("cases", officeId);
    const idx = all.findIndex(
      (c) => c.officeId === officeId && !c.deletedAt && (c.id === id || c.internalNumber === id),
    );
    if (idx === -1) return false;

    all[idx] = {
      ...all[idx],
      deletedAt: new Date().toISOString(),
      deletedBy: deletedBy || null,
      updatedAt: new Date().toISOString(),
    };
    await saveOfficeCollection("cases", officeId, all);
    return true;
  });
}

export async function restoreCase(id: string, officeId: string): Promise<boolean> {
  return withSheetLock(`cases:${officeId}`, async () => {
    const all = await loadOfficeCollection<CaseFile>("cases", officeId);
    const idx = all.findIndex(
      (c) => c.officeId === officeId && Boolean(c.deletedAt) && c.id === id,
    );
    if (idx === -1) return false;

    all[idx] = {
      ...all[idx],
      deletedAt: null,
      deletedBy: null,
      updatedAt: new Date().toISOString(),
    };
    await saveOfficeCollection("cases", officeId, all);
    return true;
  });
}

// ── Case Documents & Versioning ──────────────────────────────────────────────

export async function listCaseDocuments(
  caseId: string,
  officeId: string,
): Promise<CaseDocument[]> {
  const docs = await loadOfficeCollection<CaseDocument>("case_documents", officeId);
  return docs.filter((d) => d.officeId === officeId && d.caseId === caseId && !d.deletedAt);
}

export async function addOrVersionCaseDocument(params: {
  caseId: string;
  officeId: string;
  documentId?: string;
  title: string;
  category: CaseDocument["category"];
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  notes?: string | null;
  contentUrlOrBase64?: string | null;
  uploadedBy: string;
}): Promise<CaseDocument> {
  const { officeId, caseId } = params;
  return withSheetLock(`case_docs:${officeId}`, async () => {
    const docs = await loadOfficeCollection<CaseDocument>("case_documents", officeId);
    const now = new Date().toISOString();

    if (params.documentId) {
      const idx = docs.findIndex(
        (d) => d.id === params.documentId && d.officeId === officeId && d.caseId === caseId && !d.deletedAt,
      );
      if (idx !== -1) {
        const nextVer = docs[idx].currentVersion + 1;
        const newVer: CaseDocumentVersion = {
          version: nextVer,
          fileName: params.fileName,
          mimeType: params.mimeType || "application/octet-stream",
          sizeBytes: Number(params.sizeBytes) || 0,
          notes: params.notes || null,
          contentUrlOrBase64: params.contentUrlOrBase64 || null,
          uploadedBy: params.uploadedBy,
          uploadedAt: now,
        };
        docs[idx] = {
          ...docs[idx],
          title: params.title || docs[idx].title,
          category: params.category || docs[idx].category,
          currentVersion: nextVer,
          versions: [newVer, ...docs[idx].versions],
          updatedAt: now,
        };
        await saveOfficeCollection("case_documents", officeId, docs);
        return docs[idx];
      }
    }

    const initialVersion: CaseDocumentVersion = {
      version: 1,
      fileName: params.fileName,
      mimeType: params.mimeType || "application/octet-stream",
      sizeBytes: Number(params.sizeBytes) || 0,
      notes: params.notes || null,
      contentUrlOrBase64: params.contentUrlOrBase64 || null,
      uploadedBy: params.uploadedBy,
      uploadedAt: now,
    };

    const doc: CaseDocument = {
      id: `doc-${crypto.randomUUID().slice(0, 12)}`,
      caseId,
      officeId,
      title: params.title,
      category: params.category || "أخرى",
      currentVersion: 1,
      versions: [initialVersion],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    docs.unshift(doc);
    await saveOfficeCollection("case_documents", officeId, docs);
    return doc;
  });
}

export async function deleteCaseDocument(
  documentId: string,
  caseId: string,
  officeId: string,
): Promise<boolean> {
  return withSheetLock(`case_docs:${officeId}`, async () => {
    const docs = await loadOfficeCollection<CaseDocument>("case_documents", officeId);
    const idx = docs.findIndex(
      (d) => d.id === documentId && d.caseId === caseId && d.officeId === officeId && !d.deletedAt,
    );
    if (idx === -1) return false;
    docs[idx].deletedAt = new Date().toISOString();
    await saveOfficeCollection("case_documents", officeId, docs);
    return true;
  });
}

// ── Case Financial Ledger (Payments, Expenses, Invoices) ─────────────────────

export async function listCaseFinancialEntries(
  officeId: string,
  filters?: { caseId?: string; clientId?: string },
): Promise<CaseFinancialEntry[]> {
  const entries = await loadOfficeCollection<CaseFinancialEntry>("case_finances", officeId);
  return entries.filter((e) => {
    if (e.officeId !== officeId || e.deletedAt) return false;
    if (filters?.caseId && e.caseId !== filters.caseId) return false;
    if (filters?.clientId && e.clientId !== filters.clientId) return false;
    return true;
  });
}

export async function addCaseFinancialEntry(params: {
  caseId: string;
  clientId?: string | null;
  officeId: string;
  entryType: CaseFinancialEntry["entryType"];
  amount: number;
  description: string;
  date: string;
  referenceNumber?: string | null;
  recordedBy: string;
}): Promise<CaseFinancialEntry> {
  const { officeId } = params;
  return withSheetLock(`case_finances:${officeId}`, async () => {
    const entries = await loadOfficeCollection<CaseFinancialEntry>("case_finances", officeId);
    const entry: CaseFinancialEntry = {
      id: `fin-${crypto.randomUUID().slice(0, 12)}`,
      caseId: params.caseId,
      clientId: params.clientId || null,
      officeId,
      entryType: params.entryType,
      amount: Math.max(0, Number(params.amount) || 0),
      description: params.description,
      date: params.date || new Date().toISOString().slice(0, 10),
      referenceNumber: params.referenceNumber || null,
      recordedBy: params.recordedBy,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    entries.unshift(entry);
    await saveOfficeCollection("case_finances", officeId, entries);

    // Automatically synchronize paidFees on the parent case when a payment is recorded
    if (entry.entryType === "payment") {
      const caseItem = await getCaseById(params.caseId, officeId);
      if (caseItem) {
        const allCasePayments = entries
          .filter((e) => e.caseId === caseItem.id && e.entryType === "payment" && !e.deletedAt)
          .reduce((sum, e) => sum + e.amount, 0);
        await updateCase(caseItem.id, officeId, { paidFees: allCasePayments });
      }
    }

    return entry;
  });
}

export { loadOfficeCollection, saveOfficeCollection };

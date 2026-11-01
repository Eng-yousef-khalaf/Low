import crypto from "crypto";
import { loadOfficeCollection, saveOfficeCollection } from "./cases.service";
import { withSheetLock } from "../utils/sheetMeta";

export type ClientType = "individual" | "company";

export interface Client {
  id: string;
  name: string;
  type: ClientType;
  identityNumber?: string | null; // National ID or Commercial Registration (CR)
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contactPerson?: string | null; // Responsible person or representative for companies
  notes?: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt?: string;
  officeId: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
}

export async function listClients(
  officeId: string,
  includeDeleted = false,
): Promise<Client[]> {
  const all = await loadOfficeCollection<Client>("clients", officeId);
  return all.filter((c) => {
    if (c.officeId !== officeId) return false;
    if (!includeDeleted && c.deletedAt) return false;
    return true;
  });
}

export async function getClientById(id: string, officeId: string): Promise<Client | null> {
  const all = await listClients(officeId, false);
  return all.find((c) => c.id === id) || null;
}

export async function createClient(
  data: Omit<Client, "id" | "createdAt" | "status" | "officeId"> &
    Partial<Client> & { officeId: string },
): Promise<Client> {
  const officeId = data.officeId;
  return withSheetLock(`clients:${officeId}`, async () => {
    const all = await loadOfficeCollection<Client>("clients", officeId);
    const newClient: Client = {
      id: `client-${crypto.randomUUID().slice(0, 12)}`,
      name: data.name,
      type: data.type || "individual",
      identityNumber: data.identityNumber || null,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      contactPerson: data.contactPerson || null,
      notes: data.notes || null,
      status: data.status || "active",
      createdAt: new Date().toISOString(),
      officeId,
      deletedAt: null,
    };

    all.unshift(newClient);
    await saveOfficeCollection("clients", officeId, all);
    return newClient;
  });
}

export async function updateClient(
  id: string,
  officeId: string,
  data: Partial<Client>,
): Promise<Client | null> {
  return withSheetLock(`clients:${officeId}`, async () => {
    const all = await loadOfficeCollection<Client>("clients", officeId);
    const idx = all.findIndex((c) => c.id === id && c.officeId === officeId && !c.deletedAt);
    if (idx === -1) return null;

    const { id: _ignoreId, officeId: _ignoreOffice, createdAt: _ignoreCreated, ...safePatch } = data;
    all[idx] = {
      ...all[idx],
      ...safePatch,
      id: all[idx].id,
      officeId,
      updatedAt: new Date().toISOString(),
    };

    await saveOfficeCollection("clients", officeId, all);
    return all[idx];
  });
}

export async function deleteClient(
  id: string,
  officeId: string,
  deletedBy?: string,
): Promise<boolean> {
  return withSheetLock(`clients:${officeId}`, async () => {
    const all = await loadOfficeCollection<Client>("clients", officeId);
    const idx = all.findIndex((c) => c.id === id && c.officeId === officeId && !c.deletedAt);
    if (idx === -1) return false;

    all[idx] = {
      ...all[idx],
      deletedAt: new Date().toISOString(),
      deletedBy: deletedBy || null,
      updatedAt: new Date().toISOString(),
    };
    await saveOfficeCollection("clients", officeId, all);
    return true;
  });
}

export async function restoreClient(id: string, officeId: string): Promise<boolean> {
  return withSheetLock(`clients:${officeId}`, async () => {
    const all = await loadOfficeCollection<Client>("clients", officeId);
    const idx = all.findIndex(
      (c) => c.id === id && c.officeId === officeId && Boolean(c.deletedAt),
    );
    if (idx === -1) return false;

    all[idx] = {
      ...all[idx],
      deletedAt: null,
      deletedBy: null,
      updatedAt: new Date().toISOString(),
    };
    await saveOfficeCollection("clients", officeId, all);
    return true;
  });
}

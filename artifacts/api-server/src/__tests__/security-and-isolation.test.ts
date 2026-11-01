import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { signSessionToken, verifySessionToken, SESSION_COOKIE_NAME } from "../middlewares/auth.middleware";
import { computeSessionFingerprint, type AppUser } from "../services/supabase.service";
import {
  inspectCourtDate,
  normalizeNumericDigits,
  validatePasswordStrength,
} from "../utils/dateNormalize";
import {
  createNewRowMeta,
  parseRowMeta,
  serializeRowMeta,
  isRowOwnedByOffice,
  withSheetLock,
} from "../utils/sheetMeta";
import {
  createClient,
  listClients,
  deleteClient,
  restoreClient,
} from "../services/clients.service";
import app from "../app";

function buildMockUser(overrides: Partial<AppUser> = {}): AppUser {
  const id = overrides.id || "user-qa-1";
  const role = overrides.role || "staff";
  const status = overrides.status || "active";
  const sessionVersion = overrides.session_version ?? 1;
  const fp =
    overrides.session_fingerprint ||
    computeSessionFingerprint({
      id,
      role,
      status,
      password_hash: "$2a$10$mockhash",
      session_version: sessionVersion,
    });

  return {
    id,
    username: overrides.username || "lawyer_qa",
    role,
    office_id: overrides.office_id || `office-${id}`,
    office_role: overrides.office_role || "office_manager",
    status,
    session_version: sessionVersion,
    session_fingerprint: fp,
    ...overrides,
  };
}

test("1. Session Security: signs HMAC tokens and strictly rejects unsigned or tampered cookies", () => {
  const user = buildMockUser();
  const token = signSessionToken(user);
  assert.ok(token.includes("."), "Token must contain payload and HMAC signature");

  const verified = verifySessionToken(token);
  assert.ok(verified, "Valid signed token must verify");
  assert.equal(verified.uid, user.id);
  assert.equal(verified.fp, user.session_fingerprint);

  // Reject unsigned JSON cookie (forged role escalation attempt)
  assert.equal(
    verifySessionToken(JSON.stringify({ username: "admin", role: "admin" })),
    null,
    "Unsigned JSON cookie must be rejected",
  );

  // Reject tampered payload with original signature
  const [, sig] = token.split(".");
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...verified, uid: "admin-id" }),
    "utf8",
  ).toString("base64url");
  assert.equal(
    verifySessionToken(`${tamperedPayload}.${sig}`),
    null,
    "Tampered payload must fail HMAC check",
  );
});

test("2. Instant Session Revocation: changing role, status, password hash, or session_version invalidates fingerprint", () => {
  const baseFp = computeSessionFingerprint({
    id: "u-1",
    role: "admin",
    status: "active",
    password_hash: "hash-v1",
    session_version: 1,
  });

  const demotedFp = computeSessionFingerprint({
    id: "u-1",
    role: "staff",
    status: "active",
    password_hash: "hash-v1",
    session_version: 1,
  });
  const suspendedFp = computeSessionFingerprint({
    id: "u-1",
    role: "admin",
    status: "suspended",
    password_hash: "hash-v1",
    session_version: 1,
  });
  const newPasswordFp = computeSessionFingerprint({
    id: "u-1",
    role: "admin",
    status: "active",
    password_hash: "hash-v2",
    session_version: 1,
  });
  const bumpedVersionFp = computeSessionFingerprint({
    id: "u-1",
    role: "admin",
    status: "active",
    password_hash: "hash-v1",
    session_version: 2,
  });

  assert.notEqual(baseFp, demotedFp);
  assert.notEqual(baseFp, suspendedFp);
  assert.notEqual(baseFp, newPasswordFp);
  assert.notEqual(baseFp, bumpedVersionFp);
});

test("3. Unified Password Policy & Arabic Date Normalization", () => {
  assert.equal(validatePasswordStrength("1234").valid, false, "4-char password must be rejected");
  assert.equal(validatePasswordStrength("123456").valid, false, "6-char password must be rejected");
  assert.equal(validatePasswordStrength("12345678").valid, false, "Digits-only password must be rejected");
  assert.equal(validatePasswordStrength("abcdefgh").valid, false, "Letters-only password must be rejected");
  assert.equal(validatePasswordStrength("Lawyer2026").valid, true, "8+ chars with letters & digits must pass");

  assert.equal(normalizeNumericDigits("١٥/٠٢/١٤٤٨"), "15/02/1448");
  const hijriCheck = inspectCourtDate("١٥/٠٢/١٤٤٨ هـ", { preferredCalendar: "hijri", required: true });
  assert.equal(hijriCheck.valid, true);
  assert.equal(hijriCheck.normalized, "15/02/1448");

  const invalidText = inspectCourtDate("غداً صباحاً", { required: true });
  assert.equal(invalidText.valid, false);
});

test("4. Stable Record IDs, Office Ownership Isolation, and Serialized Concurrent Writes", async () => {
  const metaA = createNewRowMeta("office-alpha", "lawyerA");
  const serialized = serializeRowMeta(metaA);

  // Even if row shifts in Google Sheets, parsed ID stays identical to metaA.id!
  const parsedAfterShift = parseRowMeta(serialized, "different-row-seed", "office-alpha");
  assert.equal(parsedAfterShift.id, metaA.id);
  assert.equal(parsedAfterShift.recordId, metaA.recordId);

  assert.equal(isRowOwnedByOffice(parsedAfterShift, "office-alpha", false), true);
  assert.equal(isRowOwnedByOffice(parsedAfterShift, "office-beta", false), false);

  // Verify withSheetLock prevents interleaved read-then-write races
  const executionOrder: string[] = [];
  let sharedCounter = 0;
  await Promise.all([
    withSheetLock("sheet-race-test", async () => {
      const current = sharedCounter;
      executionOrder.push("start-1");
      await new Promise((r) => setTimeout(r, 25));
      sharedCounter = current + 1;
      executionOrder.push("end-1");
    }),
    withSheetLock("sheet-race-test", async () => {
      const current = sharedCounter;
      executionOrder.push("start-2");
      sharedCounter = current + 1;
      executionOrder.push("end-2");
    }),
  ]);

  assert.equal(sharedCounter, 2, "Serialized writes must not overwrite the same slot");
  assert.deepEqual(executionOrder, ["start-1", "end-1", "start-2", "end-2"]);
});

test("5. Multi-Tenant Data Isolation + Soft-Delete & Restore", async () => {
  const suffix = Date.now().toString(36);
  const officeA = `qa-test-office-a-${suffix}`;
  const officeB = `qa-test-office-b-${suffix}`;

  const createdInA = await createClient({
    officeId: officeA,
    name: "شركة الاختبار المعزولة أ",
    type: "company",
  });

  const listA = await listClients(officeA);
  const listB = await listClients(officeB);

  assert.equal(listA.some((c) => c.id === createdInA.id), true, "Office A sees its own client");
  assert.equal(listB.some((c) => c.id === createdInA.id), false, "Office B cannot see Office A client");

  // Office B cannot delete Office A's client
  const crossDelete = await deleteClient(createdInA.id, officeB, "attacker");
  assert.equal(crossDelete, false, "Cross-office delete must be blocked");

  // Office A soft-deletes and restores its own client
  const ownDelete = await deleteClient(createdInA.id, officeA, "managerA");
  assert.equal(ownDelete, true);
  assert.equal((await listClients(officeA, false)).some((c) => c.id === createdInA.id), false);
  assert.equal((await listClients(officeA, true)).some((c) => c.id === createdInA.id && Boolean(c.deletedAt)), true);

  const restored = await restoreClient(createdInA.id, officeA);
  assert.equal(restored, true);
  assert.equal((await listClients(officeA, false)).some((c) => c.id === createdInA.id), true);
});

test("6. HTTP API Guardrails: blocks unauthenticated & forged-cookie requests across protected endpoints", async () => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const protectedEndpoints = [
      "/api/sessions",
      "/api/poa",
      "/api/tasks",
      "/api/judgments",
      "/api/cases",
      "/api/clients",
      "/api/audit/logs",
      "/api/users",
    ];

    for (const ep of protectedEndpoints) {
      const res = await fetch(`${baseUrl}${ep}`, {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent('{"username":"admin","role":"admin"}')}; court_session=admin`,
        },
      });
      assert.equal(
        res.status,
        401,
        `Endpoint ${ep} must reject forged unsigned cookies with 401 (got ${res.status})`,
      );
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});


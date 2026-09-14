/**
 * StakSuite Cloud Functions — membership authority (project: stak-suite)
 *
 * Callables:
 *   bootstrapCompanyOwner  — owner membership (companyId must match auth email id)
 *   provisionStaffMembership — supervisor provisions staff by email
 *   setMembershipActive — supervisor activate/deactivate
 *   fbVerifyMembership — server-side membership check (optional; client also has local read)
 *
 * Membership path: stak_memberships/{AUTH_UID}  (never email as document id)
 * Clients must not write stak_memberships (Firestore rules).
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** Same rule as frontend stockCompanyIdFromEmail (max 48). */
function companyIdFromEmail(email) {
  return (
    String(email || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 48) || ""
  );
}

const ALLOWED_APPS = new Set(["stockstak", "sweetstak"]);
const ALLOWED_ROLES = new Set([
  "supervisor",
  "staff",
  "branch_supervisor",
  "owner",
  "chef",
]);

async function readMembership(uid) {
  const snap = await db.collection("stak_memberships").doc(String(uid)).get();
  return snap.exists ? { id: snap.id, data: snap.data() || {} } : null;
}

function isActiveSupervisorOf(memData, companyId, app) {
  if (!memData || !memData.apps || !memData.apps[app]) return false;
  const e = memData.apps[app];
  if (!e || String(e.companyId) !== String(companyId)) return false;
  if (e.active === false || e.active === 0) return false;
  const role = String(e.role || "").toLowerCase();
  return (
    role === "supervisor" ||
    role === "owner" ||
    role === "branch_supervisor"
  );
}

async function writeAdminAudit(payload) {
  try {
    await db.collection("stak_audit_admin").add({
      ...payload,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    functions.logger.warn("audit write failed", e.message);
  }
}

/**
 * Server membership verification.
 * UID always from context.auth — never from client body.
 */
async function verifyMembershipCore(context, data) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "AUTH_REQUIRED");
  }
  const uid = context.auth.uid;
  const app = String((data && data.app) || "stockstak").toLowerCase();
  const expectedCompanyId =
    data && data.companyId ? String(data.companyId) : "";
  if (!ALLOWED_APPS.has(app)) {
    throw new functions.https.HttpsError("invalid-argument", "INVALID_APP");
  }
  const rec = await readMembership(uid);
  if (!rec) {
    return { ok: false, reason: "not-provisioned", uid };
  }
  const entry = rec.data.apps && rec.data.apps[app];
  if (!entry || !entry.companyId) {
    return { ok: false, reason: "no-app-membership", uid };
  }
  if (entry.active === false || entry.active === 0) {
    return {
      ok: false,
      reason: "inactive",
      uid,
      companyId: entry.companyId,
      role: entry.role,
    };
  }
  if (expectedCompanyId && String(entry.companyId) !== expectedCompanyId) {
    return {
      ok: false,
      reason: "company-mismatch",
      uid,
      companyId: entry.companyId,
      expected: expectedCompanyId,
    };
  }
  return {
    ok: true,
    uid,
    companyId: String(entry.companyId),
    role: entry.role || "staff",
    branchId: entry.branchId || "",
    active: entry.active !== false,
    app,
  };
}

exports.fbVerifyMembership = functions.https.onCall(async (data, context) => {
  return verifyMembershipCore(context, data || {});
});

/** Alias used by some clients */
exports.verifyMembership = functions.https.onCall(async (data, context) => {
  return verifyMembershipCore(context, data || {});
});

/**
 * Owner bootstrap: create apps.stockstak membership for authenticated user.
 * companyId MUST equal companyIdFromEmail(auth.email).
 */
exports.bootstrapCompanyOwner = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "AUTH_REQUIRED");
  }
  const uid = context.auth.uid;
  const email = (context.auth.token && context.auth.token.email) || "";
  const app = String((data && data.app) || "stockstak").toLowerCase();
  if (!ALLOWED_APPS.has(app)) {
    throw new functions.https.HttpsError("invalid-argument", "INVALID_APP");
  }
  const expectedId = companyIdFromEmail(email);
  if (!expectedId) {
    throw new functions.https.HttpsError("failed-precondition", "EMAIL_REQUIRED");
  }
  const companyId = String((data && data.companyId) || expectedId);
  if (companyId !== expectedId) {
    functions.logger.warn("bootstrap blocked companyId injection", {
      uid,
      companyId,
      expectedId,
    });
    throw new functions.https.HttpsError("permission-denied", "UNAUTHORIZED");
  }

  const existing = await readMembership(uid);
  if (
    existing &&
    existing.data.apps &&
    existing.data.apps[app] &&
    existing.data.apps[app].companyId
  ) {
    const e = existing.data.apps[app];
    return {
      ok: true,
      alreadyProvisioned: true,
      uid,
      companyId: e.companyId,
      role: e.role || "supervisor",
      branchId: e.branchId || "",
      active: e.active !== false,
      app,
    };
  }

  const entry = {
    companyId,
    role: "supervisor",
    branchId: String((data && data.branchId) || ""),
    active: true,
    app,
  };
  const apps = Object.assign({}, (existing && existing.data.apps) || {}, {
    [app]: entry,
  });
  await db.collection("stak_memberships").doc(uid).set(
    {
      uid,
      email: email || null,
      apps,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      provisionedBy: "bootstrapCompanyOwner",
    },
    { merge: true }
  );
  await writeAdminAudit({
    action: "MEMBERSHIP_PROVISIONED",
    type: "bootstrap_owner",
    targetUid: uid,
    companyId,
    role: "supervisor",
    branchId: entry.branchId,
    app,
    byUid: uid,
  });
  functions.logger.info("bootstrapCompanyOwner ok", { uid, companyId, app });
  return {
    ok: true,
    alreadyProvisioned: false,
    uid,
    companyId,
    role: "supervisor",
    branchId: entry.branchId,
    active: true,
    app,
  };
});

exports.provisionStaffMembership = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "AUTH_REQUIRED");
  }
  const callerUid = context.auth.uid;
  const app = String((data && data.app) || "stockstak").toLowerCase();
  const role = String((data && data.role) || "staff").toLowerCase();
  const branchId = String((data && data.branchId) || "");
  const targetEmail = String((data && data.email) || "")
    .trim()
    .toLowerCase();
  if (!ALLOWED_APPS.has(app)) {
    throw new functions.https.HttpsError("invalid-argument", "INVALID_APP");
  }
  if (!ALLOWED_ROLES.has(role)) {
    throw new functions.https.HttpsError("invalid-argument", "INVALID_ROLE");
  }
  if (!targetEmail || targetEmail.indexOf("@") < 1) {
    throw new functions.https.HttpsError("invalid-argument", "INVALID_EMAIL");
  }

  const callerRec = await readMembership(callerUid);
  const callerData = callerRec && callerRec.data;
  let companyId = String((data && data.companyId) || "");
  if (!companyId && callerData && callerData.apps && callerData.apps[app]) {
    companyId = String(callerData.apps[app].companyId || "");
  }
  if (!companyId) {
    throw new functions.https.HttpsError("failed-precondition", "COMPANY_REQUIRED");
  }
  if (!isActiveSupervisorOf(callerData, companyId, app)) {
    throw new functions.https.HttpsError("permission-denied", "UNAUTHORIZED");
  }

  let targetUser;
  try {
    targetUser = await admin.auth().getUserByEmail(targetEmail);
  } catch (e) {
    throw new functions.https.HttpsError("not-found", "NOT_FOUND");
  }
  const targetUid = targetUser.uid;
  const existing = await readMembership(targetUid);
  if (
    existing &&
    existing.data.apps &&
    existing.data.apps[app] &&
    existing.data.apps[app].companyId &&
    String(existing.data.apps[app].companyId) !== companyId
  ) {
    throw new functions.https.HttpsError("permission-denied", "MISMATCH");
  }

  const entry = { companyId, role, branchId, active: true, app };
  const apps = Object.assign({}, (existing && existing.data.apps) || {}, {
    [app]: entry,
  });
  await db.collection("stak_memberships").doc(targetUid).set(
    {
      uid: targetUid,
      email: targetEmail,
      apps,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      provisionedBy: callerUid,
    },
    { merge: true }
  );
  await writeAdminAudit({
    action: "MEMBERSHIP_PROVISIONED",
    type: "staff",
    targetUid,
    targetEmail,
    companyId,
    branchId,
    role,
    app,
    byUid: callerUid,
  });
  return {
    ok: true,
    uid: targetUid,
    companyId,
    role,
    branchId,
    active: true,
    app,
  };
});

exports.setMembershipActive = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "AUTH_REQUIRED");
  }
  const callerUid = context.auth.uid;
  const app = String((data && data.app) || "stockstak").toLowerCase();
  const targetUid = String((data && data.targetUid) || "");
  const active = !!(data && data.active);
  if (!targetUid || !ALLOWED_APPS.has(app)) {
    throw new functions.https.HttpsError("invalid-argument", "INVALID_ARGUMENT");
  }
  const callerRec = await readMembership(callerUid);
  const callerData = callerRec && callerRec.data;
  const companyId =
    callerData && callerData.apps && callerData.apps[app]
      ? String(callerData.apps[app].companyId || "")
      : "";
  if (!isActiveSupervisorOf(callerData, companyId, app)) {
    throw new functions.https.HttpsError("permission-denied", "UNAUTHORIZED");
  }
  const existing = await readMembership(targetUid);
  if (!existing || !existing.data.apps || !existing.data.apps[app]) {
    throw new functions.https.HttpsError("not-found", "NOT_FOUND");
  }
  if (String(existing.data.apps[app].companyId) !== companyId) {
    throw new functions.https.HttpsError("permission-denied", "MISMATCH");
  }
  existing.data.apps[app].active = active;
  await db.collection("stak_memberships").doc(targetUid).set(
    {
      apps: existing.data.apps,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await writeAdminAudit({
    action: active ? "MEMBERSHIP_ACTIVATED" : "MEMBERSHIP_DEACTIVATED",
    targetUid,
    companyId,
    app,
    byUid: callerUid,
  });
  return { ok: true, targetUid, active, app, companyId };
});

exports._test = {
  companyIdFromEmail,
  isActiveSupervisorOf,
  ALLOWED_ROLES,
  ALLOWED_APPS,
};

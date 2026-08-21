// firebase-init.js
const firebaseConfig = {
  apiKey: "AIzaSyDcXQP5bqH6hZwDVRkpeB7PJfBYRqwhsAA",
  authDomain: "ganesh-agri-new.firebaseapp.com",
  projectId: "ganesh-agri-new",
  storageBucket: "ganesh-agri-new.firebasestorage.app",
  messagingSenderId: "929079364229",
  appId: "1:929079364229:web:4d258a51db7feff95337ec",
  measurementId: "G-4ZSXCGNRF7",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const billsCollection = db.collection("bills");
const OWNER_EMAIL = "rohanvasoya2013@gmail.com";

let globalSettings = {};
let unsubscribeUserAccess = null;
let idleSessionTimer = null;
const IDLE_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
window.currentUserProfile = null;

db.enablePersistence().catch((err) => {
  if (err.code !== "failed-precondition" && err.code !== "unimplemented") {
    console.warn("Offline persistence could not be enabled:", err);
  }
});

function normaliseEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isOwner(user) {
  return normaliseEmail(user && user.email) === OWNER_EMAIL;
}

function signInMetadata(user) {
  const providerIds = (user.providerData || []).map((provider) => provider.providerId).filter(Boolean);
  const fields = {
    providerIds,
    lastSignInAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  // Backfill email whenever this sign-in actually supplies one (e.g. a
  // phone-first account later links Google) — omitted (not blanked) when
  // this particular sign-in has none, so an already-saved email is never
  // overwritten with an empty string on a later phone-only login.
  if (user.email) {
    fields.email = normaliseEmail(user.email);
    // So Admin (Staff Access page) can see whether this email was ever
    // actually confirmed by the owner (via Firebase's verification link
    // in my-profile.html) rather than just typed in.
    fields.emailVerified = !!user.emailVerified;
  }
  return fields;
}

function newProfileFields(user) {
  return {
    email: normaliseEmail(user.email),
    displayName: user.displayName || "",
    mobileNumber: user.phoneNumber || "",
    mobileKey: String(user.phoneNumber || "").replace(/\D/g, ""),
    ...signInMetadata(user),
  };
}

function redirectTo(path) {
  const current = window.location.pathname.split("/").pop() || "index.html";
  if (current !== path) window.location.replace(path);
}

function stopIdleSessionTimer() {
  if (idleSessionTimer) clearTimeout(idleSessionTimer);
  idleSessionTimer = null;
}

function startIdleSessionTimer() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const isPublicSharedBill =
    currentPage === "download.html" && new URLSearchParams(window.location.search).has("share");
  if (currentPage === "login.html" || currentPage === "access-pending.html" || isPublicSharedBill) return;
  stopIdleSessionTimer();
  idleSessionTimer = setTimeout(async () => {
    try {
      await firebase.auth().signOut();
    } finally {
      if (window.Swal)
        Swal.fire({
          icon: "info",
          title: "Session expired",
          text: "30 minutes inactivity ke baad security ke liye logout kar diya gaya.",
        });
      else alert("Session expired. Please login again.");
    }
  }, IDLE_SESSION_TIMEOUT_MS);
}

["pointerdown", "keydown", "touchstart", "scroll"].forEach((eventName) => {
  window.addEventListener(
    eventName,
    () => {
      if (window.currentUserProfile) startIdleSessionTimer();
    },
    { passive: eventName !== "keydown" }
  );
});

async function ensureUserProfile(user) {
  const profileRef = db.collection("users").doc(user.uid);
  const profile = await profileRef.get();
  if (profile.exists) {
    // The owner is the recovery path for a mistaken approval change. This is
    // intentionally limited by the matching Firestore-rule owner-email check.
    if (isOwner(user) && (profile.data().role !== "admin" || profile.data().status !== "active")) {
      await profileRef.set(
        { role: "admin", status: "active", updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    // Keep the staff directory current after every successful Firebase sign-in.
    // Google supplies name/email, while a phone-linked provider may supply mobile.
    // This is NOT awaited: it's background housekeeping (lastSignInAt,
    // providerIds, email backfill) that the page doesn't need to wait on.
    // Previously this blocked here before the onSnapshot listener below was
    // even set up — meaning every page load waited on this extra Firestore
    // round trip before the navbar could render its real (role-based)
    // links. onSnapshot() below still gives us the freshest profile data
    // regardless of whether this write has landed yet.
    profileRef.set(signInMetadata(user), { merge: true }).catch((e) => {
      console.warn("Sign-in metadata update failed (non-critical):", e);
    });
    return;
  }

  const now = firebase.firestore.FieldValue.serverTimestamp();
  const authFields = newProfileFields(user);
  if (isOwner(user)) {
    // Firestore rules permit this one-time owner bootstrap only for the
    // configured owner email and their own UID.
    await profileRef.set({
      ...authFields,
      displayName: user.displayName || "Owner",
      role: "admin",
      status: "active",
      companyId: "ganesh-agri",
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  // A new account can create only its own pending, read-only request.
  // It cannot assign itself a privileged role.
  await profileRef.set({
    ...authFields,
    role: "viewer",
    status: "pending",
    companyId: "ganesh-agri",
    createdAt: now,
    updatedAt: now,
  });
}

function applyAccessProfile(user, profile) {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const isLoginPage = currentPage === "login.html";
  const isPendingPage = currentPage === "access-pending.html";
  const active = profile && profile.status === "active";

  window.currentUserProfile = active ? { ...profile, uid: user.uid } : null;
  window.dispatchEvent(new CustomEvent("mandibook:access-ready", { detail: window.currentUserProfile }));

  if (!active) {
    stopIdleSessionTimer();
    if (!isPendingPage) redirectTo("access-pending.html");
    return;
  }

  startIdleSessionTimer();

  if (isLoginPage || isPendingPage) redirectTo("index.html");
}

firebase.auth().onAuthStateChanged(async (user) => {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const isLoginPage = currentPage === "login.html";
  const isPendingPage = currentPage === "access-pending.html";
  const isPublicSharedBill =
    currentPage === "download.html" && new URLSearchParams(window.location.search).has("share");

  if (unsubscribeUserAccess) {
    unsubscribeUserAccess();
    unsubscribeUserAccess = null;
  }

  if (!user) {
    window.currentUserProfile = null;
    stopIdleSessionTimer();
    if (!isLoginPage && !isPublicSharedBill) redirectTo("login.html");
    return;
  }

  if (isPublicSharedBill) return;

  try {
    await ensureUserProfile(user);
    unsubscribeUserAccess = db
      .collection("users")
      .doc(user.uid)
      .onSnapshot(
        (snapshot) => applyAccessProfile(user, snapshot.exists ? snapshot.data() : null),
        (error) => {
          console.error("Could not verify staff access:", error);
          if (!isLoginPage && !isPendingPage) redirectTo("access-pending.html");
        }
      );
  } catch (error) {
    console.error("Could not create or verify staff profile:", error);
    if (!isLoginPage && !isPendingPage) redirectTo("access-pending.html");
  }
});

function hasRole(...roles) {
  return !!window.currentUserProfile && roles.includes(window.currentUserProfile.role);
}

/**
 * Appends a traceable, immutable audit event.  The matching Firestore rule
 * permits creates only, prevents later alteration/removal, and binds the
 * recorded actor UID to the authenticated Firebase user.
 */
async function recordAudit(action, entityType, entityId, { before = null, after = null, reason = "" } = {}) {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error("Cannot create an audit entry without an authenticated user.");
  await db.collection("auditLogs").add({
    action,
    entityType,
    entityId,
    before,
    after,
    reason: String(reason || ""),
    actor: {
      uid: user.uid,
      email: normaliseEmail(user.email),
      role: (window.currentUserProfile && window.currentUserProfile.role) || "unknown",
    },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

function billAuditSnapshot(bill) {
  if (!bill) return null;
  return {
    serialNo: bill["Serial No"] || "",
    date: bill.Date || "",
    customerName: bill["Customer Name"] || bill.customerName || "",
    customerId: bill.customerId || "",
    finalTotal: Number(bill["Final Total"] || 0),
    amountPaid: Number(bill.amountPaid || 0),
    amountDue: Number(bill.amountDue || 0),
    paymentStatus: bill.paymentStatus || "Unpaid",
    deleted: bill.deleted === true,
  };
}

window.recordAudit = recordAudit;
window.billAuditSnapshot = billAuditSnapshot;

function logoutUser() {
  firebase
    .auth()
    .signOut()
    .then(() => redirectTo("login.html"))
    .catch((error) => console.error("Logout error:", error));
}

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
window.currentUserProfile = null;

db.enablePersistence().catch((err) => {
  if (err.code !== "failed-precondition" && err.code !== "unimplemented") {
    console.warn("Offline persistence could not be enabled:", err);
  }
});

function normaliseEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isOwner(user) {
  return normaliseEmail(user && user.email) === OWNER_EMAIL;
}

function redirectTo(path) {
  const current = window.location.pathname.split("/").pop() || "index.html";
  if (current !== path) window.location.replace(path);
}

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
    return;
  }

  const now = firebase.firestore.FieldValue.serverTimestamp();
  if (isOwner(user)) {
    // Firestore rules permit this one-time owner bootstrap only for the
    // configured owner email and their own UID.
    await profileRef.set({
      email: normaliseEmail(user.email),
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
    email: normaliseEmail(user.email),
    displayName: user.displayName || "",
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
    if (!isPendingPage) redirectTo("access-pending.html");
    return;
  }

  if (isLoginPage || isPendingPage) redirectTo("index.html");
}

firebase.auth().onAuthStateChanged(async (user) => {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const isLoginPage = currentPage === "login.html";
  const isPendingPage = currentPage === "access-pending.html";
  const isPublicSharedBill = currentPage === "download.html" && new URLSearchParams(window.location.search).has("share");

  if (unsubscribeUserAccess) {
    unsubscribeUserAccess();
    unsubscribeUserAccess = null;
  }

  if (!user) {
    window.currentUserProfile = null;
    if (!isLoginPage && !isPublicSharedBill) redirectTo("login.html");
    return;
  }

  if (isPublicSharedBill) return;

  try {
    await ensureUserProfile(user);
    unsubscribeUserAccess = db.collection("users").doc(user.uid).onSnapshot(
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
  firebase.auth().signOut().then(() => redirectTo("login.html")).catch((error) => console.error("Logout error:", error));
}

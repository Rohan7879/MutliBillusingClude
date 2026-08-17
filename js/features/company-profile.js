/**
 * @file company-profile.js
 * @description Company profile - load/save from Firestore
 * Used by bill-view (WhatsApp, print header) and settings page
 */

const companyRef = db.collection("settings").doc("companyProfile");

// Default values
window.companyProfile = {
  name:       "",
  ownerName:  "",
  address:    "",
  city:       "",
  phone:      "",
  gst:        "",
  appUrl:     "https://ganesh-agri-new.web.app",
  showOnBill: {
    name: true, ownerName: false,
    address: false, phone: true, gst: false
  },
  whatsapp: {
    showProduct: true, showBroker: true,
    showVakalDetails: true, showNetWeight: true,
    showRemarks: true
  }
};

async function loadCompanyProfile() {
  try {
    const doc = await companyRef.get();
    if (doc.exists) {
      window.companyProfile = { ...window.companyProfile, ...doc.data() };
    }
  } catch(e) {
    console.warn("Company profile load failed:", e);
  }
  return window.companyProfile;
}

async function saveCompanyProfile(data) {
  window.companyProfile = { ...window.companyProfile, ...data };
  await companyRef.set(window.companyProfile);
}

function generateSecureDownloadUrl(billId) {
  const base  = window.companyProfile.appUrl || "https://ganesh-agri-new.web.app";
  return `${base.replace(/\/$/, "")}/download.html?id=${encodeURIComponent(billId)}`;
}

async function createPublicBillShare(billId, billData) {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  const expiresAt = firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  let printPolicy = "allow_draft";
  let itemLabelMode = "vakal";
  try {
    const workflowDoc = await db.collection("settings").doc("billWorkflow").get();
    if (workflowDoc.exists) {
      if (workflowDoc.data().printPolicy === "approved_only") printPolicy = "approved_only";
      if (workflowDoc.data().itemLabelMode === "variety") itemLabelMode = "variety";
    }
  } catch (error) {
    console.warn("Could not read print policy for shared bill; using current behavior.", error);
  }
  await db.collection("sharedBills").doc(token).set({
    billId,
    bill: billData,
    printPolicy,
    itemLabelMode,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });
  if (typeof recordAudit === "function") {
    try {
      await recordAudit("bill.shared", "bill", billId, {
        after: {
          serialNo: billData["Serial No"] || "",
          expiresAt: expiresAt.toDate().toISOString(),
          delivery: "secure_download_link",
        },
        reason: "Secure bill share link created",
      });
    } catch (error) {
      console.warn("Share-link audit could not be recorded.", error);
    }
  }
  const base = (window.companyProfile.appUrl || "https://ganesh-agri-new.web.app").replace(/\/$/, "");
  return `${base}/download.html?share=${token}`;
}

window.loadCompanyProfile        = loadCompanyProfile;
window.saveCompanyProfile        = saveCompanyProfile;
window.generateSecureDownloadUrl = generateSecureDownloadUrl;
window.createPublicBillShare = createPublicBillShare;

// Auto-load on every page
document.addEventListener("DOMContentLoaded", () => loadCompanyProfile());

// ── Settings page functions ──
async function loadCompanyProfileIntoForm() {
  const p = await loadCompanyProfile();
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ""; };
  const chk = (id, val) => { const el = document.getElementById(id); if(el) el.checked = !!val; };
  set("cp-name",    p.name);
  set("cp-owner",   p.ownerName);
  set("cp-address", p.address);
  set("cp-phone",   p.phone);
  set("cp-gst",     p.gst);
  set("cp-url",     p.appUrl);
  chk("cp-show-name",    p.showOnBill?.name);
  chk("cp-show-owner",   p.showOnBill?.ownerName);
  chk("cp-show-address", p.showOnBill?.address);
  chk("cp-show-phone",   p.showOnBill?.phone);
  chk("cp-show-gst",     p.showOnBill?.gst);
}

async function saveCompanyProfileFromForm() {
  const get = id => document.getElementById(id)?.value?.trim() || "";
  const chk = id => document.getElementById(id)?.checked || false;
  const data = {
    name: get("cp-name"), ownerName: get("cp-owner"),
    address: get("cp-address"), phone: get("cp-phone"),
    gst: get("cp-gst"), appUrl: get("cp-url"),
    showOnBill: {
      name: chk("cp-show-name"), ownerName: chk("cp-show-owner"),
      address: chk("cp-show-address"), phone: chk("cp-show-phone"),
      gst: chk("cp-show-gst")
    }
  };
  try {
    await saveCompanyProfile(data);
    Swal.fire({ icon:"success", title:"✅ Saved!", toast:true, position:"top-end", showConfirmButton:false, timer:2000 });
  } catch(e) {
    Swal.fire({ icon:"error", title:"Error saving!", toast:true, position:"top-end", showConfirmButton:false, timer:2000 });
  }
}

window.saveCompanyProfileFromForm  = saveCompanyProfileFromForm;
window.loadCompanyProfileIntoForm  = loadCompanyProfileIntoForm;

// Auto-fill form if on settings page
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("cp-name")) loadCompanyProfileIntoForm();
});

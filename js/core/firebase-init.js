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

// 1️⃣ Sabse pehle Firebase ko Initialize (Start) karo!
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const billsCollection = db.collection("bills");

let globalSettings = {};

db.enablePersistence().catch((err) => {
  if (err.code == "failed-precondition") {
    // Multiple tabs open, persistence can only be enabled in one.
  } else if (err.code == "unimplemented") {
    // The current browser does not support all of the features required to enable persistence
  }
});

// 2️⃣ Ab Security Guard aur baki cheezein lagao
firebase.auth().onAuthStateChanged((user) => {
  const currentPage = window.location.pathname;
  const isLoginPage = currentPage.includes("login.html");

  if (!user) {
    if (!isLoginPage) {
      window.location.href = "login.html";
    }
  } else {
    if (isLoginPage) {
      window.location.href = "index.html";
    }
  }
});

function logoutUser() {
  firebase
    .auth()
    .signOut()
    .then(() => {
      window.location.href = "login.html";
    })
    .catch((error) => {
      console.error("Logout error: ", error);
    });
}

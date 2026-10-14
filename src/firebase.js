
import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCKifpkxRT0h6ldS_56LoltWwxoMev88pE",
  authDomain: "carequeue-1b7ee.firebaseapp.com",
  projectId: "carequeue-1b7ee",
  storageBucket: "carequeue-1b7ee.firebasestorage.app",
  messagingSenderId: "629039258198",
  appId: "1:629039258198:web:5954c29111c8346bd5f9f7",
};

// Main Firebase instance for staff
const app = getApps().some((item) => item.name === "[DEFAULT]")
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Separate Firebase instance for patients
const patientApp = getApps().some(
  (item) => item.name === "patientApp"
)
  ? getApp("patientApp")
  : initializeApp(firebaseConfig, "patientApp");

export const patientAuth = getAuth(patientApp);
export const patientDb = getFirestore(patientApp);
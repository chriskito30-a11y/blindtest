import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  get,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

// À compléter avec la configuration Web de TON projet Firebase.
// Ne laisse pas une vraie clé API non restreinte dans un dépôt public.
// Dans Google Cloud Console, restreins la clé au domaine GitHub Pages ou au domaine final.
const firebaseConfig = {
  apiKey: "VOTRE_CLE_FIREBASE_WEB",
  authDomain: "VOTRE_PROJET.firebaseapp.com",
  databaseURL: "https://VOTRE_PROJET-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "VOTRE_PROJET",
  storageBucket: "VOTRE_PROJET.firebasestorage.app",
  messagingSenderId: "VOTRE_MESSAGING_SENDER_ID",
  appId: "VOTRE_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export {
  db,
  ref,
  set,
  update,
  onValue,
  get,
  remove
};

import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const auth = getAuth(app);
const logoutBtn = document.getElementById("modulysTopbarLogoutBtn");

if (logoutBtn) {
  logoutBtn.hidden = true;
  onAuthStateChanged(auth, (user) => {
    logoutBtn.hidden = !user || user.isAnonymous;
  });
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "https://www.modulys.top/mes-modules.html";
  });
}

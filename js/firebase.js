/* Firebase - Ferretería Machaquila */
const firebaseConfig = {
  apiKey: "AIzaSyA7p0tDYuI4v-f41sezRB4SgTF1UkGsT4c",
  authDomain: "sistema-montana.firebaseapp.com",
  projectId: "sistema-montana",
  storageBucket: "sistema-montana.firebasestorage.app",
  messagingSenderId: "231745413711",
  appId: "1:231745413711:web:ca5b72d873624edbf1403a"
};

const COL = {
  productos: "productos",
  ventas: "ventas",
  tickets: "tickets",
  clientes: "clientes",
  cotizaciones: "cotizaciones",
  caja: "caja",
  gastos: "gastos",
  movimientosCaja: "movimientosCaja",
  config: "config",
  usuarios: "usuarios"
};

const ROLES = {
  ADMIN: "admin",
  EMPLEADO: "empleado"
};

/** Secciones permitidas por rol (protección de vistas) */
const SECCIONES_POR_ROL = {
  admin: ["dashboard", "contable", "ventas", "inventario", "clientes", "cotizaciones", "caja"],
  empleado: ["ventas", "caja"]
};

let db = null;
let auth = null;
let firebaseReady = false;
let firebaseError = null;

function initFirebase() {
  if (typeof firebase === "undefined") {
    throw new Error("No se cargó Firebase. Verifique internet y recargue la página (F5).");
  }
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    auth = firebase.auth();
    firebaseReady = true;
    firebaseError = null;
    return db;
  } catch (e) {
    firebaseReady = false;
    firebaseError = e.message || String(e);
    throw e;
  }
}

function tsToDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return new Date(ts);
}

function formatMoney(n) {
  return "Q " + (Number(n) || 0).toFixed(2);
}

function formatDate(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString("es-GT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleString("es-GT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function isToday(d) {
  const dt = d instanceof Date ? d : tsToDate(d);
  if (!dt) return false;
  const now = new Date();
  return dt.getDate() === now.getDate() &&
    dt.getMonth() === now.getMonth() &&
    dt.getFullYear() === now.getFullYear();
}

function genId() {
  if (!db) throw new Error("Firebase no está listo");
  return db.collection("_ids").doc().id;
}

function firestoreErrorMessage(err) {
  if (!err) return "Error desconocido";
  const code = err.code || "";
  if (code === "permission-denied") {
    return "Permiso denegado en Firestore. Inicie sesión con un usuario autorizado o revise las reglas de seguridad.";
  }
  if (code === "not-found" || (err.message && err.message.indexOf("NOT_FOUND") >= 0)) {
    return "Base de datos no creada. Firebase Console → Firestore → Crear base de datos.";
  }
  if (code === "unavailable") {
    return "Firestore no disponible. Revise su conexión a internet.";
  }
  return err.message || String(err);
}

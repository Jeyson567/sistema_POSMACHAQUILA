/* Autenticación y roles - Ferretería Machaquila */
(function () {
  "use strict";

  var session = {
    user: null,
    role: null,
    profile: null,
    booted: false
  };

  function $(id) { return document.getElementById(id); }

  function setLoginError(msg) {
    var el = $("loginError");
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.style.display = "block";
    } else {
      el.textContent = "";
      el.style.display = "none";
    }
  }

  function setLoginLoading(on) {
    var btn = $("btnLogin");
    var form = $("formLogin");
    if (btn) {
      btn.disabled = !!on;
      btn.textContent = on ? "Ingresando..." : "Ingresar";
    }
    if (form) {
      var inputs = form.querySelectorAll("input");
      for (var i = 0; i < inputs.length; i++) inputs[i].disabled = !!on;
    }
  }

  function showLogin() {
    var login = $("loginScreen");
    var app = $("appShell");
    if (login) login.style.display = "flex";
    if (app) app.style.display = "none";
    document.body.classList.remove("pos-authenticated");
    session.booted = false;
  }

  function showApp() {
    var login = $("loginScreen");
    var app = $("appShell");
    if (login) login.style.display = "none";
    if (app) app.style.display = "flex";
    document.body.classList.add("pos-authenticated");
  }

  function roleLabel(role) {
    if (role === ROLES.ADMIN) return "Administrador";
    if (role === ROLES.EMPLEADO) return "Empleado";
    return role || "";
  }

  function updateUserBar() {
    var nameEl = $("userDisplayName");
    var roleEl = $("userDisplayRole");
    if (nameEl) {
      nameEl.textContent = (session.profile && session.profile.nombre) ||
        (session.user && session.user.email) || "Usuario";
    }
    if (roleEl) roleEl.textContent = roleLabel(session.role);
  }

  function canViewSection(sectionId) {
    if (!session.role) return false;
    var list = SECCIONES_POR_ROL[session.role];
    return list && list.indexOf(sectionId) >= 0;
  }

  window.posCanViewSection = canViewSection;

  function applyRoleUI() {
    var isAdmin = session.role === ROLES.ADMIN;
    document.querySelectorAll("[data-role-only]").forEach(function (el) {
      var needed = el.getAttribute("data-role-only");
      var allowed = needed === session.role || (needed === "admin" && isAdmin);
      el.style.display = allowed ? "" : "none";
    });
    document.querySelectorAll(".section").forEach(function (sec) {
      if (!canViewSection(sec.id)) sec.classList.remove("active");
    });
  }

  function defaultSection() {
    return session.role === ROLES.ADMIN ? "dashboard" : "ventas";
  }

  function goToDefaultView() {
    if (typeof window.mostrarVista === "function") {
      window.mostrarVista(defaultSection());
    }
  }

  function fetchUserProfile(uid) {
    if (!db) return Promise.reject(new Error("Firestore no disponible"));
    return db.collection(COL.usuarios).doc(uid).get().then(function (snap) {
      if (!snap.exists) {
        return Promise.reject(new Error(
          "Usuario sin perfil en Firestore. Cree el documento usuarios/" + uid +
          " con campo role: \"admin\" o \"empleado\"."
        ));
      }
      var data = snap.data() || {};
      var role = (data.role || "").toLowerCase();
      if (role !== ROLES.ADMIN && role !== ROLES.EMPLEADO) {
        return Promise.reject(new Error(
          "Rol inválido en Firestore. Use role: \"admin\" o \"empleado\"."
        ));
      }
      if (data.activo === false) {
        return Promise.reject(new Error("Usuario desactivado. Contacte al administrador."));
      }
      return { role: role, profile: data };
    });
  }

  function startAppOnce() {
    if (session.booted) {
      applyRoleUI();
      goToDefaultView();
      return;
    }
    session.booted = true;
    applyRoleUI();
    updateUserBar();
    if (typeof window.posBoot === "function") {
      window.posBoot();
    }
    goToDefaultView();
  }

  function onAuthUser(user) {
    if (!user) {
      session.user = null;
      session.role = null;
      session.profile = null;
      window.posCanViewSection = function () { return false; };
      showLogin();
      return;
    }

    fetchUserProfile(user.uid).then(function (result) {
      session.user = user;
      session.role = result.role;
      session.profile = result.profile;
      window.posCanViewSection = canViewSection;
      showApp();
      startAppOnce();
    }).catch(function (err) {
      console.error("[Auth]", err);
      var msg = (err && err.message) ? err.message : String(err);
      if (auth) {
        auth.signOut().finally(function () {
          showLogin();
          setLoginError(msg);
        });
      } else {
        showLogin();
        setLoginError(msg);
      }
    });
  }

  function handleLoginSubmit(e) {
    e.preventDefault();
    setLoginError("");
    var email = ($("loginEmail") && $("loginEmail").value || "").trim();
    var password = $("loginPassword") ? $("loginPassword").value : "";
    if (!email || !password) {
      setLoginError("Ingrese correo y contraseña.");
      return;
    }
    if (!auth) {
      setLoginError("Firebase Auth no está disponible. Recargue la página.");
      return;
    }
    setLoginLoading(true);
    auth.signInWithEmailAndPassword(email, password)
      .catch(function (err) {
        var msg = "Error al iniciar sesión.";
        if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
          msg = "Correo o contraseña incorrectos.";
        } else if (err.code === "auth/invalid-email") {
          msg = "Correo electrónico inválido.";
        } else if (err.code === "auth/too-many-requests") {
          msg = "Demasiados intentos. Espere un momento e intente de nuevo.";
        } else if (err.code === "auth/network-request-failed") {
          msg = "Sin conexión. Verifique su internet.";
        } else if (err.message) {
          msg = err.message;
        }
        setLoginError(msg);
      })
      .finally(function () { setLoginLoading(false); });
  }

  function handleLogout() {
    if (!auth) return;
    auth.signOut().then(function () {
      location.reload();
    }).catch(function (err) {
      console.error("[Auth] logout:", err);
      location.reload();
    });
  }

  function initAuthModule() {
    showLogin();
    try {
      initFirebase();
    } catch (e) {
      setLoginError(e.message || String(e));
      return;
    }
    if (!auth) {
      setLoginError("No se pudo inicializar Firebase Auth.");
      return;
    }
    auth.onAuthStateChanged(onAuthUser);
    var form = $("formLogin");
    if (form) form.addEventListener("submit", handleLoginSubmit);
    var btnOut = $("btnLogout");
    if (btnOut) btnOut.addEventListener("click", handleLogout);
  }

  window.posAuthStart = function () {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initAuthModule);
    } else {
      initAuthModule();
    }
  };
})();

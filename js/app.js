/* POS Ferretería Machaquila */
(function () {
  "use strict";

  const state = {
    productos: [],
    clientes: [],
    ventas: [],
    tickets: [],
    cotizaciones: [],
    cajaActual: null,
    cajas: [],
    gastos: [],
    movimientos: [],
    carrito: [],
    cotItems: [],
    cotEditId: null,
    ticketCounter: 0,
    cotCounter: 0,
    listeners: [],
    ticketsHistorialCompleto: false,
    ticketsCargando: false,
    ticketPagina: 0,
    detalleActual: null,
    cancelacionObjetivoId: null,
    cancelaciones: []
  };

  var guardiaCobro = crearGuardiaOperacion();
  var guardiaCancelacion = crearGuardiaOperacion();
  var guardiaApertura = crearGuardiaOperacion();
  var guardiaMovimiento = crearGuardiaOperacion();
  var guardiaCierre = crearGuardiaOperacion();

  var firebaseConnectTimeout = null;
  const STOCK_BAJO = 5;

  /* ─── UI helpers ─── */
  function $(id) { return document.getElementById(id); }

  function toast(msg, type) {
    var box = $("toastContainer");
    if (!box) {
      console.log("[POS] toast:", msg);
      return;
    }
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  }

  function openModal(id) {
    const m = $(id);
    if (m) m.classList.add("open");
    else console.error("[POS] Modal no encontrado:", id);
  }

  function closeModal(id) {
    const m = $(id);
    if (m) m.classList.remove("open");
  }

  function safeOn(id, event, handler) {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
    else console.warn("[POS] Elemento no encontrado #" + id);
  }

  var VISTAS_IDS = ["dashboard", "contable", "ventas", "inventario", "clientes", "cotizaciones", "caja", "cancelaciones"];

  function mostrarVista(id) {
    if (!id) {
      console.warn("[POS] mostrarVista: id vacío");
      return;
    }
    if (typeof window.posCanViewSection === "function" && !window.posCanViewSection(id)) {
      toast("No tiene permiso para acceder a esta sección", "error");
      return;
    }
    var vista = document.getElementById(id);
    if (!vista) {
      console.error("[POS] No existe la sección #" + id + " en index.html");
      return;
    }
    document.querySelectorAll(".section").forEach(function (s) {
      s.classList.remove("active");
    });
    vista.classList.add("active");
    document.querySelectorAll(".nav-menu a[data-section]").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-section") === id);
    });
    var sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("open");
    if (id === "cancelaciones") cargarCancelaciones();
    console.log("[POS] Vista:", id);
  }

  function showSection(id) {
    mostrarVista(id);
  }

  function initModales() {
    document.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeModal(btn.getAttribute("data-close"));
      });
    });
    document.querySelectorAll(".modal-overlay").forEach(function (ov) {
      ov.addEventListener("click", function (e) {
        if (e.target === ov) ov.classList.remove("open");
      });
    });
  }

  function initNavegacion() {
    VISTAS_IDS.forEach(function (vid) {
      if (!document.getElementById(vid)) {
        console.error("[POS] Falta <section id=\"" + vid + "\"> en index.html");
      }
    });
    document.querySelectorAll(".nav-menu a[data-section]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        mostrarVista(a.getAttribute("data-section"));
      });
    });
    safeOn("menuToggle", "click", function () {
      var sb = document.getElementById("sidebar");
      if (sb) sb.classList.toggle("open");
    });
  }

  function getProducto(id) {
    return state.productos.find(function (p) { return p.id === id; });
  }

  function getCliente(id) {
    return state.clientes.find(function (c) { return c.id === id; });
  }

  function nombreCliente(id) {
    const c = getCliente(id);
    return c ? c.nombre : "—";
  }

  function setFirebaseStatus(type, msg) {
    const el = document.getElementById("firebaseStatus");
    if (el) {
      el.className = "firebase-status " + type;
      el.textContent = msg;
    }
  }

  function showBanner(msg, isError) {
    const el = document.getElementById("alertBanner");
    if (!el) return;
    el.style.display = "block";
    el.className = "alert-banner" + (isError ? " error" : "");
    el.innerHTML = msg;
  }

  function onSnapshotError(label, err) {
    console.error("Firestore:", label, err);
    const msg = typeof firestoreErrorMessage === "function"
      ? firestoreErrorMessage(err) : (err.message || String(err));
    setFirebaseStatus("err", "Error: " + label);
    showBanner("<strong>Firebase:</strong> " + msg, true);
  }

  function watchCol(label, ref, onData) {
    try {
      ref.onSnapshot(function (snap) {
        try {
          onData(snap);
        } catch (e) {
          console.error("[POS] Error procesando", label, e);
        }
        if (firebaseConnectTimeout) {
          clearTimeout(firebaseConnectTimeout);
          firebaseConnectTimeout = null;
        }
        setFirebaseStatus("ok", "Conectado · datos en vivo");
      }, function (err) {
        onSnapshotError(label, err);
      });
    } catch (e) {
      console.error("[POS] watchCol", label, e);
      onSnapshotError(label, e);
    }
  }

  function updateCajaBanner() {
    if (!state.cajaActual || !isCajaAbierta(state.cajaActual)) {
      showBanner(
        "<strong>Paso 1:</strong> Vaya a <b>Caja</b> y pulse <b>Abrir caja</b> antes de vender. " +
        "Inventario y clientes sí funcionan sin caja abierta.",
        false
      );
    } else {
      const el = document.getElementById("alertBanner");
      if (el && !el.classList.contains("error")) el.style.display = "none";
    }
  }

  function aplicarSnapVentas(snap) {
    state.ventas = [];
    snap.forEach(function (d) {
      var v = Object.assign({ id: d.id }, d.data());
      v.fecha = tsToDate(v.fecha);
      v.fechaCancelacion = tsToDate(v.fechaCancelacion);
      state.ventas.push(v);
    });
    state.ventas.sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });
    renderDashboard();
    renderContable();
    renderCaja();
  }

  function listenVentasRecientes() {
    watchCol("ventas", db.collection(COL.ventas).limit(500), aplicarSnapVentas);
  }

  function aplicarSnapMovimientos(snap) {
    var incoming = [];
    snap.forEach(function (d) {
      var m = Object.assign({ id: d.id }, d.data());
      m.fecha = tsToDate(m.fecha);
      incoming.push(m);
    });
    fusionarMovimientos(incoming);
    renderMovimientos();
    renderCaja();
    renderDashboard();
    renderContable();
  }

  function listenMovimientosRecientes() {
    var q = db.collection(COL.movimientosCaja).orderBy("fecha", "desc").limit(300);
    q.onSnapshot(aplicarSnapMovimientos, function (err) {
      console.warn("[POS] movimientos por fecha", err);
      watchCol("movimientos", db.collection(COL.movimientosCaja).limit(200), aplicarSnapMovimientos);
    });
  }

  function fusionarMovimientos(lista) {
    var map = {};
    state.movimientos.forEach(function (m) { map[m.id] = m; });
    (lista || []).forEach(function (m) {
      if (m && m.id) map[m.id] = m;
    });
    state.movimientos = Object.keys(map).map(function (id) { return map[id]; });
    state.movimientos.sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });
  }

  /* ─── Firebase listeners ─── */
  function initListeners() {
    if (!db) {
      showBanner("Firebase no inicializó. Recargue la página (F5) con internet.", true);
      return;
    }

    watchCol("productos", db.collection(COL.productos), function (snap) {
      state.productos = [];
      snap.forEach(function (d) {
        state.productos.push(Object.assign({ id: d.id }, d.data()));
      });
      renderInventario();
      renderPosProductos();
      renderCotProductos();
    });

    watchCol("clientes", db.collection(COL.clientes), function (snap) {
      state.clientes = [];
      snap.forEach(function (d) {
        state.clientes.push(Object.assign({ id: d.id }, d.data()));
      });
      renderClientes();
      fillClienteSelects();
    });

    listenVentasRecientes();
    listenTicketsRecientes();
    cargarTodosLosTickets();

    watchCol("cotizaciones", db.collection(COL.cotizaciones), function (snap) {
      state.cotizaciones = [];
      snap.forEach(function (d) {
        const c = Object.assign({ id: d.id }, d.data());
        c.fecha = tsToDate(c.fecha);
        state.cotizaciones.push(c);
      });
      var maxC = 0;
      state.cotizaciones.forEach(function (c) { if (c.numero > maxC) maxC = c.numero; });
      state.cotCounter = maxC;
      state.cotizaciones.sort(function (a, b) { return (b.numero || 0) - (a.numero || 0); });
      renderCotizaciones();
    });

    watchCol("cajaAbierta", db.collection(COL.caja).where("abierta", "==", true).limit(1), function (snap) {
      state.cajaActual = null;
      snap.forEach(function (d) {
        state.cajaActual = parseCajaDoc(d);
      });
      renderCaja();
      renderDashboard();
      renderContable();
      updateCajaBanner();
    });

    watchCol("caja", db.collection(COL.caja).limit(50), function (snap) {
      state.cajas = [];
      snap.forEach(function (d) {
        state.cajas.push(parseCajaDoc(d));
      });
      state.cajas.sort(function (a, b) { return (b.fechaApertura || 0) - (a.fechaApertura || 0); });
      var abiertaEnLista = state.cajas.find(isCajaAbierta) || null;
      if (!state.cajaActual || !isCajaAbierta(state.cajaActual)) {
        state.cajaActual = abiertaEnLista;
      } else if (!state.cajas.some(function (c) { return c.id === state.cajaActual.id; })) {
        state.cajas.unshift(state.cajaActual);
      }
      renderCaja();
      renderDashboard();
      renderContable();
      updateCajaBanner();
    });

    watchCol("gastos", db.collection(COL.gastos).limit(100), function (snap) {
      state.gastos = [];
      snap.forEach(function (d) {
        const g = Object.assign({ id: d.id }, d.data());
        g.fecha = tsToDate(g.fecha);
        state.gastos.push(g);
      });
      renderContable();
      renderCaja();
    });

    listenMovimientosRecientes();
  }

  function ensureDb() {
    if (!db) {
      toast("Firebase no conectado. Revise internet y reglas de Firestore.", "error");
      return false;
    }
    return true;
  }

  /* ─── Stats helpers ─── */
  function ventasHoy() {
    return state.ventas.filter(function (v) { return isToday(v.fecha); });
  }

  function calcStats() {
    const vh = ventasHoy();
    let ventasTotal = 0, ganancias = 0, productosVendidos = 0;
    const prodCount = {};

    vh.forEach(function (v) {
      if (!ventaCuentaEnTotales(v)) return;
      ventasTotal += v.total || 0;
      (v.items || []).forEach(function (it) {
        const qty = it.cantidad || 0;
        const precio = it.precioUnitario || 0;
        const costo = it.precioCosto || 0;
        ganancias += (precio - costo) * qty;
        productosVendidos += qty;
        const key = it.nombre || it.productoId;
        prodCount[key] = (prodCount[key] || 0) + qty;
      });
    });

    const top = Object.keys(prodCount)
      .map(function (k) { return { nombre: k, cant: prodCount[k] }; })
      .sort(function (a, b) { return b.cant - a.cant; })
      .slice(0, 10);

    const gastosHoy = state.gastos.filter(function (g) { return isToday(g.fecha); })
      .reduce(function (s, g) { return s + (g.monto || 0); }, 0);

    const ticketsHoy = state.tickets.filter(function (t) {
      return isToday(t.fecha) && !ventaEstaCancelada(t);
    }).length;

    let efectivo = 0;
    if (state.cajaActual && isCajaAbierta(state.cajaActual)) {
      efectivo = calcEfectivoCaja(state.cajaActual);
    }

    return {
      ventasTotal, ganancias, productosVendidos, top, gastosHoy, ticketsHoy, efectivo, numVentas: vh.length
    };
  }

  function parseCajaDoc(d) {
    const c = Object.assign({ id: d.id }, d.data());
    c.fechaApertura = tsToDate(c.fechaApertura);
    c.fechaCierre = tsToDate(c.fechaCierre);
    if (c.estado === "abierta" && c.abierta !== false) c.abierta = true;
    if (c.estado === "cerrada") c.abierta = false;
    return c;
  }

  function isCajaAbierta(c) {
    if (!c) return false;
    if (c.abierta === true) return true;
    if (c.estado === "abierta") return true;
    return false;
  }

  function calcEfectivoCaja(caja) {
    let total = caja.montoInicial || 0;
    const cajaId = caja.id;
    const apertura = caja.fechaApertura;

    state.ventas.forEach(function (v) {
      if (!ventaCuentaEnTotales(v)) return;
      if (v.cajaId === cajaId && v.tipoPago === "efectivo" && v.fecha >= apertura) {
        total += v.total || 0;
      }
    });

    state.movimientos.forEach(function (m) {
      if (m.cajaId === cajaId && m.fecha >= apertura) {
        if (m.tipo === "cancelacion" || m.esReversion) return;
        if (m.tipo === "gasto" || m.tipo === "retiro") total -= m.monto || 0;
        if (m.tipo === "ingreso") total += m.monto || 0;
      }
    });

    return total;
  }

  function calcResumenCaja(caja) {
    const res = { inicial: 0, ventas: 0, gastos: 0, retiros: 0, esperado: 0 };
    if (!caja) return res;
    const cajaId = caja.id;
    const apertura = caja.fechaApertura;
    res.inicial = caja.montoInicial || 0;
    state.ventas.forEach(function (v) {
      if (!ventaCuentaEnTotales(v)) return;
      if (v.cajaId === cajaId && v.fecha >= apertura) {
        res.ventas += v.total || 0;
      }
    });
    state.movimientos.forEach(function (m) {
      if (m.tipo === "cancelacion" || m.esReversion) return;
      if (m.cajaId === cajaId && m.fecha >= apertura) {
        if (m.tipo === "gasto") res.gastos += m.monto || 0;
        if (m.tipo === "retiro") res.retiros += m.monto || 0;
      }
    });
    res.esperado = calcEfectivoCaja(caja);
    return res;
  }

  function nombreUsuarioCaja() {
    return typeof window.posGetCajeroNombre === "function" ? window.posGetCajeroNombre() : "";
  }

  function renderStatCards(containerId, stats) {
    const el = $(containerId);
    if (!el) return;
    el.innerHTML =
      statCard("Ventas del día", formatMoney(stats.ventasTotal), "") +
      statCard("Ganancias del día", formatMoney(stats.ganancias), "success") +
      statCard("Caja actual", formatMoney(stats.efectivo), "accent") +
      statCard("Productos vendidos", stats.productosVendidos, "") +
      statCard("Tickets emitidos", stats.ticketsHoy, "") +
      statCard("Gastos hoy", formatMoney(stats.gastosHoy), "");
  }

  function statCard(label, value, cls) {
    return '<div class="stat-card ' + (cls || "") + '"><div class="label">' + label +
      '</div><div class="value">' + value + '</div></div>';
  }

  function renderDashboard() {
    const s = calcStats();
    renderStatCards("dashStats", s);
    const topEl = $("dashTopProducts");
    if (!topEl) return;
    if (!s.top.length) {
      topEl.innerHTML = '<li class="empty-state">Sin ventas hoy</li>';
      return;
    }
    topEl.innerHTML = s.top.map(function (p) {
      return "<li><span>" + escapeHtml(p.nombre) + "</span><strong>" + p.cant + "</strong></li>";
    }).join("");
  }

  function renderContable() {
    const s = calcStats();
    renderStatCards("contableStats", s);
    var res = $("contableResumen");
    if (!res) return;
    res.innerHTML =
      "<p><strong>Ventas registradas hoy:</strong> " + s.numVentas + "</p>" +
      "<p><strong>Total ventas:</strong> " + formatMoney(s.ventasTotal) + "</p>" +
      "<p><strong>Ganancia bruta:</strong> " + formatMoney(s.ganancias) + "</p>" +
      "<p><strong>Gastos:</strong> " + formatMoney(s.gastosHoy) + "</p>" +
      "<p><strong>Efectivo en caja:</strong> " + formatMoney(s.efectivo) + "</p>";
  }

  function escapeHtml(t) {
    const d = document.createElement("div");
    d.textContent = t;
    return d.innerHTML;
  }

  /* ─── INVENTARIO ─── */
  let invFilter = "";

  safeOn("invBuscar", "input", function (e) {
    invFilter = e.target.value.toLowerCase();
    renderInventario();
  });

  var productoFormAllowSubmit = false;

  function modalProductoAbierto() {
    var m = $("modalProducto");
    return !!(m && m.classList.contains("open"));
  }

  function focusCampoCodigoProducto() {
    var cod = $("prodCodigo");
    if (!cod) return;
    setTimeout(function () {
      cod.focus();
      cod.select();
    }, 50);
  }

  function bloquearEnterEscannerCodigo(e) {
    if (e.key !== "Enter" && e.keyCode !== 13) return;
    e.preventDefault();
    e.stopPropagation();
    var nombre = $("prodNombre");
    if (nombre) nombre.focus();
  }

  function initInventarioEscanner() {
    var prodCodigo = $("prodCodigo");
    var formProducto = $("formProducto");
    if (!prodCodigo || !formProducto) return;

    var btnGuardar = formProducto.querySelector('button[type="submit"]');
    if (btnGuardar) {
      btnGuardar.addEventListener("click", function () {
        productoFormAllowSubmit = true;
      });
    }

    ["keydown", "keypress"].forEach(function (ev) {
      prodCodigo.addEventListener(ev, bloquearEnterEscannerCodigo);
    });
    prodCodigo.addEventListener("keyup", function (e) {
      if (e.key === "Enter" || e.keyCode === 13) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    formProducto.addEventListener("keydown", function (e) {
      if ((e.key !== "Enter" && e.keyCode !== 13) || e.target !== prodCodigo) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    formProducto.addEventListener("submit", function (e) {
      if (!productoFormAllowSubmit) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  safeOn("invBuscar", "keydown", function (e) {
    if ((e.key !== "Enter" && e.keyCode !== 13) || !modalProductoAbierto()) return;
    e.preventDefault();
    e.stopPropagation();
    var cod = $("prodCodigo");
    var buscar = $("invBuscar");
    if (cod && buscar && buscar.value.trim()) {
      cod.value = buscar.value.trim();
      buscar.value = "";
      invFilter = "";
      renderInventario();
      var nombre = $("prodNombre");
      if (nombre) nombre.focus();
    }
  });

  function renderInventario() {
    const tbody = $("invTableBody");
    if (!tbody) return;
    let list = state.productos.slice();
    if (invFilter) {
      list = list.filter(function (p) {
        return (p.nombre || "").toLowerCase().indexOf(invFilter) >= 0 ||
          (p.codigoBarras || "").toLowerCase().indexOf(invFilter) >= 0;
      });
    }
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Sin productos</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (p) {
      const stock = p.stock || 0;
      const badge = stock <= STOCK_BAJO ? '<span class="badge badge-warning">Bajo</span>' : "";
      return "<tr><td>" + escapeHtml(p.codigoBarras || "") + "</td><td>" + escapeHtml(p.nombre) +
        "</td><td>" + formatMoney(p.precioCosto) + "</td><td>" + formatMoney(p.precioMinimo) +
        "</td><td>" + formatMoney(p.precioVenta) + "</td><td>" + stock + " " + badge +
        "</td><td>" + escapeHtml(p.categoria || "") + "</td><td>" +
        '<button class="btn btn-sm btn-secondary" data-edit-prod="' + p.id + '">Editar</button> ' +
        '<button class="btn btn-sm btn-danger" data-del-prod="' + p.id + '">Eliminar</button></td></tr>';
    }).join("");

    tbody.querySelectorAll("[data-edit-prod]").forEach(function (btn) {
      btn.addEventListener("click", function () { editProducto(btn.getAttribute("data-edit-prod")); });
    });
    tbody.querySelectorAll("[data-del-prod]").forEach(function (btn) {
      btn.addEventListener("click", function () { deleteProducto(btn.getAttribute("data-del-prod")); });
    });
  }

  function celdaExportacion(valor) {
    if (valor === undefined || valor === null || valor === "") return "";
    return valor;
  }

  function fechaRegistroProducto(p) {
    var raw = p.createdAt || p.fechaRegistro || p.fechaCreacion || null;
    if (!raw) return "";
    var dt = tsToDate(raw);
    return dt ? formatDateTime(dt) : "";
  }

  safeOn("btnDescargarInventario", "click", function () {
    if (!state.productos.length) {
      toast("El inventario todavía no está cargado. Espere la conexión y vuelva a intentar.", "warning");
      return;
    }
    if (typeof XLSX === "undefined") {
      toast("No se pudo preparar el Excel. Revise la conexión e intente de nuevo.", "error");
      return;
    }
    var filas = state.productos.map(function (p) {
      var unidad = p.unidadMedida != null ? p.unidadMedida : p.unidad;
      return {
        "Código": celdaExportacion(p.codigoBarras),
        "Nombre": celdaExportacion(p.nombre),
        "Categoría": celdaExportacion(p.categoria),
        "Descripción": celdaExportacion(p.descripcion),
        "Precio de compra": celdaExportacion(p.precioCosto),
        "Precio de venta": celdaExportacion(p.precioVenta),
        "Existencias": p.stock != null ? p.stock : "",
        "Unidad de medida": celdaExportacion(unidad),
        "Estado": celdaExportacion(p.estado),
        "Fecha de registro": fechaRegistroProducto(p)
      };
    });
    var hoja = XLSX.utils.json_to_sheet(filas);
    var libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Inventario");
    var fecha = isoFechaLocal(new Date());
    var nombre = "Inventario_Ferreteria_" + fecha + ".xlsx";
    XLSX.writeFile(libro, nombre);
    toast("Inventario descargado: " + filas.length + " productos. " + nombre, "success");
  });

  safeOn("btnNuevoProducto", "click", function () {
    productoFormAllowSubmit = false;
    $("formProducto").reset();
    $("prodId").value = "";
    $("modalProductoTitulo").textContent = "Nuevo producto";
    openModal("modalProducto");
    focusCampoCodigoProducto();
  });

  function editProducto(id) {
    const p = getProducto(id);
    if (!p) return;
    productoFormAllowSubmit = false;
    $("prodId").value = p.id;
    $("prodNombre").value = p.nombre || "";
    $("prodCodigo").value = p.codigoBarras || "";
    $("prodCosto").value = p.precioCosto || 0;
    $("prodMinimo").value = p.precioMinimo || 0;
    $("prodVenta").value = p.precioVenta || 0;
    $("prodStock").value = p.stock || 0;
    $("prodCategoria").value = p.categoria || "";
    $("modalProductoTitulo").textContent = "Editar producto";
    openModal("modalProducto");
  }

  safeOn("formProducto", "submit", function (e) {
    e.preventDefault();
    if (!productoFormAllowSubmit) return;
    productoFormAllowSubmit = false;
    if (!ensureDb()) return;
    const data = {
      nombre: $("prodNombre").value.trim(),
      codigoBarras: $("prodCodigo").value.trim(),
      precioCosto: parseFloat($("prodCosto").value) || 0,
      precioMinimo: parseFloat($("prodMinimo").value) || 0,
      precioVenta: parseFloat($("prodVenta").value) || 0,
      stock: parseInt($("prodStock").value, 10) || 0,
      categoria: $("prodCategoria").value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const id = $("prodId").value;
    const ref = id ? db.collection(COL.productos).doc(id) : db.collection(COL.productos).doc();
    if (!id) data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    ref.set(data, { merge: true }).then(function () {
      toast(id ? "Producto actualizado" : "Producto agregado", "success");
      closeModal("modalProducto");
    }).catch(function (err) { toast("Error: " + err.message, "error"); });
  });

  function deleteProducto(id) {
    if (!confirm("¿Eliminar este producto?")) return;
    db.collection(COL.productos).doc(id).delete()
      .then(function () { toast("Producto eliminado", "success"); })
      .catch(function (err) { toast("Error: " + err.message, "error"); });
  }

  /* ─── POS / VENTAS ─── */
  let posFilter = "";

  safeOn("posBuscar", "input", function (e) {
    posFilter = e.target.value.toLowerCase();
    renderPosProductos();
  });

  safeOn("posBuscar", "keydown", function (e) {
    if (e.key !== "Enter") return;
    const code = e.target.value.trim();
    if (!code) return;
    const prod = state.productos.find(function (p) {
      return (p.codigoBarras || "").toLowerCase() === code.toLowerCase();
    });
    if (prod) {
      agregarAlCarrito(prod.id);
      e.target.value = "";
      posFilter = "";
      renderPosProductos();
    }
  });

  function renderPosProductos() {
    let list = state.productos.slice();
    if (posFilter) {
      list = list.filter(function (p) {
        return (p.nombre || "").toLowerCase().indexOf(posFilter) >= 0 ||
          (p.codigoBarras || "").toLowerCase().indexOf(posFilter) >= 0;
      });
    }
    list = list.slice(0, 50);
    const tbody = $("posProductosList");
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5">Sin resultados</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (p) {
      return "<tr><td>" + escapeHtml(p.codigoBarras || "") + "</td><td>" + escapeHtml(p.nombre) +
        "</td><td>" + formatMoney(p.precioVenta) + "</td><td>" + (p.stock || 0) +
        '</td><td><button class="btn btn-sm btn-primary" data-add="' + p.id + '">+</button></td></tr>';
    }).join("");
    tbody.querySelectorAll("[data-add]").forEach(function (btn) {
      btn.addEventListener("click", function () { agregarAlCarrito(btn.getAttribute("data-add")); });
    });
  }

  function agregarAlCarrito(productoId) {
    const p = getProducto(productoId);
    if (!p) return;
    const exist = state.carrito.find(function (c) { return c.productoId === productoId; });
    if (exist) {
      if ((p.stock || 0) <= exist.cantidad) {
        toast("Stock insuficiente", "warning");
        return;
      }
      exist.cantidad += 1;
    } else {
      if ((p.stock || 0) < 1) {
        toast("Sin stock", "warning");
        return;
      }
      state.carrito.push({
        productoId: p.id,
        nombre: p.nombre,
        cantidad: 1,
        precioUnitario: p.precioVenta || 0,
        precioCosto: p.precioCosto || 0,
        precioMinimo: p.precioMinimo || 0
      });
    }
    renderCarrito();
    $("posBuscar").focus();
  }

  function renderCarrito() {
    const tbody = $("carritoBody");
    if (!state.carrito.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Carrito vacío</td></tr>';
      recalcCarrito();
      return;
    }
    tbody.innerHTML = state.carrito.map(function (item, idx) {
      const sub = item.cantidad * item.precioUnitario;
      return "<tr><td>" + escapeHtml(item.nombre) + "</td><td>" +
        '<div class="qty-control">' +
        '<button type="button" data-qty-min="' + idx + '">-</button>' +
        '<input type="number" min="1" value="' + item.cantidad + '" data-qty="' + idx + '">' +
        '<button type="button" data-qty-plus="' + idx + '">+</button></div>' +
        "</td><td><input type=\"number\" step=\"0.01\" min=\"0\" value=\"" + item.precioUnitario.toFixed(2) +
        "\" data-precio=\"" + idx + "\" style=\"width:70px\"></td><td>" + formatMoney(sub) +
        "</td><td><button class='btn btn-sm btn-danger' data-rm='" + idx + "'>×</button></td></tr>";
    }).join("");

    tbody.querySelectorAll("[data-qty-min]").forEach(function (b) {
      b.addEventListener("click", function () {
        const i = parseInt(b.getAttribute("data-qty-min"), 10);
        if (state.carrito[i].cantidad > 1) state.carrito[i].cantidad--;
        else state.carrito.splice(i, 1);
        renderCarrito();
      });
    });
    tbody.querySelectorAll("[data-qty-plus]").forEach(function (b) {
      b.addEventListener("click", function () {
        const i = parseInt(b.getAttribute("data-qty-plus"), 10);
        const p = getProducto(state.carrito[i].productoId);
        if (p && state.carrito[i].cantidad >= (p.stock || 0)) {
          toast("Stock insuficiente", "warning");
          return;
        }
        state.carrito[i].cantidad++;
        renderCarrito();
      });
    });
    tbody.querySelectorAll("[data-qty]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        const i = parseInt(inp.getAttribute("data-qty"), 10);
        const qty = parseInt(inp.value, 10) || 1;
        const p = getProducto(state.carrito[i].productoId);
        if (p && qty > (p.stock || 0)) {
          toast("Stock insuficiente", "warning");
          inp.value = state.carrito[i].cantidad;
          return;
        }
        state.carrito[i].cantidad = Math.max(1, qty);
        renderCarrito();
      });
    });
    tbody.querySelectorAll("[data-precio]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        const i = parseInt(inp.getAttribute("data-precio"), 10);
        const precio = parseFloat(inp.value) || 0;
        const min = state.carrito[i].precioMinimo || 0;
        if (precio < min) {
          toast("Precio menor al mínimo (" + formatMoney(min) + ")", "error");
          inp.value = state.carrito[i].precioUnitario.toFixed(2);
          return;
        }
        state.carrito[i].precioUnitario = precio;
        renderCarrito();
      });
    });
    tbody.querySelectorAll("[data-rm]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.carrito.splice(parseInt(b.getAttribute("data-rm"), 10), 1);
        renderCarrito();
      });
    });
    recalcCarrito();
  }

  function recalcCarrito() {
    let sub = 0;
    state.carrito.forEach(function (it) { sub += it.cantidad * it.precioUnitario; });
    $("cartSubtotal").textContent = formatMoney(sub);
    $("cartTotal").textContent = formatMoney(sub);
    const efectivo = parseFloat($("posEfectivo").value) || 0;
    const tipo = $("posTipoPago").value;
    if (tipo === "efectivo") {
      $("cartVuelto").textContent = formatMoney(Math.max(0, efectivo - sub));
    } else {
      $("cartVuelto").textContent = formatMoney(0);
    }
  }

  safeOn("posEfectivo", "input", recalcCarrito);
  safeOn("posTipoPago", "change", function () {
    const fiado = $("posTipoPago").value === "fiado";
    $("grupoEfectivo").style.display = fiado ? "none" : "flex";
    $("filaVuelto").style.display = fiado ? "none" : "flex";
    recalcCarrito();
  });

  safeOn("btnVaciarCarrito", "click", function () {
    state.carrito = [];
    renderCarrito();
  });

  function isoFechaLocal(d) {
    if (!d) return "";
    var dt = d instanceof Date ? d : tsToDate(d);
    if (!dt || isNaN(dt.getTime())) return "";
    var mes = String(dt.getMonth() + 1).padStart(2, "0");
    var dia = String(dt.getDate()).padStart(2, "0");
    return dt.getFullYear() + "-" + mes + "-" + dia;
  }

  function obtenerMaxNumeroTicket() {
    var maxN = state.ticketCounter || 0;
    return db.collection(COL.tickets).orderBy("numero", "desc").limit(1).get().then(function (snap) {
      snap.forEach(function (d) {
        var n = Number(d.data().numero);
        if (!isNaN(n) && n > maxN) maxN = n;
      });
      return maxN;
    }).catch(function (err) {
      console.warn("[POS] No se pudo leer el último ticket", err);
      return maxN;
    });
  }

  safeOn("btnCobrar", "click", cobrarVenta);

  async function cobrarVenta() {
    if (!guardiaCobro.intentar()) {
      toast("La venta ya se está procesando", "warning");
      return;
    }
    var btnCobro = $("btnCobrar");
    var carritoPrevio = null;
    try {
    if (!ensureDb()) return;
    if (!state.carrito.length) {
      toast("Carrito vacío", "warning");
      return;
    }
    if (!state.cajaActual || !isCajaAbierta(state.cajaActual)) {
      toast("Debe abrir la caja primero", "error");
      return;
    }
    for (var i = 0; i < state.carrito.length; i++) {
      var it = state.carrito[i];
      if (!it.productoId) {
        toast("Hay un producto sin identificador. La venta no se registró.", "error");
        return;
      }
      if (it.precioUnitario < (it.precioMinimo || 0)) {
        toast("Precio de " + it.nombre + " menor al mínimo", "error");
        return;
      }
      var p = getProducto(it.productoId);
      if (p && it.cantidad > (p.stock || 0)) {
        toast("Stock insuficiente: " + it.nombre, "error");
        return;
      }
    }

    const tipoPago = $("posTipoPago").value;
    const clienteId = $("posCliente").value || null;
    let total = 0;
    state.carrito.forEach(function (it) { total += it.cantidad * it.precioUnitario; });

    if (tipoPago === "efectivo") {
      const efectivo = parseFloat($("posEfectivo").value) || 0;
      if (efectivo < total) {
        toast("Efectivo insuficiente", "error");
        return;
      }
    } else if (!clienteId) {
      toast("Seleccione cliente para venta fiada", "error");
      return;
    }

    const items = state.carrito.map(function (it) {
      return {
        productoId: it.productoId,
        nombre: it.nombre,
        cantidad: it.cantidad,
        precioUnitario: it.precioUnitario,
        precioCosto: it.precioCosto,
        subtotal: it.cantidad * it.precioUnitario
      };
    });

    var efectivoRecibido = tipoPago === "efectivo" ? parseFloat($("posEfectivo").value) || 0 : 0;
    var vuelto = tipoPago === "efectivo" ? Math.max(0, efectivoRecibido - total) : 0;
    var cajaId = state.cajaActual.id;
    var cajero = nombreUsuarioCaja();
    var opId = genId();
    var clienteNombre = clienteId ? nombreCliente(clienteId) : "Contado";
    var preparado = prepararItemsVenta(items);
    var lineasStock = preparado.lineasStock;
    if (!lineasStock.length) {
      toast("No hay productos válidos para descontar", "error");
      return;
    }

    if (btnCobro) {
      btnCobro.disabled = true;
      btnCobro.textContent = "Procesando...";
    }
    carritoPrevio = state.carrito.map(function (row) { return Object.assign({}, row); });
    state.carrito = [];
    renderCarrito();

    var maxNumero = await obtenerMaxNumeroTicket();
    var resultado = await db.runTransaction(function (tx) {
      var ventaRef = db.collection(COL.ventas).doc(opId);
      var ticketRef = db.collection(COL.tickets).doc(opId);
      var seqRef = db.collection("_ids").doc("ticketSequence");
      var cajaRef = db.collection(COL.caja).doc(cajaId);
      var movRef = db.collection(COL.movimientosCaja).doc(opId);
      var cliRef = clienteId ? db.collection(COL.clientes).doc(clienteId) : null;
      var prodRefs = lineasStock.map(function (l) {
        return db.collection(COL.productos).doc(l.productoId);
      });

      return tx.get(ventaRef).then(function (ventaSnap) {
        return tx.get(seqRef).then(function (seqSnap) {
          return tx.get(cajaRef).then(function (cajaSnap) {
            var lecturas = prodRefs.map(function (ref) { return tx.get(ref); });
            if (cliRef) lecturas.push(tx.get(cliRef));
            return Promise.all(lecturas).then(function (snaps) {
              var prodSnaps = snaps.slice(0, prodRefs.length);
              var cliSnap = cliRef ? snaps[snaps.length - 1] : null;
              if (ventaSnap.exists) {
                var previa = ventaSnap.data() || {};
                return { repetida: true, numero: previa.numeroTicket };
              }
              if (!cajaSnap.exists || !isCajaAbierta(cajaSnap.data())) {
                throw new Error("La caja se cerró. La venta no se registró.");
              }
              for (var s = 0; s < prodSnaps.length; s++) {
                if (!prodSnaps[s].exists) {
                  throw new Error("No se encontró el producto " + lineasStock[s].nombre + ". La venta no se registró.");
                }
                var stockSrv = Number(prodSnaps[s].data().stock) || 0;
                if (stockSrv < lineasStock[s].cantidad) {
                  throw new Error("Stock insuficiente: " + lineasStock[s].nombre + ". La venta no se registró.");
                }
              }
              if (tipoPago === "fiado" && (!cliSnap || !cliSnap.exists)) {
                throw new Error("El cliente no existe. La venta no se registró.");
              }
              var baseSeq = seqSnap.exists ? Number(seqSnap.data().valor) || 0 : 0;
              var numeroTicket = siguienteNumeroTicket(baseSeq, maxNumero);
              if (seqSnap.exists) tx.update(seqRef, { valor: numeroTicket });
              else tx.set(seqRef, { valor: numeroTicket });
              for (var u = 0; u < prodRefs.length; u++) {
                tx.update(prodRefs[u], {
                  stock: firebase.firestore.FieldValue.increment(-lineasStock[u].cantidad)
                });
              }
              tx.set(ventaRef, {
                items: items,
                subtotal: total,
                total: total,
                tipoPago: tipoPago,
                clienteId: clienteId,
                efectivoRecibido: efectivoRecibido,
                vuelto: vuelto,
                cajaId: cajaId,
                fecha: firebase.firestore.FieldValue.serverTimestamp(),
                numeroTicket: numeroTicket,
                operacionId: opId,
                estado: "ACTIVA",
                cajeroNombre: cajero
              });
              tx.set(ticketRef, {
                ventaId: ventaRef.id,
                numero: numeroTicket,
                items: items,
                total: total,
                tipoPago: tipoPago,
                clienteId: clienteId,
                clienteNombre: clienteNombre,
                efectivoRecibido: efectivoRecibido,
                vuelto: vuelto,
                fecha: firebase.firestore.FieldValue.serverTimestamp(),
                operacionId: opId,
                estado: "ACTIVA",
                cajeroNombre: cajero
              });
              if (tipoPago === "efectivo") {
                tx.set(movRef, {
                  tipo: "venta",
                  monto: total,
                  descripcion: "Venta #" + numeroTicket,
                  cajaId: cajaId,
                  ventaId: ventaRef.id,
                  operacionId: opId,
                  fecha: firebase.firestore.FieldValue.serverTimestamp()
                });
              }
              if (tipoPago === "fiado" && cliRef) {
                tx.update(cliRef, {
                  saldoPendiente: firebase.firestore.FieldValue.increment(total)
                });
              }
              return { repetida: false, numero: numeroTicket };
            });
          });
        });
      });
    });

    carritoPrevio = null;
    try {
      imprimirTicket({
        numero: resultado.numero,
        items: items,
        total: total,
        tipoPago: tipoPago,
        clienteNombre: clienteNombre,
        efectivoRecibido: efectivoRecibido,
        vuelto: vuelto,
        fecha: new Date(),
        cajeroNombre: cajero
      });
    } catch (printErr) {
      console.error("[POS] impresión", printErr);
    }
    if ($("posEfectivo")) $("posEfectivo").value = "";
    renderCarrito();
    toast((resultado.repetida ? "Venta ya registrada #" : "Venta registrada #") + resultado.numero, "success");
    } catch (err) {
      if (carritoPrevio) {
        state.carrito = carritoPrevio;
        renderCarrito();
      }
      toast("Error al cobrar: " + (err && err.message ? err.message : err), "error");
    } finally {
      guardiaCobro.liberar();
      if (btnCobro) {
        btnCobro.disabled = false;
        btnCobro.textContent = "Cobrar venta";
      }
    }
  }

  function padTicketNum(n) {
    return String(n || 0).padStart(6, "0");
  }

  function formatTicketDateTime(d) {
    if (!d) return "—";
    var dt = d instanceof Date ? d : (typeof tsToDate === "function" ? tsToDate(d) : null);
    if (!dt) dt = new Date(d);
    if (!dt || isNaN(dt.getTime())) return "—";
    return dt.toLocaleString("es-GT", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  }

  function ticketCajeroNombre(data) {
    if (data && data.cajeroNombre) return data.cajeroNombre;
    if (typeof window.posGetCajeroNombre === "function") {
      var n = window.posGetCajeroNombre();
      if (n) return n;
    }
    return "—";
  }

  function ticketTipoPagoLabel(tipo) {
    return tipo === "fiado" ? "Fiado" : "Efectivo";
  }

  function imprimirTicket(data) {
    const el = $("ticket-print");
    if (!el) return;

    var productLines = "";
    (data.items || []).forEach(function (it) {
      var cant = Number(it.cantidad) || 0;
      var precio = Number(it.precioUnitario) || 0;
      var sub = it.subtotal != null ? Number(it.subtotal) : cant * precio;
      productLines +=
        "<div class='ticket-item'>" +
        "<div class='ticket-item-name'>" + escapeHtml(it.nombre || "Producto") + "</div>" +
        "<div class='ticket-item-detail'>" +
        "<span class='ticket-item-qty'>" + cant + " x " + formatMoney(precio) + "</span>" +
        "<span class='ticket-item-amt'>" + formatMoney(sub) + "</span>" +
        "</div></div>";
    });

    var pagoHtml =
      "<div class='ticket-pay-block'>" +
      "<div class='ticket-pay-row'><span>Forma de pago</span><strong>" + ticketTipoPagoLabel(data.tipoPago) + "</strong></div>";

    if (data.tipoPago === "efectivo") {
      pagoHtml +=
        "<div class='ticket-pay-row'><span>Recibido</span><strong>" + formatMoney(data.efectivoRecibido) + "</strong></div>" +
        "<div class='ticket-vuelto-box'>" +
        "<div class='ticket-vuelto-row'><span>VUELTO</span><span>" + formatMoney(data.vuelto) + "</span></div>" +
        "</div>";
    }
    pagoHtml += "</div>";

    el.innerHTML =
      "<div class='ticket-center'>" +
      "<div class='ticket-brand'>FERRETERÍA MACHAQUILA</div>" +
      "<div class='ticket-subtitle'>Venta de Materiales</div>" +
      "<div class='ticket-num'>Ticket #" + padTicketNum(data.numero) + "</div>" +
      "<div class='ticket-datetime'>" + formatTicketDateTime(data.fecha) + "</div>" +
      "<div class='ticket-meta-row'>Cajero: " + escapeHtml(ticketCajeroNombre(data)) + "</div>" +
      "</div>" +
      "<div class='ticket-line'></div>" +
      "<div class='ticket-section-title'>Productos</div>" +
      productLines +
      "<div class='ticket-line'></div>" +
      "<div class='ticket-total-box'>" +
      "<div class='ticket-total-row'><span>TOTAL</span><span>" + formatMoney(data.total) + "</span></div>" +
      "</div>" +
      pagoHtml +
      "<div class='ticket-line'></div>" +
      "<div class='ticket-center ticket-thanks'>¡Gracias por su compra!</div>";

    el.classList.add("show");
    document.documentElement.classList.add("printing-ticket");
    document.body.classList.add("printing-ticket");
    var pageStyle = $("ticketThermalPageStyle");
    if (pageStyle) pageStyle.disabled = false;
    window.print();
    setTimeout(function () {
      el.classList.remove("show");
      document.documentElement.classList.remove("printing-ticket");
      document.body.classList.remove("printing-ticket");
      if (pageStyle) pageStyle.disabled = true;
    }, 800);
  }

  var buscarTicketTimer = null;

  function fusionarTickets(lista) {
    var map = {};
    state.tickets.forEach(function (t) { map[t.id] = t; });
    (lista || []).forEach(function (t) {
      if (t && t.id) map[t.id] = t;
    });
    state.tickets = Object.keys(map).map(function (id) { return map[id]; });
    state.tickets.sort(function (a, b) {
      var nb = Number(b.numero) || 0;
      var na = Number(a.numero) || 0;
      if (nb !== na) return nb - na;
      var fb = b.fecha ? b.fecha.getTime() : 0;
      var fa = a.fecha ? a.fecha.getTime() : 0;
      return fb - fa;
    });
    state.tickets.forEach(function (t) {
      var n = Number(t.numero);
      if (!isNaN(n) && n > state.ticketCounter) state.ticketCounter = n;
    });
  }

  function onTicketsSnap(snap) {
    var incoming = [];
    snap.forEach(function (d) {
      var t = Object.assign({ id: d.id }, d.data());
      t.fecha = tsToDate(t.fecha);
      incoming.push(t);
    });
    fusionarTickets(incoming);
    renderTicketsList();
  }

  function listenTicketsRecientes() {
    var q = db.collection(COL.tickets).orderBy("fecha", "desc").limit(100);
    q.onSnapshot(onTicketsSnap, function (err) {
      console.warn("[POS] tickets recientes", err);
      watchCol("tickets", db.collection(COL.tickets).limit(200), onTicketsSnap);
    });
  }

  function cargarTodosLosTickets() {
    if (!db || state.ticketsCargando || state.ticketsHistorialCompleto) return Promise.resolve();
    state.ticketsCargando = true;
    pintarEstadoTickets();
    var last = null;
    var paginas = 0;
    function paso() {
      var q = db.collection(COL.tickets).orderBy(firebase.firestore.FieldPath.documentId()).limit(400);
      if (last) q = q.startAfter(last);
      return q.get().then(function (snap) {
        paginas += 1;
        var batch = [];
        snap.forEach(function (d) {
          var t = Object.assign({ id: d.id }, d.data());
          t.fecha = tsToDate(t.fecha);
          batch.push(t);
          last = d;
        });
        if (batch.length) fusionarTickets(batch);
        renderTicketsList();
        if (snap.size < 400 || paginas >= 200) {
          if (snap.size >= 400) {
            toast("El historial es muy grande. Use número, fecha o importe para localizar el resto.", "warning");
          } else {
            state.ticketsHistorialCompleto = true;
          }
          return;
        }
        return paso();
      });
    }
    return paso().catch(function (err) {
      console.error("[POS] historial tickets", err);
      toast("No se pudo cargar todo el historial: " + (err.message || err), "error");
    }).then(function () {
      state.ticketsCargando = false;
      pintarEstadoTickets();
      renderTicketsList();
    });
  }

  function pintarEstadoTickets(filtrados) {
    var el = $("ticketsHistorialEstado");
    if (!el) return;
    var total = state.tickets.length;
    var extra = typeof filtrados === "number" ? " · coincidencias: " + filtrados : "";
    if (state.ticketsCargando) el.textContent = "Cargando historial completo… " + total + " tickets leídos" + extra;
    else if (state.ticketsHistorialCompleto) el.textContent = "Historial completo: " + total + " tickets" + extra;
    else el.textContent = "Historial parcial: " + total + " tickets. La búsqueda también consulta Firebase." + extra;
  }

  function ticketPasaFiltros(t) {
    var general = ($("ticketBuscar") && $("ticketBuscar").value || "").trim().toLowerCase();
    var num = ($("ticketBuscarNumero") && $("ticketBuscarNumero").value || "").trim().toLowerCase();
    var fecha = ($("ticketBuscarFecha") && $("ticketBuscarFecha").value) || "";
    var importeRaw = ($("ticketBuscarImporte") && $("ticketBuscarImporte").value || "").trim();
    if (general) {
      var blob = (String(t.numero) + " " + formatDateTime(t.fecha) + " " + formatDate(t.fecha) + " " + formatMoney(t.total)).toLowerCase();
      if (blob.indexOf(general) < 0) return false;
    }
    if (num && String(t.numero).toLowerCase().indexOf(num) < 0) return false;
    if (fecha && isoFechaLocal(t.fecha) !== fecha) return false;
    if (importeRaw !== "") {
      var esperado = Number(String(importeRaw).replace(",", "."));
      if (!isNaN(esperado) && Math.abs((Number(t.total) || 0) - esperado) > 0.009) return false;
    }
    return true;
  }

  function programarBusquedaServidor() {
    if (buscarTicketTimer) clearTimeout(buscarTicketTimer);
    buscarTicketTimer = setTimeout(buscarTicketsEnServidor, 400);
  }

  function buscarTicketsEnServidor() {
    if (!db) return;
    var jobs = [];
    var numRaw = ($("ticketBuscarNumero") && $("ticketBuscarNumero").value || "").trim();
    if (/^\d+$/.test(numRaw)) {
      jobs.push(db.collection(COL.tickets).where("numero", "==", Number(numRaw)).get());
    }
    var impRaw = ($("ticketBuscarImporte") && $("ticketBuscarImporte").value || "").trim();
    if (impRaw !== "" && !isNaN(Number(impRaw))) {
      jobs.push(db.collection(COL.tickets).where("total", "==", Number(impRaw)).get());
    }
    var fecha = ($("ticketBuscarFecha") && $("ticketBuscarFecha").value) || "";
    if (fecha) {
      var partes = fecha.split("-");
      var desde = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]), 0, 0, 0, 0);
      var hasta = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]), 23, 59, 59, 999);
      jobs.push(db.collection(COL.tickets).where("fecha", ">=", desde).where("fecha", "<=", hasta).get());
    }
    if (!jobs.length) return;
    Promise.all(jobs).then(function (snaps) {
      var incoming = [];
      snaps.forEach(function (snap) {
        snap.forEach(function (d) {
          var t = Object.assign({ id: d.id }, d.data());
          t.fecha = tsToDate(t.fecha);
          incoming.push(t);
        });
      });
      if (incoming.length) fusionarTickets(incoming);
      renderTicketsList();
    }).catch(function (err) {
      console.warn("[POS] búsqueda de tickets", err);
    });
  }

  function alCambiarFiltroTickets() {
    state.ticketPagina = 0;
    renderTicketsList();
    programarBusquedaServidor();
  }

  safeOn("btnBuscarTickets", "click", function () {
    state.ticketPagina = 0;
    renderTicketsList();
    openModal("modalTickets");
    cargarTodosLosTickets();
  });
  safeOn("ticketBuscar", "input", alCambiarFiltroTickets);
  safeOn("ticketBuscarNumero", "input", alCambiarFiltroTickets);
  safeOn("ticketBuscarFecha", "change", alCambiarFiltroTickets);
  safeOn("ticketBuscarImporte", "input", alCambiarFiltroTickets);
  safeOn("ticketPaginaPrev", "click", function () {
    if (state.ticketPagina > 0) state.ticketPagina -= 1;
    renderTicketsList();
  });
  safeOn("ticketPaginaNext", "click", function () {
    state.ticketPagina += 1;
    renderTicketsList();
  });

  function renderTicketsList() {
    var tbody = $("ticketsListBody");
    if (!tbody) return;
    var list = state.tickets.filter(ticketPasaFiltros);
    var pageSize = 100;
    var pages = Math.max(1, Math.ceil(list.length / pageSize));
    if (state.ticketPagina >= pages) state.ticketPagina = pages - 1;
    if (state.ticketPagina < 0) state.ticketPagina = 0;
    var start = state.ticketPagina * pageSize;
    var slice = list.slice(start, start + pageSize);
    pintarEstadoTickets(list.length);
    var info = $("ticketPaginaInfo");
    if (info) {
      info.textContent = list.length
        ? ("Mostrando " + (start + 1) + "-" + (start + slice.length) + " de " + list.length)
        : "Sin resultados";
    }
    if (!slice.length) {
      tbody.innerHTML = '<tr><td colspan="5">Sin tickets</td></tr>';
      return;
    }
    tbody.innerHTML = slice.map(function (t) {
      var estado = ventaEstaCancelada(t) ? "Cancelada" : "Activa";
      return "<tr><td>#" + escapeHtml(String(t.numero != null ? t.numero : "")) + "</td><td>" +
        formatDateTime(t.fecha) + "</td><td>" + formatMoney(t.total) + "</td><td>" + estado +
        "</td><td><button type='button' class='btn btn-sm btn-secondary' data-ver-ticket='" + t.id +
        "'>Detalle</button> <button type='button' class='btn btn-sm btn-secondary' data-reprint='" +
        t.id + "'>Reimprimir</button></td></tr>";
    }).join("");
    tbody.querySelectorAll("[data-reprint]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = state.tickets.find(function (x) { return x.id === btn.getAttribute("data-reprint"); });
        if (t) imprimirTicket(t);
      });
    });
    tbody.querySelectorAll("[data-ver-ticket]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        abrirDetalleTicket(btn.getAttribute("data-ver-ticket"));
      });
    });
  }

  /* ─── CLIENTES ─── */
  let cliFilter = "";
  safeOn("cliBuscar", "input", function (e) {
    cliFilter = e.target.value.toLowerCase();
    renderClientes();
  });

  function fillClienteSelects() {
    const opts = '<option value="">— Contado —</option>' +
      state.clientes.map(function (c) {
        return '<option value="' + c.id + '">' + escapeHtml(c.nombre) + "</option>";
      }).join("");
    $("posCliente").innerHTML = opts.replace("— Contado —", "— Contado —");
    const cotSel = $("cotCliente");
    if (cotSel) {
      cotSel.innerHTML = '<option value="">— General —</option>' +
        state.clientes.map(function (c) {
          return '<option value="' + c.id + '">' + escapeHtml(c.nombre) + "</option>";
        }).join("");
    }
  }

  function renderClientes() {
    let list = state.clientes.slice();
    if (cliFilter) {
      list = list.filter(function (c) {
        return (c.nombre || "").toLowerCase().indexOf(cliFilter) >= 0 ||
          (c.telefono || "").indexOf(cliFilter) >= 0;
      });
    }
    const tbody = $("cliTableBody");
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6">Sin clientes</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (c) {
      return "<tr><td>" + escapeHtml(c.nombre) + "</td><td>" + escapeHtml(c.telefono || "") +
        "</td><td>" + escapeHtml(c.direccion || "") + "</td><td>" + escapeHtml(c.nit || "") +
        "</td><td>" + formatMoney(c.saldoPendiente || 0) + "</td><td>" +
        '<button class="btn btn-sm btn-secondary" data-edit-cli="' + c.id + '">Editar</button> ' +
        '<button class="btn btn-sm btn-primary" data-hist-cli="' + c.id + '">Historial</button></td></tr>';
    }).join("");
    tbody.querySelectorAll("[data-edit-cli]").forEach(function (btn) {
      btn.addEventListener("click", function () { editCliente(btn.getAttribute("data-edit-cli")); });
    });
    tbody.querySelectorAll("[data-hist-cli]").forEach(function (btn) {
      btn.addEventListener("click", function () { verHistorialCliente(btn.getAttribute("data-hist-cli")); });
    });
  }

  safeOn("btnNuevoCliente", "click", function () {
    $("formCliente").reset();
    $("cliId").value = "";
    $("modalClienteTitulo").textContent = "Nuevo cliente";
    openModal("modalCliente");
  });

  function editCliente(id) {
    const c = getCliente(id);
    if (!c) return;
    $("cliId").value = c.id;
    $("cliNombre").value = c.nombre || "";
    $("cliTelefono").value = c.telefono || "";
    $("cliDireccion").value = c.direccion || "";
    $("cliNit").value = c.nit || "";
    $("cliSaldo").value = c.saldoPendiente || 0;
    $("modalClienteTitulo").textContent = "Editar cliente";
    openModal("modalCliente");
  }

  safeOn("formCliente", "submit", function (e) {
    e.preventDefault();
    const data = {
      nombre: $("cliNombre").value.trim(),
      telefono: $("cliTelefono").value.trim(),
      direccion: $("cliDireccion").value.trim(),
      nit: $("cliNit").value.trim(),
      saldoPendiente: parseFloat($("cliSaldo").value) || 0
    };
    const id = $("cliId").value;
    const ref = id ? db.collection(COL.clientes).doc(id) : db.collection(COL.clientes).doc();
    ref.set(data, { merge: true }).then(function () {
      toast("Cliente guardado", "success");
      closeModal("modalCliente");
    }).catch(function (err) { toast("Error: " + err.message, "error"); });
  });

  function pintarHistorialCliente(nombre, ventas) {
    $("historialTitulo").textContent = "Historial: " + nombre;
    var tbody = $("historialBody");
    if (!ventas.length) {
      tbody.innerHTML = '<tr><td colspan="4">Sin compras</td></tr>';
    } else {
      tbody.innerHTML = ventas.map(function (v) {
        var estado = ventaEstaCancelada(v) ? " · cancelada" : "";
        return "<tr><td>" + formatDateTime(v.fecha) + "</td><td>" + formatMoney(v.total) +
          "</td><td>" + escapeHtml(v.tipoPago || "efectivo") + estado + "</td><td>#" +
          escapeHtml(String(v.numeroTicket || "—")) + "</td></tr>";
      }).join("");
    }
    openModal("modalHistorial");
  }

  function verHistorialCliente(id) {
    var c = getCliente(id);
    if (!c) return;
    var locales = state.ventas.filter(function (v) { return v.clienteId === id; });
    pintarHistorialCliente(c.nombre, locales);
    if (!db) return;
    db.collection(COL.ventas).where("clienteId", "==", id).get().then(function (snap) {
      var ventas = [];
      snap.forEach(function (d) { ventas.push(docVenta(d)); });
      ventas.sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });
      pintarHistorialCliente(c.nombre, ventas);
    }).catch(function () { /* la lista local sigue visible */ });
  }

  /* ─── COTIZACIONES ─── */
  let cotProdFilter = "";

  safeOn("btnNuevaCotizacion", "click", function () {
    state.cotItems = [];
    state.cotEditId = null;
    $("cotBuscar").value = "";
    $("modalCotTitulo").textContent = "Nueva cotización";
    renderCotItems();
    renderCotProductos();
    openModal("modalCotizacion");
  });

  safeOn("cotBuscar", "input", function (e) {
    cotProdFilter = e.target.value.toLowerCase();
    renderCotProductos();
  });

  function renderCotProductos() {
    let list = state.productos.slice();
    if (cotProdFilter) {
      list = list.filter(function (p) {
        return (p.nombre || "").toLowerCase().indexOf(cotProdFilter) >= 0 ||
          (p.codigoBarras || "").toLowerCase().indexOf(cotProdFilter) >= 0;
      });
    }
    list = list.slice(0, 30);
    const tbody = $("cotProdList");
    tbody.innerHTML = list.map(function (p) {
      return "<tr><td>" + escapeHtml(p.nombre) + "</td><td>" + formatMoney(p.precioVenta) +
        '</td><td><button class="btn btn-sm btn-primary" data-cot-add="' + p.id + '">+</button></td></tr>';
    }).join("") || '<tr><td colspan="3">Sin productos</td></tr>';
    tbody.querySelectorAll("[data-cot-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const p = getProducto(btn.getAttribute("data-cot-add"));
        if (!p) return;
        const ex = state.cotItems.find(function (x) { return x.productoId === p.id; });
        if (ex) ex.cantidad++;
        else state.cotItems.push({
          productoId: p.id, nombre: p.nombre, cantidad: 1,
          precioUnitario: p.precioVenta || 0
        });
        renderCotItems();
      });
    });
  }

  function renderCotItems() {
    const tbody = $("cotItemsBody");
    let total = 0;
    if (!state.cotItems.length) {
      tbody.innerHTML = '<tr><td colspan="5">Agregue productos</td></tr>';
    } else {
      tbody.innerHTML = state.cotItems.map(function (it, idx) {
        const sub = it.cantidad * it.precioUnitario;
        total += sub;
        return "<tr><td>" + escapeHtml(it.nombre) + "</td><td><input type='number' min='1' value='" +
          it.cantidad + "' data-cot-qty='" + idx + "' style='width:60px'></td><td><input type='number' step='0.01' value='" +
          it.precioUnitario.toFixed(2) + "' data-cot-precio='" + idx + "' style='width:80px'></td><td>" +
          formatMoney(sub) + "</td><td><button class='btn btn-sm btn-danger' data-cot-rm='" + idx + "'>×</button></td></tr>";
      }).join("");
      tbody.querySelectorAll("[data-cot-qty]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          state.cotItems[parseInt(inp.getAttribute("data-cot-qty"), 10)].cantidad = Math.max(1, parseInt(inp.value, 10) || 1);
          renderCotItems();
        });
      });
      tbody.querySelectorAll("[data-cot-precio]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          state.cotItems[parseInt(inp.getAttribute("data-cot-precio"), 10)].precioUnitario = parseFloat(inp.value) || 0;
          renderCotItems();
        });
      });
      tbody.querySelectorAll("[data-cot-rm]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.cotItems.splice(parseInt(btn.getAttribute("data-cot-rm"), 10), 1);
          renderCotItems();
        });
      });
    }
    $("cotTotal").textContent = formatMoney(total);
  }

  safeOn("btnGuardarCot", "click", function () {
    if (!state.cotItems.length) { toast("Agregue productos", "warning"); return; }
    let total = 0;
    const items = state.cotItems.map(function (it) {
      const sub = it.cantidad * it.precioUnitario;
      total += sub;
      return Object.assign({}, it, { subtotal: sub });
    });
    const numero = state.cotCounter + 1;
    const data = {
      numero: numero,
      items: items,
      total: total,
      clienteId: $("cotCliente").value || null,
      clienteNombre: $("cotCliente").value ? nombreCliente($("cotCliente").value) : "General",
      estado: "pendiente",
      fecha: firebase.firestore.FieldValue.serverTimestamp()
    };
    db.collection(COL.cotizaciones).add(data).then(function () {
      toast("Cotización #" + numero + " guardada", "success");
      closeModal("modalCotizacion");
    }).catch(function (err) { toast("Error: " + err.message, "error"); });
  });

  safeOn("btnImprimirCot", "click", imprimirCotizacionPDF);

  function imprimirCotizacionPDF() {
    if (!state.cotItems.length) { toast("Sin items", "warning"); return; }
    let total = 0;
    let rows = "";
    state.cotItems.forEach(function (it) {
      const sub = it.cantidad * it.precioUnitario;
      total += sub;
      rows += "<tr><td>" + escapeHtml(it.nombre) + "</td><td>" + it.cantidad +
        "</td><td>" + formatMoney(it.precioUnitario) + "</td><td>" + formatMoney(sub) + "</td></tr>";
    });
    const cliente = $("cotCliente").value ? nombreCliente($("cotCliente").value) : "General";
    const el = $("cotizacion-print");
    el.innerHTML =
      "<h2 style='text-align:center'>FERRETERÍA Y VENTAS DE MATERIALES MACHAQUILA</h2>" +
      "<h3 style='text-align:center'>COTIZACIÓN</h3><p>Cliente: " + escapeHtml(cliente) +
      "</p><p>Fecha: " + formatDateTime(new Date()) + "</p>" +
      "<table style='width:100%;border-collapse:collapse' border='1'>" +
      "<thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>" +
      "<p style='text-align:right;font-size:16px;margin-top:20px'><strong>TOTAL: " + formatMoney(total) + "</strong></p>";
    el.classList.add("show");
    window.print();
    setTimeout(function () { el.classList.remove("show"); }, 500);
  }

  function renderCotizaciones() {
    const tbody = $("cotTableBody");
    if (!state.cotizaciones.length) {
      tbody.innerHTML = '<tr><td colspan="6">Sin cotizaciones</td></tr>';
      return;
    }
    tbody.innerHTML = state.cotizaciones.map(function (c) {
      const badge = c.estado === "convertida" ? "badge-success" : "badge-warning";
      return "<tr><td>#" + c.numero + "</td><td>" + formatDateTime(c.fecha) +
        "</td><td>" + escapeHtml(c.clienteNombre || "") + "</td><td>" + formatMoney(c.total) +
        "</td><td><span class='badge " + badge + "'>" + (c.estado || "pendiente") + "</span></td><td>" +
        (c.estado !== "convertida" ?
          '<button class="btn btn-sm btn-success" data-convert-cot="' + c.id + '">A venta</button> ' : "") +
        '<button class="btn btn-sm btn-secondary" data-print-cot="' + c.id + '">Imprimir</button></td></tr>';
    }).join("");
    tbody.querySelectorAll("[data-convert-cot]").forEach(function (btn) {
      btn.addEventListener("click", function () { convertirCotAVenta(btn.getAttribute("data-convert-cot")); });
    });
    tbody.querySelectorAll("[data-print-cot]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const c = state.cotizaciones.find(function (x) { return x.id === btn.getAttribute("data-print-cot"); });
        if (c) {
          state.cotItems = (c.items || []).map(function (it) { return Object.assign({}, it); });
          imprimirCotizacionPDF();
        }
      });
    });
  }

  function convertirCotAVenta(cotId) {
    const cot = state.cotizaciones.find(function (c) { return c.id === cotId; });
    if (!cot || !cot.items) return;
    if (!state.cajaActual) {
      toast("Abra la caja primero", "error");
      return;
    }
    state.carrito = cot.items.map(function (it) {
      const p = getProducto(it.productoId);
      return {
        productoId: it.productoId,
        nombre: it.nombre,
        cantidad: it.cantidad,
        precioUnitario: it.precioUnitario,
        precioCosto: p ? p.precioCosto : 0,
        precioMinimo: p ? p.precioMinimo : 0
      };
    });
    if (cot.clienteId) $("posCliente").value = cot.clienteId;
    showSection("ventas");
    renderCarrito();
    db.collection(COL.cotizaciones).doc(cotId).update({ estado: "convertida" });
    toast("Cotización cargada al carrito", "success");
  }

  /* ─── CAJA ─── */
  function renderCaja() {
    const abierta = state.cajaActual && isCajaAbierta(state.cajaActual) ? state.cajaActual : null;

    var btnAbrir = $("btnAbrirCaja");
    var btnCerrar = $("btnCerrarCaja");
    var panelCerrada = $("cajaCerradaPanel");
    var panelAbierta = $("cajaAbiertaPanel");
    if (btnAbrir) btnAbrir.style.display = abierta ? "none" : "inline-flex";
    if (btnCerrar) btnCerrar.style.display = abierta ? "inline-flex" : "none";
    if (panelCerrada) panelCerrada.style.display = abierta ? "none" : "block";
    if (panelAbierta) panelAbierta.style.display = abierta ? "block" : "none";
    $("cajaEstadoTitulo").textContent = abierta ? "Caja abierta" : "Caja cerrada";

    const resumen = calcResumenCaja(abierta);
    $("cajaStats").innerHTML =
      statCard("Saldo inicial", abierta ? formatMoney(resumen.inicial) : "—", "") +
      statCard("Ventas del día", abierta ? formatMoney(resumen.ventas) : "—", "success") +
      statCard("Gastos", abierta ? formatMoney(resumen.gastos) : "—", "") +
      statCard("Retiros", abierta ? formatMoney(resumen.retiros) : "—", "") +
      statCard("Efectivo esperado", abierta ? formatMoney(resumen.esperado) : "—", "accent");

    if (abierta && abierta.usuarioApertura) {
      $("cajaEstadoTitulo").textContent = "Caja abierta · " + abierta.usuarioApertura;
    }

    const cortes = state.cajas.filter(function (c) { return !isCajaAbierta(c); }).slice(0, 20);
    $("cortesBody").innerHTML = cortes.length ? cortes.map(function (c) {
      return "<tr><td>" + formatDateTime(c.fechaApertura) + "</td><td>" +
        formatDateTime(c.fechaCierre) + "</td><td>" + formatMoney(c.montoInicial) +
        "</td><td>" + formatMoney(c.montoCierre) + "</td><td>" + formatMoney(c.totalVentas || 0) + "</td></tr>";
    }).join("") : '<tr><td colspan="5">Sin cortes</td></tr>';
  }

  function renderMovimientos() {
    const tbody = $("movimientosBody");
    let movs = state.movimientos.slice();
    if (state.cajaActual) {
      movs = movs.filter(function (m) {
        return m.cajaId === state.cajaActual.id &&
          m.fecha >= state.cajaActual.fechaApertura;
      });
    }
    if (!movs.length) {
      tbody.innerHTML = '<tr><td colspan="4">Sin movimientos</td></tr>';
      return;
    }
    tbody.innerHTML = movs.map(function (m) {
      var esSalida = m.tipo === "gasto" || m.tipo === "retiro" || (m.tipo === "cancelacion" && (Number(m.monto) || 0) > 0);
      const sign = esSalida ? "-" : (m.tipo === "cancelacion" ? "" : "+");
      return "<tr><td>" + formatDateTime(m.fecha) + "</td><td>" + m.tipo +
        "</td><td>" + escapeHtml(m.descripcion || "") + "</td><td>" + sign + formatMoney(m.monto) + "</td></tr>";
    }).join("");
  }

  safeOn("btnAbrirCaja", "click", function () {
    if (!ensureDb()) return;
    if (state.cajaActual && isCajaAbierta(state.cajaActual)) {
      toast("Ya hay caja abierta", "warning");
      return;
    }
    $("formAperturaCaja").reset();
    $("cajaMontoInicial").value = "0";
    $("cajaObservacion").value = "";
    openModal("modalAperturaCaja");
    setTimeout(function () {
      var monto = $("cajaMontoInicial");
      if (monto) monto.focus();
    }, 50);
  });

  safeOn("formAperturaCaja", "submit", function (e) {
    e.preventDefault();
    if (!guardiaApertura.intentar()) {
      toast("La apertura ya se está procesando", "warning");
      return;
    }
    if (!ensureDb()) {
      guardiaApertura.liberar();
      return;
    }
    if (state.cajaActual && isCajaAbierta(state.cajaActual)) {
      toast("Ya hay caja abierta", "warning");
      guardiaApertura.liberar();
      return;
    }
    const monto = parseFloat($("cajaMontoInicial").value) || 0;
    const observacion = ($("cajaObservacion").value || "").trim();
    const usuario = nombreUsuarioCaja();
    const descMov = observacion ? "Apertura de caja: " + observacion : "Apertura de caja";

    db.collection(COL.caja).add({
      montoInicial: monto,
      abierta: true,
      estado: "abierta",
      fechaApertura: firebase.firestore.FieldValue.serverTimestamp(),
      usuarioApertura: usuario,
      observacion: observacion,
      totalVentas: 0
    }).then(function (ref) {
      return db.collection(COL.movimientosCaja).add({
        tipo: "apertura",
        monto: monto,
        descripcion: descMov,
        observacion: observacion,
        usuario: usuario,
        cajaId: ref.id,
        fecha: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function () { return ref; });
    }).then(function () {
      toast("Caja abierta", "success");
      closeModal("modalAperturaCaja");
    }).catch(function (err) {
      toast("Error al abrir caja: " + err.message, "error");
    }).then(function () {
      guardiaApertura.liberar();
    });
  });

  safeOn("btnGasto", "click", function () {
    if (!state.cajaActual) return;
    $("movTipo").value = "gasto";
    $("modalMovTitulo").textContent = "Registrar gasto";
    $("formMovimiento").reset();
    openModal("modalMovimiento");
  });

  safeOn("btnRetiro", "click", function () {
    if (!state.cajaActual) return;
    $("movTipo").value = "retiro";
    $("modalMovTitulo").textContent = "Retiro de efectivo";
    $("formMovimiento").reset();
    openModal("modalMovimiento");
  });

  safeOn("formMovimiento", "submit", function (e) {
    e.preventDefault();
    if (!guardiaMovimiento.intentar()) {
      toast("El movimiento ya se está procesando", "warning");
      return;
    }
    if (!state.cajaActual) {
      guardiaMovimiento.liberar();
      return;
    }
    const tipo = $("movTipo").value;
    const monto = parseFloat($("movMonto").value) || 0;
    const desc = $("movDescripcion").value.trim();
    const batch = db.batch();
    const movRef = db.collection(COL.movimientosCaja).doc();
    batch.set(movRef, {
      tipo: tipo,
      monto: monto,
      descripcion: desc,
      cajaId: state.cajaActual.id,
      fecha: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (tipo === "gasto") {
      const gastoRef = db.collection(COL.gastos).doc();
      batch.set(gastoRef, {
        monto: monto,
        descripcion: desc,
        cajaId: state.cajaActual.id,
        fecha: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    batch.commit().then(function () {
      toast("Movimiento registrado", "success");
      closeModal("modalMovimiento");
    }).catch(function (err) {
      toast("Error al registrar: " + (err.message || err), "error");
    }).then(function () {
      guardiaMovimiento.liberar();
    });
  });

  safeOn("btnCerrarCaja", "click", function () {
    if (!state.cajaActual) return;
    const esperado = calcEfectivoCaja(state.cajaActual);
    $("cierreEsperado").textContent = formatMoney(esperado);
    $("cierreContado").value = esperado.toFixed(2);
    $("cierreDiferencia").textContent = "";
    openModal("modalCierre");
  });

  safeOn("cierreContado", "input", function () {
    const esperado = calcEfectivoCaja(state.cajaActual);
    const contado = parseFloat($("cierreContado").value) || 0;
    const diff = contado - esperado;
    $("cierreDiferencia").textContent = "Diferencia: " + formatMoney(diff) +
      (diff === 0 ? " (cuadra)" : diff > 0 ? " (sobrante)" : " (faltante)");
  });

  safeOn("formCierre", "submit", function (e) {
    e.preventDefault();
    if (!guardiaCierre.intentar()) {
      toast("El cierre ya se está procesando", "warning");
      return;
    }
    if (!state.cajaActual) {
      guardiaCierre.liberar();
      return;
    }
    const caja = state.cajaActual;
    const contado = parseFloat($("cierreContado").value) || 0;
    const esperado = calcEfectivoCaja(caja);
    const ventasCaja = state.ventas.filter(function (v) {
      return ventaCuentaEnTotales(v) && v.cajaId === caja.id && v.fecha >= caja.fechaApertura;
    }).reduce(function (s, v) { return s + (v.total || 0); }, 0);

    db.collection(COL.caja).doc(caja.id).update({
      abierta: false,
      estado: "cerrada",
      montoCierre: contado,
      efectivoEsperado: esperado,
      diferencia: contado - esperado,
      totalVentas: ventasCaja,
      usuarioCierre: nombreUsuarioCaja(),
      fechaCierre: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      db.collection(COL.movimientosCaja).add({
        tipo: "cierre",
        monto: contado,
        descripcion: "Cierre de caja",
        cajaId: caja.id,
        fecha: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast("Caja cerrada", "success");
      closeModal("modalCierre");
    }).catch(function (err) {
      toast("Error al cerrar caja: " + (err.message || err), "error");
    }).then(function () {
      guardiaCierre.liberar();
    });
  });

  function usuarioActual() {
    return {
      nombre: nombreUsuarioCaja(),
      uid: typeof window.posGetUid === "function" ? window.posGetUid() : ""
    };
  }

  function docVenta(d) {
    var v = Object.assign({ id: d.id }, d.data());
    v.fecha = tsToDate(v.fecha);
    v.fechaCancelacion = tsToDate(v.fechaCancelacion);
    return v;
  }

  function idsUnicos(lista) {
    var visto = {};
    var out = [];
    (lista || []).forEach(function (id) {
      if (!id || visto[id]) return;
      visto[id] = true;
      out.push(id);
    });
    return out;
  }

  function cargarPaqueteVenta(ventaId) {
    return db.collection(COL.ventas).doc(ventaId).get().then(function (snap) {
      if (!snap.exists) throw new Error("Venta no encontrada. No se modificó nada.");
      var venta = docVenta(snap);
      var otrasP = (venta.numeroTicket != null && venta.numeroTicket !== "")
        ? db.collection(COL.ventas).where("numeroTicket", "==", venta.numeroTicket).get()
        : Promise.resolve(null);
      return otrasP.then(function (otrasSnap) {
        var otras = [];
        if (otrasSnap) otrasSnap.forEach(function (d) { otras.push(docVenta(d)); });
        var ids = idsUnicos(otras.map(function (o) { return o.id; }).concat([venta.id]));
        return Promise.all(ids.map(function (id) {
          return db.collection(COL.movimientosCaja).where("ventaId", "==", id).get();
        })).then(function (movSnaps) {
          var movs = [];
          movSnaps.forEach(function (s) {
            s.forEach(function (doc) { movs.push(Object.assign({ id: doc.id }, doc.data())); });
          });
          return Promise.all(ids.map(function (id) {
            return db.collection(COL.tickets).where("ventaId", "==", id).get();
          })).then(function (ticketSnaps) {
            var ticketIds = [];
            ticketSnaps.forEach(function (s) {
              s.forEach(function (doc) { ticketIds.push(doc.id); });
            });
            return { venta: venta, otras: otras, movimientos: movs, ticketIds: idsUnicos(ticketIds.concat(ids)) };
          });
        });
      });
    });
  }

  function pintarDetalleVenta() {
    var body = $("detalleVentaBody");
    var pack = state.detalleActual;
    if (!body || !pack) return;
    var t = pack.ticket || {};
    var v = pack.venta;
    var items = (v && v.items && v.items.length) ? v.items : (t.items || []);
    var cancelada = ventaEstaCancelada(v || t);
    if ($("detalleVentaTitulo")) {
      $("detalleVentaTitulo").textContent = "Ticket #" + (t.numero != null ? t.numero : (v && v.numeroTicket != null ? v.numeroTicket : "—"));
    }
    var rows = items.map(function (it) {
      var sub = it.subtotal != null ? it.subtotal : (Number(it.cantidad) || 0) * (Number(it.precioUnitario) || 0);
      return "<tr><td>" + escapeHtml(it.nombre || "") + "</td><td>" + (it.cantidad || 0) +
        "</td><td>" + formatMoney(it.precioUnitario) + "</td><td>" + formatMoney(sub) + "</td></tr>";
    }).join("");
    var extra = "";
    if (v && v.motivoCancelacion) extra += "<p><strong>Motivo:</strong> " + escapeHtml(v.motivoCancelacion) + "</p>";
    if (v && v.usuarioCancelacion) {
      extra += "<p><strong>Canceló:</strong> " + escapeHtml(v.usuarioCancelacion) +
        (v.fechaCancelacion ? " · " + formatDateTime(v.fechaCancelacion) : "") + "</p>";
    }
    if (v && cancelada && v.devolucionInventario && v.productosDevueltos && v.productosDevueltos.length) {
      extra += "<p><strong>Devuelto al inventario:</strong></p><ul>" + v.productosDevueltos.map(function (l) {
        return "<li>" + escapeHtml(l.nombre || l.productoId || "") + " · " + l.cantidad + "</li>";
      }).join("") + "</ul>";
    } else if (v && cancelada) {
      extra += "<p><strong>Inventario:</strong> esta cancelación no volvió a sumar existencias.</p>";
    }
    if (v && cancelada && v.tipoPago === "efectivo") {
      extra += "<p><strong>Caja:</strong> la venta deja de sumar " + formatMoney(v.ajusteCaja != null ? v.ajusteCaja : v.total) +
        ". El cobro original se conserva. El movimiento de cancelación queda como respaldo y no se resta otra vez.</p>";
    }
    if (v && cancelada && v.tipoPago === "fiado") {
      extra += "<p><strong>Fiado:</strong> el saldo del cliente baja una sola vez cuando esta venta aplicó la devolución.</p>";
    }
    if (!v) extra += "<p>No se encontró la venta ligada a este ticket. No se puede cancelar sin ese registro.</p>";
    body.innerHTML =
      "<p><strong>Fecha de venta:</strong> " + formatDateTime((v && v.fecha) || t.fecha) + "</p>" +
      "<p><strong>Total:</strong> " + formatMoney(v && v.total != null ? v.total : t.total) + "</p>" +
      "<p><strong>Pago:</strong> " + escapeHtml(ticketTipoPagoLabel((v && v.tipoPago) || t.tipoPago)) + "</p>" +
      "<p><strong>Estado:</strong> " + (cancelada ? "Cancelada" : "Activa") + "</p>" + extra +
      "<div class='table-wrap'><table class='data-table'><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Sub</th></tr></thead><tbody>" +
      (rows || "<tr><td colspan='4'>Sin productos</td></tr>") + "</tbody></table></div>";
    var btnCancel = $("btnAbrirCancelarVenta");
    if (btnCancel) btnCancel.style.display = (v && !cancelada) ? "" : "none";
  }

  function abrirDetalleTicket(ticketId) {
    var ticket = state.tickets.find(function (t) { return t.id === ticketId; });
    if (!ticket || !db) {
      toast("No se encontró el ticket", "error");
      return;
    }
    state.detalleActual = { ticket: ticket, venta: null, otras: [], movimientos: [] };
    pintarDetalleVenta();
    openModal("modalDetalleVenta");
    var prom = ticket.ventaId
      ? Promise.resolve(ticket.ventaId)
      : db.collection(COL.ventas).where("numeroTicket", "==", ticket.numero).limit(1).get().then(function (snap) {
        var id = null;
        snap.forEach(function (d) { if (!id) id = d.id; });
        return id;
      });
    prom.then(function (ventaId) {
      if (!ventaId) return null;
      return cargarPaqueteVenta(ventaId);
    }).then(function (pack) {
      if (!pack) return;
      pack.ticket = ticket;
      state.detalleActual = pack;
      state.cancelacionObjetivoId = pack.venta.id;
      pintarDetalleVenta();
    }).catch(function (err) {
      toast("No se pudo leer la venta: " + (err.message || err), "error");
    });
  }

  function abrirModalCancelar() {
    var pack = state.detalleActual;
    if (!pack || !pack.venta) {
      toast("No hay una venta para cancelar", "error");
      return;
    }
    if (ventaEstaCancelada(pack.venta)) {
      toast("Esta venta ya está cancelada", "warning");
      return;
    }
    state.cancelacionObjetivoId = pack.venta.id;
    var plan = evaluarCancelacion(pack.venta, pack.otras || [], pack.movimientos || [], {});
    $("cancelTicketNum").textContent = "#" + (pack.venta.numeroTicket != null ? pack.venta.numeroTicket : "—");
    $("cancelTicketTotal").textContent = formatMoney(pack.venta.total);
    $("cancelMotivo").value = "";
    if ($("cancelConfirmarDuplicado")) $("cancelConfirmarDuplicado").checked = false;
    var box = $("cancelDuplicadoBox");
    var aviso = $("cancelAviso");
    var btn = $("btnConfirmarCancelar");
    if (plan.codigo === "duplicado") {
      if (box) box.style.display = "block";
      if (aviso) aviso.textContent = plan.mensaje + " Si confirma, el inventario se devuelve una sola vez y cada copia deja de sumarse en caja.";
      if (btn) btn.disabled = false;
    } else if (!plan.ok) {
      if (box) box.style.display = "none";
      if (aviso) aviso.textContent = plan.mensaje;
      if (btn) btn.disabled = true;
    } else {
      if (box) box.style.display = "none";
      if (aviso) aviso.textContent = "Se conservará el número de ticket. La venta pasará a CANCELADA y el inventario de sus productos volverá una sola vez. Si fue en efectivo, dejará de sumarse en caja. El movimiento original no se borra.";
      if (btn) btn.disabled = false;
    }
    openModal("modalCancelarVenta");
  }

  function marcarLocalCancelado(ventas, motivo, usuario) {
    var set = {};
    ventas.forEach(function (v) { set[v.id] = v; });
    state.ventas.forEach(function (v) {
      if (!set[v.id]) return;
      v.estado = "CANCELADA";
      v.cancelada = true;
      v.motivoCancelacion = motivo;
      v.usuarioCancelacion = usuario;
      v.fechaCancelacion = new Date();
      v.ajusteCaja = v.tipoPago === "efectivo" ? (Number(v.total) || 0) : 0;
    });
    state.tickets.forEach(function (t) {
      if (set[t.ventaId] || set[t.id]) {
        t.estado = "CANCELADA";
        t.cancelada = true;
      }
    });
    fusionarMovimientos(ventas.map(function (v) {
      return {
        id: "cancel_" + v.id,
        tipo: "cancelacion",
        esReversion: true,
        afectaCalculoCaja: false,
        monto: v.tipoPago === "efectivo" ? (Number(v.total) || 0) : 0,
        descripcion: "Cancelación ticket #" + (v.numeroTicket != null ? v.numeroTicket : "—"),
        cajaId: v.cajaId || null,
        ventaId: v.id,
        fecha: new Date(),
        usuario: usuario,
        motivo: motivo
      };
    }));
    renderTicketsList();
    renderDashboard();
    renderContable();
    renderCaja();
    renderMovimientos();
  }

  function ejecutarCancelacion(ventaId, motivo, confirmarDuplicado) {
    if (!guardiaCancelacion.intentar()) {
      toast("La cancelación ya se está procesando", "warning");
      return;
    }
    var btn = $("btnConfirmarCancelar");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Procesando...";
    }
    var usuario = usuarioActual();
    var ventasTocadas = [];

    cargarPaqueteVenta(ventaId).then(function (pack) {
      var plan = evaluarCancelacion(pack.venta, pack.otras, pack.movimientos, { confirmarDuplicado: !!confirmarDuplicado });
      if (!plan.ok) throw new Error(plan.mensaje);
      var idsGrupo = idsUnicos((pack.otras || []).map(function (o) { return o.id; }).concat([pack.venta.id]));
      var ticketIds = idsUnicos(pack.ticketIds || []);
      var lineas = plan.lineas;

      return db.runTransaction(function (tx) {
        var ventaRefs = idsGrupo.map(function (id) { return db.collection(COL.ventas).doc(id); });
        var movRefs = idsGrupo.map(function (id) { return db.collection(COL.movimientosCaja).doc("cancel_" + id); });
        var prodRefs = lineas.map(function (l) { return db.collection(COL.productos).doc(l.productoId); });
        var ticketRefs = ticketIds.map(function (id) { return db.collection(COL.tickets).doc(id); });
        var cliRef = (pack.venta.tipoPago === "fiado" && pack.venta.clienteId)
          ? db.collection(COL.clientes).doc(pack.venta.clienteId) : null;
        function leer(refs) { return Promise.all(refs.map(function (ref) { return tx.get(ref); })); }

        return leer(ventaRefs).then(function (ventaSnaps) {
          return leer(movRefs).then(function (movSnaps) {
            return leer(prodRefs).then(function (prodSnaps) {
              return leer(ticketRefs).then(function (ticketSnaps) {
                return (cliRef ? tx.get(cliRef) : Promise.resolve(null)).then(function (cliSnap) {
                  var frescas = ventaSnaps.filter(function (s) { return s.exists; }).map(docVenta);
                  var principal = null;
                  frescas.forEach(function (v) { if (v.id === ventaId) principal = v; });
                  if (!principal) throw new Error("La venta ya no está disponible. No se modificó nada.");
                  var idxPrincipal = idsGrupo.indexOf(principal.id);
                  var movsPrincipal = (pack.movimientos || []).filter(function (m) { return m.ventaId === principal.id; });
                  if (idxPrincipal >= 0 && movSnaps[idxPrincipal] && movSnaps[idxPrincipal].exists) {
                    movsPrincipal.push({ tipo: "cancelacion", esReversion: true, ventaId: principal.id });
                  }
                  var plan2 = evaluarCancelacion(principal, frescas, movsPrincipal, { confirmarDuplicado: !!confirmarDuplicado });
                  if (!plan2.ok) throw new Error(plan2.mensaje);
                  var devolver = plan2.revertirInventario;
                  if (devolver) {
                    for (var i = 0; i < prodSnaps.length; i++) {
                      if (!prodSnaps[i].exists) {
                        throw new Error("No se encontró el producto " + lineas[i].nombre + ". No se canceló nada ni se tocó el inventario.");
                      }
                    }
                    if (plan2.tipoPago === "fiado" && (!cliSnap || !cliSnap.exists)) {
                      throw new Error("No se encontró el cliente del fiado. No se canceló la venta.");
                    }
                  }
                  var activas = {};
                  plan2.grupo.forEach(function (v) { activas[v.id] = v; });
                  ventasTocadas = plan2.grupo.slice();
                  if (devolver) {
                    for (var j = 0; j < prodRefs.length; j++) {
                      tx.update(prodRefs[j], { stock: firebase.firestore.FieldValue.increment(lineas[j].cantidad) });
                    }
                  }
                  idsGrupo.forEach(function (id, idx) {
                    var v = activas[id];
                    if (!v) return;
                    if (movSnaps[idx] && movSnaps[idx].exists) {
                      throw new Error("Ya existe una reversión de esta venta. No se procesó de nuevo.");
                    }
                    var aplicaInventario = devolver && id === plan2.principalId;
                    tx.update(ventaRefs[idx], {
                      estado: "CANCELADA",
                      cancelada: true,
                      fechaCancelacion: firebase.firestore.FieldValue.serverTimestamp(),
                      usuarioCancelacion: usuario.nombre,
                      usuarioCancelacionId: usuario.uid,
                      motivoCancelacion: motivo,
                      productosDevueltos: aplicaInventario ? lineas : [],
                      devolucionInventario: aplicaInventario,
                      ajusteCaja: v.tipoPago === "efectivo" ? (Number(v.total) || 0) : 0,
                      movimientoCancelacionId: "cancel_" + id,
                      cancelacionGrupo: Object.keys(activas)
                    });
                    tx.set(movRefs[idx], {
                      tipo: "cancelacion",
                      esReversion: true,
                      afectaCalculoCaja: false,
                      monto: v.tipoPago === "efectivo" ? (Number(v.total) || 0) : 0,
                      descripcion: "Cancelación ticket #" + (v.numeroTicket != null ? v.numeroTicket : "—") + " — " + motivo,
                      cajaId: v.cajaId || null,
                      ventaId: id,
                      operacionId: "cancel_" + plan2.principalId,
                      usuario: usuario.nombre,
                      usuarioId: usuario.uid,
                      motivo: motivo,
                      productosDevueltos: aplicaInventario ? lineas : [],
                      fecha: firebase.firestore.FieldValue.serverTimestamp()
                    });
                  });
                  ticketSnaps.forEach(function (tsSnap, tIdx) {
                    if (!tsSnap.exists) return;
                    var data = tsSnap.data() || {};
                    var ligado = data.ventaId || ticketIds[tIdx];
                    if (!activas[ligado] && !activas[ticketIds[tIdx]]) return;
                    tx.update(ticketRefs[tIdx], {
                      estado: "CANCELADA",
                      cancelada: true,
                      fechaCancelacion: firebase.firestore.FieldValue.serverTimestamp()
                    });
                  });
                  if (devolver && plan2.tipoPago === "fiado" && cliRef) {
                    tx.update(cliRef, {
                      saldoPendiente: firebase.firestore.FieldValue.increment(-(Number(principal.total) || 0))
                    });
                  }
                });
              });
            });
          });
        });
      });
    }).then(function () {
      marcarLocalCancelado(ventasTocadas, motivo, usuario.nombre);
      toast("Venta cancelada. El ticket original se conservó.", "success");
      closeModal("modalCancelarVenta");
      closeModal("modalDetalleVenta");
      if (document.getElementById("cancelaciones") && document.getElementById("cancelaciones").classList.contains("active")) {
        cargarCancelaciones();
      }
    }).catch(function (err) {
      toast(err && err.message ? err.message : "No se pudo cancelar", "error");
    }).then(function () {
      guardiaCancelacion.liberar();
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Confirmar cancelación";
      }
    });
  }

  safeOn("btnReimprimirDetalle", "click", function () {
    var pack = state.detalleActual;
    var base = pack && (pack.venta || pack.ticket);
    if (!base) return;
    imprimirTicket({
      numero: base.numero != null ? base.numero : base.numeroTicket,
      items: base.items || [],
      total: base.total,
      tipoPago: base.tipoPago,
      clienteNombre: base.clienteNombre || "",
      efectivoRecibido: base.efectivoRecibido,
      vuelto: base.vuelto,
      fecha: base.fecha,
      cajeroNombre: base.cajeroNombre
    });
  });
  safeOn("btnAbrirCancelarVenta", "click", abrirModalCancelar);
  safeOn("formCancelarVenta", "submit", function (e) {
    e.preventDefault();
    if (!state.cancelacionObjetivoId) return;
    var motivo = ($("cancelMotivo") && $("cancelMotivo").value || "").trim();
    if (!motivo) {
      toast("Escriba el motivo de la cancelación", "warning");
      return;
    }
    if (motivo.length > 500) motivo = motivo.slice(0, 500);
    var necesitaDup = $("cancelDuplicadoBox") && $("cancelDuplicadoBox").style.display !== "none";
    var confirmado = $("cancelConfirmarDuplicado") && $("cancelConfirmarDuplicado").checked;
    if (necesitaDup && !confirmado) {
      toast("Marque la confirmación del duplicado o cierre sin cancelar. No se modificó nada.", "warning");
      return;
    }
    if ($("btnConfirmarCancelar") && $("btnConfirmarCancelar").disabled) return;
    ejecutarCancelacion(state.cancelacionObjetivoId, motivo, !!confirmado);
  });

  function renderCancelaciones() {
    var tbody = $("cancelacionesBody");
    var el = $("cancelacionesEstado");
    if (!tbody) return;
    var q = ($("cancelBuscarTicket") && $("cancelBuscarTicket").value || "").trim().toLowerCase();
    var desde = ($("cancelFechaDesde") && $("cancelFechaDesde").value) || "";
    var hasta = ($("cancelFechaHasta") && $("cancelFechaHasta").value) || "";
    var list = (state.cancelaciones || []).filter(function (v) {
      if (q && String(v.numeroTicket).toLowerCase().indexOf(q) < 0) return false;
      var fecha = isoFechaLocal(v.fechaCancelacion || v.fecha);
      if ((desde || hasta) && !fecha) return false;
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
      return true;
    });
    if (el) {
      el.textContent = "Registros de cancelación: " + (state.cancelaciones || []).length +
        (list.length !== (state.cancelaciones || []).length ? " · mostrados: " + list.length : "");
    }
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7">Sin cancelaciones</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (v) {
      return "<tr><td>#" + escapeHtml(String(v.numeroTicket != null ? v.numeroTicket : "—")) +
        "</td><td>" + formatDateTime(v.fecha) + "</td><td>" + formatDateTime(v.fechaCancelacion) +
        "</td><td>" + formatMoney(v.total) + "</td><td>" + escapeHtml(v.motivoCancelacion || "") +
        "</td><td>" + escapeHtml(v.usuarioCancelacion || "") +
        "</td><td><button type='button' class='btn btn-sm btn-secondary' data-ver-cancel='" + v.id +
        "'>Detalle</button></td></tr>";
    }).join("");
    tbody.querySelectorAll("[data-ver-cancel]").forEach(function (b) {
      b.addEventListener("click", function () { verDetalleCancelacion(b.getAttribute("data-ver-cancel")); });
    });
  }

  function cargarCancelaciones() {
    var el = $("cancelacionesEstado");
    if (!db) {
      if (el) el.textContent = "Firebase no está conectado.";
      return;
    }
    if (el) el.textContent = "Consultando cancelaciones…";
    db.collection(COL.ventas).where("estado", "==", "CANCELADA").get().then(function (snap) {
      state.cancelaciones = [];
      snap.forEach(function (d) { state.cancelaciones.push(docVenta(d)); });
      state.cancelaciones.sort(function (a, b) { return (b.fechaCancelacion || 0) - (a.fechaCancelacion || 0); });
      renderCancelaciones();
    }).catch(function (err) {
      if (el) el.textContent = "No se pudo consultar: " + (err.message || err);
    });
  }

  function verDetalleCancelacion(ventaId) {
    var v = (state.cancelaciones || []).find(function (x) { return x.id === ventaId; });
    if (!v) return;
    state.cancelacionObjetivoId = v.id;
    state.detalleActual = {
      ticket: {
        id: v.id, ventaId: v.id, numero: v.numeroTicket, fecha: v.fecha, total: v.total,
        tipoPago: v.tipoPago, items: v.items || [], estado: "CANCELADA", cancelada: true
      },
      venta: v, otras: [], movimientos: []
    };
    pintarDetalleVenta();
    openModal("modalDetalleVenta");
    cargarPaqueteVenta(v.id).then(function (pack) {
      pack.ticket = state.detalleActual.ticket;
      state.detalleActual = pack;
      pintarDetalleVenta();
    }).catch(function (err) { toast(err.message || String(err), "error"); });
  }

  safeOn("cancelBuscarTicket", "input", renderCancelaciones);
  safeOn("cancelFechaDesde", "change", renderCancelaciones);
  safeOn("cancelFechaHasta", "change", renderCancelaciones);

  function connectFirebase() {
    if (firebaseConnectTimeout) clearTimeout(firebaseConnectTimeout);
    firebaseConnectTimeout = setTimeout(function () {
      var st = document.getElementById("firebaseStatus");
      if (st && st.textContent.indexOf("Conectando") !== -1) {
        setFirebaseStatus("warn", "Sin respuesta · interfaz activa");
        console.warn("[POS] Timeout Firebase — sigue en modo local");
      }
    }, 6000);

    try {
      if (typeof initFirebase !== "function") {
        throw new Error("No se cargó js/firebase.js");
      }
      initFirebase();
      console.log("[POS] Firebase inicializado");
    } catch (e) {
      if (firebaseConnectTimeout) clearTimeout(firebaseConnectTimeout);
      console.error("[POS] Firebase init:", e);
      setFirebaseStatus("err", "Sin Firebase · modo local");
      showBanner(
        "<strong>Sin conexión a Firebase.</strong> " + (e.message || e) +
        " — Puede usar todas las pantallas; los datos no se guardan en la nube.",
        true
      );
      return;
    }

    try {
      initListeners();
    } catch (e) {
      if (firebaseConnectTimeout) clearTimeout(firebaseConnectTimeout);
      console.error("[POS] initListeners:", e);
      setFirebaseStatus("err", "Error al escuchar Firestore");
      showBanner("<strong>Firestore:</strong> " + (e.message || e), true);
    }
  }

  function renderUIInicial() {
    try { renderCarrito(); } catch (e) { console.error("[POS] renderCarrito:", e); }
    try { renderDashboard(); } catch (e) { console.error("[POS] renderDashboard:", e); }
    try { renderContable(); } catch (e) { console.error("[POS] renderContable:", e); }
    try { renderInventario(); } catch (e) { console.error("[POS] renderInventario:", e); }
    try { renderClientes(); } catch (e) { console.error("[POS] renderClientes:", e); }
    try { renderPosProductos(); } catch (e) { console.error("[POS] renderPosProductos:", e); }
    try { renderCotizaciones(); } catch (e) { console.error("[POS] renderCotizaciones:", e); }
    try { renderCaja(); } catch (e) { console.error("[POS] renderCaja:", e); }
    try { updateCajaBanner(); } catch (e) { console.error("[POS] updateCajaBanner:", e); }
  }

  function boot() {
    console.log("[POS] Iniciando (Live Server / navegador)...");
    try {
      initModales();
      initNavegacion();
      initInventarioEscanner();
    } catch (e) {
      console.error("[POS] Error UI:", e);
    }
    renderUIInicial();
    setFirebaseStatus("warn", "Conectando...");
    connectFirebase();
  }

  window.mostrarVista = mostrarVista;

  window.addEventListener("error", function (ev) {
    console.error("[POS] Error global:", ev.error || ev.message);
  });

  window.addEventListener("unhandledrejection", function (ev) {
    console.error("[POS] Promise rechazada:", ev.reason);
  });

  window.posBoot = boot;

  if (typeof window.posAuthStart === "function") {
    window.posAuthStart();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

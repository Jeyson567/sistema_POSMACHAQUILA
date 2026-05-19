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
    listeners: []
  };

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

  var VISTAS_IDS = ["dashboard", "contable", "ventas", "inventario", "clientes", "cotizaciones", "caja"];

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
    if (!state.cajaActual) {
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

    watchCol("ventas", db.collection(COL.ventas).limit(500), function (snap) {
      state.ventas = [];
      snap.forEach(function (d) {
        const v = Object.assign({ id: d.id }, d.data());
        v.fecha = tsToDate(v.fecha);
        state.ventas.push(v);
      });
      state.ventas.sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });
      renderDashboard();
      renderContable();
    });

    watchCol("tickets", db.collection(COL.tickets).limit(200), function (snap) {
      state.tickets = [];
      snap.forEach(function (d) {
        const t = Object.assign({ id: d.id }, d.data());
        t.fecha = tsToDate(t.fecha);
        state.tickets.push(t);
      });
      var max = 0;
      state.tickets.forEach(function (t) { if (t.numero > max) max = t.numero; });
      state.ticketCounter = max;
      state.tickets.sort(function (a, b) { return (b.numero || 0) - (a.numero || 0); });
      renderTicketsList();
    });

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

    watchCol("caja", db.collection(COL.caja).limit(30), function (snap) {
      state.cajas = [];
      snap.forEach(function (d) {
        const c = Object.assign({ id: d.id }, d.data());
        c.fechaApertura = tsToDate(c.fechaApertura);
        c.fechaCierre = tsToDate(c.fechaCierre);
        state.cajas.push(c);
      });
      state.cajas.sort(function (a, b) { return (b.fechaApertura || 0) - (a.fechaApertura || 0); });
      state.cajaActual = state.cajas.find(function (c) { return c.abierta === true; }) || null;
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

    watchCol("movimientos", db.collection(COL.movimientosCaja).limit(200), function (snap) {
      state.movimientos = [];
      snap.forEach(function (d) {
        const m = Object.assign({ id: d.id }, d.data());
        m.fecha = tsToDate(m.fecha);
        state.movimientos.push(m);
      });
      renderMovimientos();
      renderCaja();
      renderDashboard();
      renderContable();
    });
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

    const ticketsHoy = state.tickets.filter(function (t) { return isToday(t.fecha); }).length;

    let efectivo = 0;
    if (state.cajaActual) {
      efectivo = calcEfectivoCaja(state.cajaActual);
    }

    return {
      ventasTotal, ganancias, productosVendidos, top, gastosHoy, ticketsHoy, efectivo, numVentas: vh.length
    };
  }

  function calcEfectivoCaja(caja) {
    let total = caja.montoInicial || 0;
    const cajaId = caja.id;
    const apertura = caja.fechaApertura;

    state.ventas.forEach(function (v) {
      if (v.cajaId === cajaId && v.tipoPago === "efectivo" && v.fecha >= apertura) {
        total += v.total || 0;
      }
    });

    state.movimientos.forEach(function (m) {
      if (m.cajaId === cajaId && m.fecha >= apertura) {
        if (m.tipo === "gasto" || m.tipo === "retiro") total -= m.monto || 0;
        if (m.tipo === "ingreso") total += m.monto || 0;
      }
    });

    return total;
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

  safeOn("btnNuevoProducto", "click", function () {
    $("formProducto").reset();
    $("prodId").value = "";
    $("modalProductoTitulo").textContent = "Nuevo producto";
    openModal("modalProducto");
  });

  function editProducto(id) {
    const p = getProducto(id);
    if (!p) return;
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

  safeOn("btnCobrar", "click", cobrarVenta);

  async function cobrarVenta() {
    if (!ensureDb()) return;
    if (!state.carrito.length) {
      toast("Carrito vacío", "warning");
      return;
    }
    if (!state.cajaActual) {
      toast("Debe abrir la caja primero", "error");
      return;
    }
    for (var i = 0; i < state.carrito.length; i++) {
      var it = state.carrito[i];
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

    const efectivoRecibido = tipoPago === "efectivo" ? parseFloat($("posEfectivo").value) || 0 : 0;
    const vuelto = tipoPago === "efectivo" ? Math.max(0, efectivoRecibido - total) : 0;
    const numeroTicket = state.ticketCounter + 1;

    try {
      const batch = db.batch();
      const ventaRef = db.collection(COL.ventas).doc();
      const ventaData = {
        items: items,
        subtotal: total,
        total: total,
        tipoPago: tipoPago,
        clienteId: clienteId,
        efectivoRecibido: efectivoRecibido,
        vuelto: vuelto,
        cajaId: state.cajaActual.id,
        fecha: firebase.firestore.FieldValue.serverTimestamp(),
        numeroTicket: numeroTicket
      };
      batch.set(ventaRef, ventaData);

      const ticketRef = db.collection(COL.tickets).doc();
      batch.set(ticketRef, {
        ventaId: ventaRef.id,
        numero: numeroTicket,
        items: items,
        total: total,
        tipoPago: tipoPago,
        clienteId: clienteId,
        clienteNombre: clienteId ? nombreCliente(clienteId) : "Contado",
        efectivoRecibido: efectivoRecibido,
        vuelto: vuelto,
        fecha: firebase.firestore.FieldValue.serverTimestamp()
      });

      if (tipoPago === "efectivo") {
        const movRef = db.collection(COL.movimientosCaja).doc();
        batch.set(movRef, {
          tipo: "venta",
          monto: total,
          descripcion: "Venta #" + numeroTicket,
          cajaId: state.cajaActual.id,
          ventaId: ventaRef.id,
          fecha: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      if (tipoPago === "fiado" && clienteId) {
        const cli = getCliente(clienteId);
        if (cli) {
          batch.update(db.collection(COL.clientes).doc(clienteId), {
            saldoPendiente: (cli.saldoPendiente || 0) + total
          });
        }
      }

      state.carrito.forEach(function (it) {
        const p = getProducto(it.productoId);
        if (p) {
          batch.update(db.collection(COL.productos).doc(it.productoId), {
            stock: Math.max(0, (p.stock || 0) - it.cantidad)
          });
        }
      });

      await batch.commit();

      imprimirTicket({
        numero: numeroTicket,
        items: items,
        total: total,
        tipoPago: tipoPago,
        clienteNombre: clienteId ? nombreCliente(clienteId) : "Contado",
        efectivoRecibido: efectivoRecibido,
        vuelto: vuelto,
        fecha: new Date()
      });

      state.carrito = [];
      $("posEfectivo").value = "";
      renderCarrito();
      toast("Venta registrada #" + numeroTicket, "success");
    } catch (err) {
      toast("Error al cobrar: " + err.message, "error");
    }
  }

  function imprimirTicket(data) {
    const el = $("ticket-print");
    let lines = "";
    (data.items || []).forEach(function (it) {
      lines += "<div class='ticket-row'><span>" + escapeHtml(it.nombre).substring(0, 18) +
        " x" + it.cantidad + "</span><span>" + formatMoney(it.subtotal || it.cantidad * it.precioUnitario) + "</span></div>";
    });
    el.innerHTML =
      "<div class='ticket-center'><strong>FERRETERÍA MACHAQUILA</strong><br>" +
      "Venta de materiales<br>Ticket #" + data.numero + "<br>" + formatDateTime(data.fecha) + "</div>" +
      "<div class='ticket-line'></div>" + lines +
      "<div class='ticket-line'></div>" +
      "<div class='ticket-row'><strong>TOTAL</strong><strong>" + formatMoney(data.total) + "</strong></div>" +
      "<div class='ticket-row'><span>Pago</span><span>" + (data.tipoPago === "fiado" ? "Fiado" : "Efectivo") + "</span></div>" +
      (data.tipoPago === "efectivo" ?
        "<div class='ticket-row'><span>Recibido</span><span>" + formatMoney(data.efectivoRecibido) + "</span></div>" +
        "<div class='ticket-row'><span>Vuelto</span><span>" + formatMoney(data.vuelto) + "</span></div>" : "") +
      "<div class='ticket-line'></div><div class='ticket-center'>¡Gracias por su compra!</div>";
    el.classList.add("show");
    window.print();
    setTimeout(function () { el.classList.remove("show"); }, 500);
  }

  safeOn("btnBuscarTickets", "click", function () {
    renderTicketsList();
    openModal("modalTickets");
  });

  safeOn("ticketBuscar", "input", renderTicketsList);

  function renderTicketsList() {
    const q = ($("ticketBuscar") && $("ticketBuscar").value || "").toLowerCase();
    let list = state.tickets.slice();
    if (q) {
      list = list.filter(function (t) {
        return String(t.numero).indexOf(q) >= 0 ||
          formatDateTime(t.fecha).toLowerCase().indexOf(q) >= 0;
      });
    }
    list = list.slice(0, 50);
    const tbody = $("ticketsListBody");
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4">Sin tickets</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (t) {
      return "<tr><td>#" + t.numero + "</td><td>" + formatDateTime(t.fecha) +
        "</td><td>" + formatMoney(t.total) +
        "</td><td><button class='btn btn-sm btn-secondary' data-reprint='" + t.id + "'>Reimprimir</button></td></tr>";
    }).join("");
    tbody.querySelectorAll("[data-reprint]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const t = state.tickets.find(function (x) { return x.id === btn.getAttribute("data-reprint"); });
        if (t) imprimirTicket(t);
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

  function verHistorialCliente(id) {
    const c = getCliente(id);
    if (!c) return;
    $("historialTitulo").textContent = "Historial: " + c.nombre;
    const ventas = state.ventas.filter(function (v) { return v.clienteId === id; });
    const tbody = $("historialBody");
    if (!ventas.length) {
      tbody.innerHTML = '<tr><td colspan="4">Sin compras</td></tr>';
    } else {
      tbody.innerHTML = ventas.map(function (v) {
        return "<tr><td>" + formatDateTime(v.fecha) + "</td><td>" + formatMoney(v.total) +
          "</td><td>" + (v.tipoPago || "efectivo") + "</td><td>#" + (v.numeroTicket || "—") + "</td></tr>";
      }).join("");
    }
    openModal("modalHistorial");
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
    const abierta = state.cajaActual;
    $("cajaFormApertura").style.display = abierta ? "none" : "grid";
    $("cajaAbiertaPanel").style.display = abierta ? "block" : "none";
    $("cajaEstadoTitulo").textContent = abierta ? "Caja abierta" : "Caja cerrada";

    const efectivo = abierta ? calcEfectivoCaja(abierta) : 0;
    const vh = ventasHoy().reduce(function (s, v) { return s + (v.total || 0); }, 0);

    $("cajaStats").innerHTML =
      statCard("Efectivo actual", formatMoney(efectivo), "accent") +
      statCard("Ventas hoy", formatMoney(vh), "success") +
      statCard("Monto inicial", abierta ? formatMoney(abierta.montoInicial) : "—", "");

    const cortes = state.cajas.filter(function (c) { return !c.abierta; }).slice(0, 20);
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
    movs = movs.slice(0, 50);
    if (!movs.length) {
      tbody.innerHTML = '<tr><td colspan="4">Sin movimientos</td></tr>';
      return;
    }
    tbody.innerHTML = movs.map(function (m) {
      const sign = (m.tipo === "gasto" || m.tipo === "retiro") ? "-" : "+";
      return "<tr><td>" + formatDateTime(m.fecha) + "</td><td>" + m.tipo +
        "</td><td>" + escapeHtml(m.descripcion || "") + "</td><td>" + sign + formatMoney(m.monto) + "</td></tr>";
    }).join("");
  }

  safeOn("btnAbrirCaja", "click", function () {
    if (!ensureDb()) return;
    const abierta = state.cajas.find(function (c) { return c.abierta; });
    if (abierta) { toast("Ya hay caja abierta", "warning"); return; }
    const monto = parseFloat($("cajaMontoInicial").value) || 0;
    db.collection(COL.caja).add({
      montoInicial: monto,
      abierta: true,
      fechaApertura: firebase.firestore.FieldValue.serverTimestamp(),
      totalVentas: 0
    }).then(function (ref) {
      db.collection(COL.movimientosCaja).add({
        tipo: "apertura",
        monto: monto,
        descripcion: "Apertura de caja",
        cajaId: ref.id,
        fecha: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast("Caja abierta", "success");
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
    if (!state.cajaActual) return;
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
    if (!state.cajaActual) return;
    const caja = state.cajaActual;
    const contado = parseFloat($("cierreContado").value) || 0;
    const esperado = calcEfectivoCaja(caja);
    const ventasCaja = state.ventas.filter(function (v) {
      return v.cajaId === caja.id && v.fecha >= caja.fechaApertura;
    }).reduce(function (s, v) { return s + (v.total || 0); }, 0);

    db.collection(COL.caja).doc(caja.id).update({
      abierta: false,
      montoCierre: contado,
      efectivoEsperado: esperado,
      diferencia: contado - esperado,
      totalVentas: ventasCaja,
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
    });
  });

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

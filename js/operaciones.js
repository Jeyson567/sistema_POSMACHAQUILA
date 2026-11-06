/* Decisiones de idempotencia, inventario y cancelación.
   No lee ni escribe Firebase. */
(function (root) {
  "use strict";

  function ventaEstaCancelada(v) {
    if (!v) return false;
    return v.estado === "CANCELADA" || v.cancelada === true;
  }

  function ventaCuentaEnTotales(v) {
    return !!v && !ventaEstaCancelada(v);
  }

  function siguienteNumeroTicket(seqValor, maxExistente) {
    var base = Number(seqValor);
    if (!isFinite(base) || base < 0) base = 0;
    var maxN = Number(maxExistente);
    if (!isFinite(maxN) || maxN < 0) maxN = 0;
    return Math.max(base, maxN) + 1;
  }

  function crearGuardiaOperacion() {
    var enCurso = false;
    return {
      intentar: function () {
        if (enCurso) return false;
        enCurso = true;
        return true;
      },
      liberar: function () {
        enCurso = false;
      },
      activa: function () {
        return enCurso;
      }
    };
  }

  function lineasDevolucionInventario(items) {
    var map = {};
    (items || []).forEach(function (it) {
      if (!it || !it.productoId) return;
      var cant = Number(it.cantidad) || 0;
      if (!(cant > 0)) return;
      if (!map[it.productoId]) {
        map[it.productoId] = {
          productoId: it.productoId,
          nombre: it.nombre || "",
          cantidad: 0
        };
      }
      map[it.productoId].cantidad += cant;
      if (it.nombre) map[it.productoId].nombre = it.nombre;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function prepararItemsVenta(carrito) {
    var items = (carrito || []).map(function (it) {
      var cant = Number(it.cantidad) || 0;
      var precio = Number(it.precioUnitario) || 0;
      return {
        productoId: it.productoId,
        nombre: it.nombre,
        cantidad: cant,
        precioUnitario: precio,
        precioCosto: Number(it.precioCosto) || 0,
        subtotal: cant * precio
      };
    });
    return { items: items, lineasStock: lineasDevolucionInventario(items) };
  }

  function firmaItems(items) {
    return (items || []).map(function (it) {
      var cant = Number(it.cantidad) || 0;
      var precio = Math.round((Number(it.precioUnitario) || 0) * 100);
      return String(it.productoId || "") + ":" + cant + ":" + precio;
    }).sort().join("|");
  }

  function movimientoEsReversion(m) {
    if (!m) return false;
    return m.tipo === "cancelacion" || m.tipo === "reversion" || m.esReversion === true;
  }

  function tieneLista(venta, campo) {
    var arr = venta && venta[campo];
    return !!(arr && arr.length);
  }

  function evaluarCancelacion(venta, otras, movimientos, opciones) {
    opciones = opciones || {};
    if (!venta || !venta.id) {
      return {
        ok: false,
        codigo: "no_encontrada",
        mensaje: "No se encontró la venta original. No se modificó nada."
      };
    }
    if (ventaEstaCancelada(venta)) {
      return {
        ok: false,
        codigo: "ya_cancelada",
        mensaje: "Esta venta ya está cancelada. No se volvió a procesar."
      };
    }

    var listas = ["abonos", "pagosParciales", "pagos", "devoluciones"];
    for (var i = 0; i < listas.length; i++) {
      if (tieneLista(venta, listas[i])) {
        return {
          ok: false,
          codigo: "relacionados",
          mensaje: "La venta tiene " + listas[i] + ". No se hizo una reversión automática para no alterar mal el inventario o la caja."
        };
      }
    }
    if (venta.montoAbonado != null && Number(venta.montoAbonado) > 0) {
      return {
        ok: false,
        codigo: "relacionados",
        mensaje: "La venta tiene abonos registrados. Reversión automática detenida."
      };
    }

    var tipo = venta.tipoPago || "";
    if (tipo !== "efectivo" && tipo !== "fiado") {
      return {
        ok: false,
        codigo: "tipo",
        mensaje: "Tipo de pago no reconocido (" + (tipo || "vacío") + "). No se revirtió automáticamente."
      };
    }

    var movs = movimientos || [];
    if (movs.some(movimientoEsReversion)) {
      return {
        ok: false,
        codigo: "ya_revertida",
        mensaje: "Ya existe un movimiento de reversión para esta venta. No se procesó de nuevo."
      };
    }
    var raros = movs.filter(function (m) {
      var t = m && m.tipo;
      return t && t !== "venta" && t !== "cancelacion" && t !== "reversion";
    });
    if (raros.length) {
      return {
        ok: false,
        codigo: "relacionados",
        mensaje: "Hay otros movimientos de caja ligados a esta venta (" + raros[0].tipo + "). Reversión automática detenida."
      };
    }

    var lineas = lineasDevolucionInventario(venta.items);
    if (!lineas.length) {
      return {
        ok: false,
        codigo: "sin_items",
        mensaje: "La venta no tiene productos para devolver. No se modificó el inventario."
      };
    }

    var firma = firmaItems(venta.items);
    var hermanas = (otras || []).filter(function (o) {
      if (!o || o.id === venta.id) return false;
      if (Number(o.numeroTicket) !== Number(venta.numeroTicket)) return false;
      if (Math.abs((Number(o.total) || 0) - (Number(venta.total) || 0)) > 0.009) return false;
      return firmaItems(o.items) === firma;
    });

    if (hermanas.length && !opciones.confirmarDuplicado) {
      return {
        ok: false,
        codigo: "duplicado",
        mensaje: "Hay " + (hermanas.length + 1) + " ventas con el mismo ticket, los mismos productos y el mismo total. No se cambió nada para no devolver el inventario más de una vez. Si son la misma operación registrada dos veces, confirme la cancelación del grupo.",
        hermanas: hermanas.map(function (h) { return h.id; })
      };
    }

    if (hermanas.length) {
      var distinto = hermanas.some(function (h) {
        return (h.clienteId || "") !== (venta.clienteId || "") || (h.tipoPago || "") !== tipo;
      });
      if (distinto) {
        return {
          ok: false,
          codigo: "relacionados",
          mensaje: "Las ventas con el mismo ticket no coinciden en cliente o tipo de pago. No se revirtió nada."
        };
      }
    }

    var grupo = [venta].concat(hermanas);
    var activas = grupo.filter(function (v) { return !ventaEstaCancelada(v); });
    if (!activas.length) {
      return {
        ok: false,
        codigo: "ya_cancelada",
        mensaje: "Estas ventas ya están canceladas."
      };
    }

    var algunaRevertida = grupo.some(ventaEstaCancelada) || movs.some(movimientoEsReversion);
    var ajuste = 0;
    activas.forEach(function (v) {
      if ((v.tipoPago || tipo) === "efectivo") ajuste += Number(v.total) || 0;
    });

    return {
      ok: true,
      codigo: hermanas.length ? "grupo" : "simple",
      grupo: activas,
      lineas: lineas,
      revertirInventario: !algunaRevertida,
      ajusteCaja: ajuste,
      tipoPago: tipo,
      principalId: venta.id
    };
  }

  function efectoCajaEsperado(ventas, montoInicial) {
    var total = Number(montoInicial) || 0;
    (ventas || []).forEach(function (v) {
      if (!ventaCuentaEnTotales(v)) return;
      if (v.tipoPago === "efectivo") total += Number(v.total) || 0;
    });
    return Math.round(total * 100) / 100;
  }

  var api = {
    ventaEstaCancelada: ventaEstaCancelada,
    ventaCuentaEnTotales: ventaCuentaEnTotales,
    siguienteNumeroTicket: siguienteNumeroTicket,
    crearGuardiaOperacion: crearGuardiaOperacion,
    lineasDevolucionInventario: lineasDevolucionInventario,
    prepararItemsVenta: prepararItemsVenta,
    firmaItems: firmaItems,
    movimientoEsReversion: movimientoEsReversion,
    evaluarCancelacion: evaluarCancelacion,
    efectoCajaEsperado: efectoCajaEsperado
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  Object.keys(api).forEach(function (k) { root[k] = api[k]; });
})(typeof window !== "undefined" ? window : globalThis);

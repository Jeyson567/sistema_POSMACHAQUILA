/* Pruebas de las reglas de venta y cancelación. No usa Firebase. */
var op = require("./operaciones.js");
var assert = require("assert");

function ventaBase(extra) {
  return Object.assign({
    id: "v1",
    numeroTicket: 10,
    total: 250,
    tipoPago: "efectivo",
    clienteId: null,
    items: [{ productoId: "p1", nombre: "Clavo", cantidad: 2, precioUnitario: 125 }]
  }, extra || {});
}

var g = op.crearGuardiaOperacion();
assert.strictEqual(g.intentar(), true);
assert.strictEqual(g.intentar(), false, "un segundo intento simultáneo debe rechazarse");
g.liberar();
assert.strictEqual(g.intentar(), true, "después de liberar se puede iniciar otra operación");
g.liberar();

assert.strictEqual(op.siguienteNumeroTicket(0, 0), 1);
assert.strictEqual(op.siguienteNumeroTicket(40, 100), 101, "no puede reutilizar un número menor al máximo real");
assert.strictEqual(op.siguienteNumeroTicket(500, 80), 501, "no puede retroceder la secuencia");
assert.strictEqual(op.siguienteNumeroTicket(undefined, 7), 8);

var prep = op.prepararItemsVenta([
  { productoId: "p1", nombre: "A", cantidad: 2, precioUnitario: 10, precioCosto: 4 },
  { productoId: "p1", nombre: "A", cantidad: 3, precioUnitario: 10, precioCosto: 4 }
]);
assert.strictEqual(prep.lineasStock.length, 1);
assert.strictEqual(prep.lineasStock[0].cantidad, 5, "el stock se descuenta una sola vez por producto");

var simple = op.evaluarCancelacion(ventaBase(), [], [{ tipo: "venta", ventaId: "v1" }], {});
assert.strictEqual(simple.ok, true);
assert.strictEqual(simple.revertirInventario, true);
assert.strictEqual(simple.lineas[0].cantidad, 2);
assert.strictEqual(simple.ajusteCaja, 250);

var otraVez = op.evaluarCancelacion(ventaBase({ estado: "CANCELADA" }), [], [], {});
assert.strictEqual(otraVez.ok, false);
assert.strictEqual(otraVez.codigo, "ya_cancelada");

var abonos = op.evaluarCancelacion(ventaBase({ abonos: [{ monto: 50 }] }), [], [], {});
assert.strictEqual(abonos.ok, false);
assert.strictEqual(abonos.codigo, "relacionados");

var movRaro = op.evaluarCancelacion(ventaBase(), [], [{ tipo: "abono", ventaId: "v1" }], {});
assert.strictEqual(movRaro.ok, false);

var yaMov = op.evaluarCancelacion(ventaBase(), [], [{ tipo: "cancelacion", esReversion: true }], {});
assert.strictEqual(yaMov.ok, false);
assert.strictEqual(yaMov.codigo, "ya_revertida");

var hermana = ventaBase({ id: "v2" });
var dup = op.evaluarCancelacion(ventaBase(), [hermana], [], {});
assert.strictEqual(dup.ok, false);
assert.strictEqual(dup.codigo, "duplicado");

var dupOk = op.evaluarCancelacion(ventaBase(), [hermana], [], { confirmarDuplicado: true });
assert.strictEqual(dupOk.ok, true);
assert.strictEqual(dupOk.codigo, "grupo");
assert.strictEqual(dupOk.revertirInventario, true);
assert.strictEqual(dupOk.lineas[0].cantidad, 2, "el grupo devuelve la cantidad una sola vez");
assert.strictEqual(dupOk.ajusteCaja, 500, "cada venta duplicada deja de contar en caja");

var parcial = op.evaluarCancelacion(
  ventaBase(),
  [ventaBase({ id: "v2", estado: "CANCELADA" })],
  [],
  { confirmarDuplicado: true }
);
assert.strictEqual(parcial.ok, true);
assert.strictEqual(parcial.revertirInventario, false, "si el duplicado ya se canceló no se devuelve inventario otra vez");

var caja = op.efectoCajaEsperado([
  ventaBase(),
  ventaBase({ id: "v2", estado: "CANCELADA", total: 250 })
], 100);
assert.strictEqual(caja, 350, "la cancelada no se suma y el movimiento compensatorio no se resta otra vez");

var fiado = op.evaluarCancelacion(ventaBase({ tipoPago: "fiado", clienteId: "c1" }), [], [], {});
assert.strictEqual(fiado.ok, true);
assert.strictEqual(fiado.ajusteCaja, 0);

console.log("operaciones.test.js: 18 comprobaciones correctas");

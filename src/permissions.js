// Módulos (tabla Permiso) × acciones (tabla Privilegio) que tienen sentido en cada módulo.
export const PERMISOS_VALIDOS = {
  Dashboard: ['Consultar'],
  Categorías: ['Consultar', 'Crear', 'Editar', 'Eliminar'],
  Productos: ['Consultar', 'Crear', 'Editar', 'Cambiar estado'],
  Proveedores: ['Consultar', 'Crear', 'Editar', 'Cambiar estado'],
  Compras: ['Consultar', 'Crear', 'Editar', 'Anular'],
  Pedidos: ['Consultar', 'Crear', 'Editar', 'Cambiar estado'],
  Clientes: ['Consultar', 'Crear', 'Editar', 'Cambiar estado', 'Historial de compras'],
  Devoluciones: ['Consultar', 'Crear', 'Cambiar estado'],
  Usuarios: ['Consultar', 'Crear', 'Editar', 'Cambiar estado'],
  Roles: ['Consultar', 'Crear', 'Editar', 'Cambiar estado'],
}

export const PRIVILEGIOS = [
  ['Consultar', 'Ver listados y detalle'],
  ['Crear', 'Registrar nuevos registros'],
  ['Editar', 'Modificar registros existentes'],
  ['Cambiar estado', 'Activar, desactivar o cambiar el estado'],
  ['Eliminar', 'Eliminar registros sin movimientos'],
  ['Anular', 'Anular y revertir el movimiento'],
  ['Historial de compras', 'Consultar las compras de un cliente'],
]

export const ESTADOS_PEDIDO = [
  ['Pendiente', 'Pedido recibido, en validación'],
  ['En proceso', 'Pedido en alistamiento o en camino'],
  ['Entregado', 'Pedido entregado al cliente'],
  ['Cancelado', 'Pedido cancelado; el stock se devolvió'],
]
export const ESTADO = { PENDIENTE: 1, EN_PROCESO: 2, ENTREGADO: 3, CANCELADO: 4 }
export const ESTADOS_DEVOLUCION = ['Pendiente', 'En proceso', 'Finalizada', 'Rechazada']
export const METODOS_PAGO = ['Efectivo', 'PSE', 'Nequi', 'Tarjeta de crédito']
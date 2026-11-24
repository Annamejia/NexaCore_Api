-- ==========================================
-- 1. TABLAS BASE / CATÁLOGOS
-- ==========================================

CREATE TABLE categoria (
    id_categoria SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE estado_pedido (
    id_estado_pedido SERIAL PRIMARY KEY,
    nombre_estado VARCHAR(50) NOT NULL,
    descripcion VARCHAR(255)
);

CREATE TABLE rol (
    id_rol SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion VARCHAR(255),
    estado VARCHAR(20)
);

CREATE TABLE privilegio (
    id_privilegio SERIAL PRIMARY KEY,
    nombre_privilegio VARCHAR(50) NOT NULL UNIQUE,
    descripcion VARCHAR(255)
);

CREATE TABLE permiso (
    id_permiso SERIAL PRIMARY KEY,
    nombre_permiso VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE cliente (
    id_cliente SERIAL PRIMARY KEY,
    tipo_documento VARCHAR(100),
    documento VARCHAR(30) UNIQUE,
    primer_nombre VARCHAR(100),
    segundo_nombre VARCHAR(100),
    primer_apellido VARCHAR(100),
    segundo_apellido VARCHAR(100),
    correo VARCHAR(100) UNIQUE,
    password VARCHAR(255),
    telefono VARCHAR(20),
    departamento VARCHAR(50),
    municipio VARCHAR(50),
    direccion VARCHAR(150),
    estado VARCHAR(20)
);

CREATE TABLE proveedor (
    id_proveedor SERIAL PRIMARY KEY,
    tipo_persona VARCHAR(50),
    tipo_documento VARCHAR(20),
    numero_documento VARCHAR(30) UNIQUE,
    razon_social VARCHAR(150),
    telefono VARCHAR(20),
    correo VARCHAR(100),
    departamento VARCHAR(50),
    municipio VARCHAR(50),
    direccion VARCHAR(150),
    estado VARCHAR(20)
);

-- ==========================================
-- 2. TABLAS CON DEPENDENCIAS DE PRIMER NIVEL
-- ==========================================

CREATE TABLE producto (
    id_producto SERIAL PRIMARY KEY,
    id_categoria INTEGER REFERENCES categoria(id_categoria),
    codigo_barra VARCHAR(50) UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    descripcion VARCHAR(255),
    stock_min INTEGER,
    stock_max INTEGER,
    existencia_actual INTEGER,
    precio_compra DECIMAL(10, 2),
    precio_venta DECIMAL(10, 2),
    estado VARCHAR(20)
);

CREATE TABLE usuario (
    id_usuario SERIAL PRIMARY KEY,
    id_rol INTEGER REFERENCES rol(id_rol),
    tipo_documento VARCHAR(20),
    numero_documento VARCHAR(30) UNIQUE,
    primer_nombre VARCHAR(100),
    segundo_nombre VARCHAR(100),
    primer_apellido VARCHAR(100),
    segundo_apellido VARCHAR(100),
    correo VARCHAR(100) UNIQUE,
    password VARCHAR(255),
    estado VARCHAR(20)
);

CREATE TABLE rol_permiso (
    id_rol INTEGER REFERENCES rol(id_rol),
    id_permiso INTEGER REFERENCES permiso(id_permiso),
    id_privilegio INTEGER REFERENCES privilegio(id_privilegio),
    PRIMARY KEY (id_rol, id_permiso, id_privilegio)
);

-- ==========================================
-- 3. GALERÍA, PEDIDOS, DEVOLUCIONES Y COMPRAS
-- ==========================================

CREATE TABLE galeria_fotos (
    id_galeria_fotos SERIAL PRIMARY KEY,
    id_producto INTEGER REFERENCES producto(id_producto),
    url_imagen VARCHAR(255),
    texto_alternativo VARCHAR(150),
    fecha_creacion TIMESTAMP
);

CREATE TABLE pedido (
    id_pedido SERIAL PRIMARY KEY,
    id_estado_pedido INTEGER REFERENCES estado_pedido(id_estado_pedido),
    id_cliente INTEGER REFERENCES cliente(id_cliente),
    id_usuario INTEGER REFERENCES usuario(id_usuario),
    fecha_pedido TIMESTAMP,
    fecha_entrega TIMESTAMP,
    direccion_envio VARCHAR(150),
    metodo_pago VARCHAR(50),
    iva DECIMAL(10, 2)
);

CREATE TABLE detalle_pedido (
    id_producto INTEGER REFERENCES producto(id_producto),
    id_pedido INTEGER REFERENCES pedido(id_pedido),
    cantidad INTEGER,
    precio_unitario DECIMAL(10, 2),
    iva_producto DECIMAL(10, 2),
    PRIMARY KEY (id_pedido, id_producto)
);

CREATE TABLE detalle_devolucion (
    id_detalle_devolucion SERIAL PRIMARY KEY,
    id_pedido INTEGER,
    id_producto INTEGER,
    fecha_devolucion TIMESTAMP,
    motivo VARCHAR(255),
    cantidad INTEGER,
    monto_favor DECIMAL(10, 2),
    estado VARCHAR(20),
    CONSTRAINT fk_devolucion_detalle_pedido
        FOREIGN KEY (id_pedido, id_producto)
        REFERENCES detalle_pedido(id_pedido, id_producto)
);

CREATE TABLE compra (
    id_compra SERIAL PRIMARY KEY,
    id_proveedor INTEGER REFERENCES proveedor(id_proveedor),
    fecha_compra TIMESTAMP,
    iva DECIMAL(10, 2),
    estado VARCHAR(20)
);

CREATE TABLE compra_producto (
    id_compra INTEGER REFERENCES compra(id_compra),
    id_producto INTEGER REFERENCES producto(id_producto),
    cantidad INTEGER,
    precio_unitario DECIMAL(10, 2),
    iva_producto DECIMAL(10, 2),
    PRIMARY KEY (id_compra, id_producto)
);
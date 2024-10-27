const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const { log } = require('console');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Configuración de multer para manejar archivos
// Configuración de almacenamiento de multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Crear directorio si no existe
        const dir = 'uploads/cvs'; // Directorio donde se guardarán los CVs
        fs.mkdirSync(dir, { recursive: true }); // Asegúrate de que el directorio existe
        cb(null, dir); // Llama a cb con el directorio de destino
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9); // Sufijo único para el nombre del archivo
        cb(null, uniqueSuffix + path.extname(file.originalname)); // Nombre del archivo con la extensión original
    }
});

// Configuración de multer
const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true); // Si el tipo de archivo es PDF, se permite
        } else {
            cb(new Error('Solo se permiten archivos PDF'), false); // De lo contrario, se genera un error
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // Limitar el tamaño a 5MB
    }
});

// Servir archivos estáticos
app.use('/uploads', express.static('uploads'));

// Middleware para manejo de errores de multer
const uploadMiddleware = (req, res, next) => {
    upload.single('cv')(req, res, function(err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ 
                message: 'Error al subir el archivo',
                error: err.message 
            });
        } else if (err) {
            return res.status(400).json({ 
                message: 'Solo se permiten archivos PDF',
                error: err.message 
            });
        }
        next(); // Continúa al siguiente middleware si no hay errores
    });
};
// Conexión a la base de datos SQLite
const db = new sqlite3.Database('database.db', (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
    }
});

// Inicializar la base de datos y crear tablas
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            codigo TEXT NOT NULL,
            correo TEXT NOT NULL UNIQUE,
            contrasena TEXT NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS datos_usuario (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
                correo TEXT NOT NULL,
                nombres TEXT NOT NULL,
                apellidos TEXT NOT NULL,
                url_cv TEXT NOT NULL,
                vacante_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // Crear tabla para las vacantes
    db.run(`
        CREATE TABLE IF NOT EXISTS vacantes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT NOT NULL,
            descripcion TEXT NOT NULL,
            ubicacion TEXT NOT NULL,
            salario TEXT
        )
    `);
});
// Ruta para agregar un nuevo usuario
app.post('/usuarios', (req, res) => {
    const { nombre, codigo, correo, contrasena } = req.body;
  
    // Validar que se reciban todos los campos
    if (!nombre || !codigo || !correo || !contrasena) {
      return res.status(400).json({ error: 'Todos los campos son requeridos.' });
    }
  
    const sql = `INSERT INTO usuarios (nombre, codigo, correo, contrasena) VALUES (?, ?, ?, ?)`;
    db.run(sql, [nombre, codigo, correo, contrasena], function (err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res.status(400).json({ error: 'El correo electrónico ya está en uso.' });
        }
        return res.status(500).json({ error: 'Error al agregar el usuario.', details: err.message });
      }
      res.status(201).json({ id: this.lastID, nombre, codigo, correo });
    });
  });
// Ruta para el login
app.post('/login', (req, res) => {
    const { nombre, codigo, correo, contrasena } = req.body;

    db.get('SELECT * FROM usuarios WHERE nombre = ? AND codigo = ? AND correo = ? AND contrasena = ?', 
    [nombre, codigo, correo, contrasena], (err, row) => {
        if (err) {
            return res.status(500).json({ message: 'Error en la consulta.' });
        }
        if (row) {
            return res.status(200).json({ message: 'Login exitoso', usuario: row });
        } else {
            return res.status(401).json({ message: 'Credenciales incorrectas.' });
        }
    });
});

// Ruta para almacenar datos del usuario con el CV
app.post('/datos_usuario', uploadMiddleware, (req, res) => {
    const { correo, nombres, apellidos, vacanteId } = req.body;
    
    if (!req.file) {
        return res.status(400).json({ message: 'El CV es requerido.' });
    }

    const url_cv = req.file.path.replace(/\\/g, '/'); // Normalizar path para Windows

    const sql = `
        INSERT INTO datos_usuario (correo, nombres, apellidos, url_cv, vacante_id) 
        VALUES (?, ?, ?, ?, ?)
    `;
    
    db.run(sql, [correo, nombres, apellidos, url_cv, vacanteId], function(err) {
        if (err) {
            console.log(err);
            
            return res.status(400).json({ 
                message: 'Error al almacenar los datos.', 
                error: err.message
                
            });
        }
        
        res.status(201).json({ 
            message: 'Aplicación almacenada exitosamente.',
            id: this.lastID 
        });
    });
});
// Ruta para obtener todas las aplicaciones guardadas
app.get('/api/applications', (req, res) => {
    const sql = `
        SELECT id, correo, nombres, apellidos, url_cv, vacante_id, created_at 
        FROM datos_usuario
    `;

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error al obtener los datos:', err);
            return res.status(500).json({
                message: 'Error al obtener los datos.',
                error: err.message
            });
        }
        
        res.status(200).json({
            message: 'Datos obtenidos exitosamente.',
            data: rows
        });
    });
});
// Ruta para obtener una aplicación específica por ID
app.get('/api/applications/:id', (req, res) => {
    const { id } = req.params; // Obtener el ID de los parámetros de la ruta
    const sql = `
        SELECT id, correo, nombres, apellidos, url_cv, vacante_id, created_at 
        FROM datos_usuario 
        WHERE id = ?
    `;

    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error('Error al obtener los datos:', err);
            return res.status(500).json({
                message: 'Error al obtener los datos.',
                error: err.message
            });
        }

        if (!row) {
            return res.status(404).json({
                message: 'Aplicación no encontrada.'
            });
        }

        res.status(200).json({
            message: 'Datos obtenidos exitosamente.',
            data: row
        });
    });
});


// Obtener una vacante específica
app.get('/vacantes/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT * FROM vacantes WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ 
                message: 'Error al obtener la vacante.' 
            });
        }
        
        if (!row) {
            return res.status(404).json({ 
                message: 'Vacante no encontrada.' 
            });
        }
        
        res.status(200).json(row);
    });
});

// Obtener todas las vacantes
app.get('/vacantes', (req, res) => {
    db.all('SELECT * FROM vacantes', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ 
                message: 'Error al obtener las vacantes.' 
            });
        }
        res.status(200).json(rows);
    });
});
// Crear una nueva vacante
app.post('/vacantes', (req, res) => {
    const { titulo, descripcion, ubicacion, salario } = req.body;

    const sql = 'INSERT INTO vacantes (titulo, descripcion, ubicacion, salario) VALUES (?, ?, ?, ?)';
    db.run(sql, [titulo, descripcion, ubicacion, salario], function (err) {
        if (err) {
            return res.status(400).json({ message: 'Error al crear la vacante.', error: err.message });
        }
        res.status(201).json({ message: 'Vacante creada exitosamente.', id: this.lastID });
    });
});
// Actualizar una vacante
app.put('/vacantes/:id', (req, res) => {
    const { id } = req.params;
    const { titulo, descripcion, ubicacion, salario } = req.body;

    const sql = 'UPDATE vacantes SET titulo = ?, descripcion = ?, ubicacion = ?, salario = ? WHERE id = ?';
    db.run(sql, [titulo, descripcion, ubicacion, salario, id], function (err) {
        if (err) {
            return res.status(400).json({ message: 'Error al actualizar la vacante.', error: err.message });
        }
        res.status(200).json({ message: 'Vacante actualizada exitosamente.' });
    });
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});

